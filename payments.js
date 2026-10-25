// payments.js
//
// Hybrid M-Pesa deposit layer. Two providers sit behind one interface:
//
//   palpluss - PalPluss STK Push API (preferred by default)
//   daraja   - Safaricom Daraja directly
//
// Which one handles NEW deposits:
//   1. Each provider is "configured" only if all of its required env vars are
//      set (see REQUIRED_ENV below).
//   2. If only one is configured, that one is used.
//   3. If both are configured, the admin's choice is used (stored in the
//      app_settings table, changed only from the admin dashboard). Until an
//      admin changes it, PalPluss is the default.
//   4. If the chosen provider later loses its env vars, the other one takes
//      over automatically (and the dashboard shows why).
//
// Every deposit remembers the provider it started with (transactions.metadata
// .provider), so switching providers never strands a pending deposit: its
// callback / status check always goes to the provider that issued it.
//
// B2C is intentionally not implemented here yet.

const crypto = require('crypto')
const db = require('./database')

const PROVIDERS = ['palpluss', 'daraja']
const DEFAULT_PROVIDER = 'palpluss'
const SETTING_KEY = 'deposit_provider'

const REQUIRED_ENV = {
  daraja: [
    'MPESA_CONSUMER_KEY',
    'MPESA_CONSUMER_SECRET',
    'MPESA_SHORTCODE',
    'MPESA_PASSKEY',
    'MPESA_CALLBACK_URL',
  ],
  // PALPLUSS_CALLBACK_URL is the full public URL of POST /wallet/palpluss/callback
  // on this server (PalPluss requires a callbackUrl on every STK request).
  // Credentials: PALPLUSS_API_KEY, or a precomputed PALPLUSS_BASIC_AUTH_TOKEN
  // (see palplussAuthHeader) - either one is enough, see missingEnv().
  // Optional: PALPLUSS_ENV, PALPLUSS_CHANNEL_ID, PALPLUSS_CREDENTIAL_ID,
  // PALPLUSS_BASE_URL.
  palpluss: ['PALPLUSS_CALLBACK_URL'],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Errors ──────────────────────────────────────────────────────────

class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', httpStatus = 502, userMessage, retryAfter, expose = false } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.httpStatus = httpStatus
    this.userMessage = userMessage || 'Failed to initiate M-Pesa push. Please try again.'
    this.retryAfter = retryAfter || null
    this.expose = expose // true = safe to show err.message to the client
  }
}

// ── Configuration status ────────────────────────────────────────────

const envSet = (n) => String(process.env[n] || '').trim() !== ''

function missingEnv(provider) {
  const missing = REQUIRED_ENV[provider].filter((n) => !envSet(n))
  if (provider === 'palpluss' && !envSet('PALPLUSS_API_KEY') && !envSet('PALPLUSS_BASIC_AUTH_TOKEN')) {
    missing.unshift('PALPLUSS_API_KEY (or PALPLUSS_BASIC_AUTH_TOKEN)')
  }
  return missing
}

function isConfigured(provider) {
  return missingEnv(provider).length === 0
}

function logStartup() {
  for (const p of PROVIDERS) {
    const missing = missingEnv(p)
    console.log(`[Payments] ${p}: ${missing.length ? `NOT configured (missing ${missing.join(', ')})` : 'configured'}`)
  }
  if (isConfigured('daraja')) {
    console.log(`[M-Pesa] Environment: ${process.env.MPESA_ENV || 'development'}`)
    console.log(`[M-Pesa] Base URL: ${darajaBaseUrl()}`)
    console.log(`[M-Pesa] Shortcode: ${process.env.MPESA_SHORTCODE}`)
  }
}

// ── Provider selection ──────────────────────────────────────────────

let prefCache = { value: null, at: 0 }
const PREF_TTL_MS = 10 * 1000
let warnedSettingsTable = false

async function getPreferredProvider() {
  if (prefCache.value && Date.now() - prefCache.at < PREF_TTL_MS) return prefCache.value
  let value = DEFAULT_PROVIDER
  try {
    const { data, error } = await db.supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle()
    if (error) throw error
    if (data && PROVIDERS.includes(data.value)) value = data.value
  } catch (err) {
    if (!warnedSettingsTable) {
      warnedSettingsTable = true
      console.warn(`[Payments] Could not read ${SETTING_KEY} setting (${err.message}); defaulting to ${DEFAULT_PROVIDER}. Has the app_settings migration been run?`)
    }
  }
  prefCache = { value, at: Date.now() }
  return value
}

// Returns { provider, preferred, reason } or null when neither is configured.
async function resolveProvider() {
  const preferred = await getPreferredProvider()
  const other = PROVIDERS.find((p) => p !== preferred)
  if (isConfigured(preferred)) return { provider: preferred, preferred, reason: 'preferred' }
  if (isConfigured(other)) {
    return { provider: other, preferred, reason: `${preferred} is not configured, using ${other}` }
  }
  return null
}

// Which provider issued this deposit. Falls back to the reference format
// (PalPluss ids are UUIDs, Daraja CheckoutRequestIDs are not) for rows
// created before provider tracking existed.
function providerOf(tx) {
  const p = tx && tx.metadata && tx.metadata.provider
  if (PROVIDERS.includes(p)) return p
  return UUID_RE.test((tx && tx.reference) || '') ? 'palpluss' : 'daraja'
}

// ── Phone formatting ────────────────────────────────────────────────

function formatPhoneNumber(phone) {
  let cleaned = String(phone || '').replace(/\s/g, '')

  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1)
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1)
  if (cleaned.startsWith('1') && !cleaned.startsWith('2541')) cleaned = '254' + cleaned
  if (cleaned.startsWith('7') && !cleaned.startsWith('2547')) cleaned = '254' + cleaned

  if (!/^254[17]\d{8}$/.test(cleaned)) return null
  return cleaned
}

// ══════════════════════════════════════════════════════════════════
// Daraja
// ══════════════════════════════════════════════════════════════════

function darajaBaseUrl() {
  return (process.env.MPESA_ENV || 'development') === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke'
}

let mpesaAccessToken = null
let tokenExpiryTime = null

async function getMpesaAccessToken() {
  if (mpesaAccessToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
    return mpesaAccessToken
  }

  try {
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64')

    const response = await fetch(`${darajaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OAuth failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    if (!data.access_token) throw new Error('No access token in response')

    mpesaAccessToken = data.access_token
    tokenExpiryTime = Date.now() + (50 * 60 * 1000)

    console.log('[M-Pesa] Access token obtained successfully')
    return mpesaAccessToken
  } catch (error) {
    console.error('[M-Pesa] Failed to get access token:', error.message)
    throw new Error(`Failed to authenticate with M-Pesa: ${error.message}`)
  }
}

async function darajaInitiateStk(phone, amountKES, reference) {
  console.log(`[M-Pesa] STK Push to ${phone} for KES ${amountKES}, ref: ${reference}`)

  const formattedPhone = formatPhoneNumber(phone)
  if (!formattedPhone) {
    throw new ProviderError('Invalid phone number format. Use 07XXXXXXXX, 01XXXXXXXX, or 2547XXXXXXXX', {
      code: 'INVALID_PHONE', httpStatus: 400, expose: true,
      userMessage: 'Invalid phone number. Use 07XXXXXXXX or 01XXXXXXXX format.',
    })
  }

  const shortcode = process.env.MPESA_SHORTCODE
  const accessToken = await getMpesaAccessToken()
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64')

  const stkData = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amountKES),
    PartyA: formattedPhone,
    PartyB: shortcode,
    PhoneNumber: formattedPhone,
    CallBackURL: process.env.MPESA_CALLBACK_URL,
    AccountReference: reference || 'GWaveDeposit',
    TransactionDesc: `G Wave deposit - ${reference}`,
  }

  console.log('[M-Pesa] STK Push request:', JSON.stringify({ ...stkData, Password: '***HIDDEN***' }, null, 2))

  try {
    const response = await fetch(`${darajaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(stkData),
    })

    const result = await response.json()
    console.log('[M-Pesa] STK Push response:', JSON.stringify(result, null, 2))

    if (!response.ok || result.ResponseCode !== '0') {
      const errorMsg = result.ResponseDescription || result.errorMessage || 'STK Push failed'
      throw new ProviderError(`STK Push failed: ${errorMsg}`, { expose: true })
    }

    return {
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID,
      responseCode: result.ResponseCode,
      responseDescription: result.ResponseDescription,
      customerMessage: result.CustomerMessage,
    }
  } catch (error) {
    console.error('[M-Pesa] STK Push error:', error.message)
    if (error instanceof ProviderError) throw error
    throw new ProviderError(error.message, { expose: true })
  }
}

async function darajaQueryStatus(checkoutRequestId) {
  try {
    const accessToken = await getMpesaAccessToken()
    const shortcode = process.env.MPESA_SHORTCODE

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64')

    const response = await fetch(`${darajaBaseUrl()}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    })

    const result = await response.json()
    console.log('[M-Pesa] Status query response:', JSON.stringify(result, null, 2))

    if (!response.ok) {
      throw new Error(`Status query failed: ${result.errorMessage || 'Unknown error'}`)
    }
    return result
  } catch (error) {
    console.error('[M-Pesa] Status check error:', error.message)
    return null
  }
}

// Same decision rules the polling code always used.
function mapDarajaQuery(result) {
  if (!result) return 'pending'
  if (result.ResultCode === '0' && result.ResultDesc === 'The service request is processed successfully.') return 'completed'
  if (result.ResultCode !== '1037') return 'failed'
  return 'pending'
}

// ══════════════════════════════════════════════════════════════════
// PalPluss  (https://api.palpluss.com/v1, see "Initiate STK Push" docs)
// ══════════════════════════════════════════════════════════════════

const PALPLUSS_TIMEOUT_MS = 15 * 1000

// Which PalPluss environment to call. Explicit settings win; otherwise it is
// inferred from the key prefix (pk_live_ -> production, pk_test_ -> sandbox),
// and anything unknown falls back to sandbox so a misconfigured box can't
// charge real customers by accident.
function palplussBaseUrl() {
  if (envSet('PALPLUSS_BASE_URL')) return process.env.PALPLUSS_BASE_URL.trim().replace(/\/+$/, '')
  let env = String(process.env.PALPLUSS_ENV || '').trim().toLowerCase()
  if (!env) env = String(process.env.PALPLUSS_API_KEY || '').startsWith('pk_live_') ? 'production' : 'sandbox'
  return env === 'production' ? 'https://api.palpluss.com/v1' : 'https://sandbox.palpluss.com/v1'
}

// HTTP Basic per docs.palpluss.com/guides/authentication:
//   Authorization: Basic base64("<apiKey>:")   (API key as username, empty password)
// PALPLUSS_BASIC_AUTH_TOKEN, if set, is an already-encoded token used as-is
// (a leading "Basic " is tolerated).
function palplussAuthHeader() {
  if (envSet('PALPLUSS_BASIC_AUTH_TOKEN')) {
    return `Basic ${process.env.PALPLUSS_BASIC_AUTH_TOKEN.trim().replace(/^Basic\s+/i, '')}`
  }
  return `Basic ${Buffer.from(`${process.env.PALPLUSS_API_KEY}:`).toString('base64')}`
}

async function palplussRequest(method, path, body) {
  let res
  try {
    res = await fetch(`${palplussBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: palplussAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(PALPLUSS_TIMEOUT_MS),
    })
  } catch (err) {
    throw new ProviderError(`PalPluss request failed: ${err.message}`, { code: 'PALPLUSS_UNREACHABLE' })
  }

  let json = null
  try { json = await res.json() } catch (_) { /* non-JSON body */ }

  if (!res.ok || !json || json.success === false) {
    const e = (json && json.error) || {}
    throw palplussError(res.status, e.code, e.message, e.details)
  }
  return json
}

// Translates PalPluss error codes into something safe to show to a player,
// while logging the operational ones loudly for whoever runs the platform.
function palplussError(httpStatus, code = 'UNKNOWN', message = 'Request failed', details = {}) {
  const base = `PalPluss ${code} (HTTP ${httpStatus}): ${message}`
  switch (code) {
    case 'INVALID_PHONE':
      return new ProviderError(base, {
        code, httpStatus: 400,
        userMessage: 'Invalid phone number. Use 07XXXXXXXX or 01XXXXXXXX format.',
      })
    case 'STK_TEMP_BANNED':
    case 'TRANSACTION_HEALTH_BLOCKED': {
      const retryAfter = Number(details && details.retryAfterSeconds) || null
      console.error(`[PalPluss] ${code}: STK is paused${retryAfter ? ` for ~${Math.ceil(retryAfter / 60)} min` : ''}. ${message}`)
      return new ProviderError(base, {
        code, httpStatus: 429, retryAfter,
        userMessage: 'M-Pesa deposits are temporarily unavailable. Please try again later.',
      })
    }
    case 'INSUFFICIENT_SERVICE_BALANCE':
      console.error('[PalPluss] SERVICE WALLET TOO LOW - top it up in the PalPluss console, or switch the deposit provider to Daraja in the admin dashboard.')
      return new ProviderError(base, { code, httpStatus: 503, userMessage: 'Deposits are temporarily unavailable. Please try again later.' })
    case 'NO_PAYMENT_CHANNELS':
    case 'NO_DEFAULT_CHANNEL':
    case 'CHANNEL_NOT_FOUND':
    case 'INVALID_API_KEY':
      console.error(`[PalPluss] Configuration problem - ${base}`)
      return new ProviderError(base, { code, httpStatus: 503, userMessage: 'Deposits are temporarily unavailable. Please try again later.' })
    default:
      return new ProviderError(base, { code })
  }
}

async function palplussInitiateStk({ phone, amountKES, txId }) {
  const formattedPhone = formatPhoneNumber(phone)
  if (!formattedPhone) {
    throw new ProviderError('Invalid phone number', {
      code: 'INVALID_PHONE', httpStatus: 400,
      userMessage: 'Invalid phone number. Use 07XXXXXXXX or 01XXXXXXXX format.',
    })
  }

  const body = {
    amount: Math.round(amountKES),
    phone: formattedPhone,
    accountReference: `GW${String(txId).replace(/-/g, '').substring(0, 8).toUpperCase()}`, // <= 12 chars
    transactionDesc: 'GWave deposit',                                                      // <= 13 chars
    callbackUrl: palplussCallbackUrl(),
  }
  if (process.env.PALPLUSS_CHANNEL_ID) body.channelId = process.env.PALPLUSS_CHANNEL_ID
  if (process.env.PALPLUSS_CREDENTIAL_ID) body.credential_id = process.env.PALPLUSS_CREDENTIAL_ID

  console.log(`[PalPluss] STK Push to ${formattedPhone} for KES ${body.amount}, ref: ${body.accountReference}`)
  const json = await palplussRequest('POST', '/payments/stk', body)
  const d = json.data || {}
  if (!d.transactionId) {
    throw new ProviderError('PalPluss accepted the request but returned no transactionId', { code: 'PALPLUSS_BAD_RESPONSE' })
  }
  console.log(`[PalPluss] STK accepted. transactionId=${d.transactionId} status=${d.status} fee=${d.transactionFee}`)
  return { externalId: d.transactionId }
}

async function palplussGetTransaction(id) {
  const json = await palplussRequest('GET', `/transactions/${encodeURIComponent(id)}`)
  const t = (json.data && (json.data.transaction || json.data)) || {}
  return {
    id: t.transactionId || t.id || null,
    status: String(t.status || '').toUpperCase(),
    amount: Number(t.amount),
  }
}

// Only an exact SUCCESS credits money. Anything unrecognised stays pending.
function mapPalplussStatus(status) {
  if (status === 'SUCCESS') return 'completed'
  if (['FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(status)) return 'failed'
  return 'pending'
}

// Asks PalPluss (not the webhook body) what really happened.
async function palplussCheck(tx) {
  const v = await palplussGetTransaction(tx.reference)
  const state = mapPalplussStatus(v.status)
  if (state === 'completed') {
    const expected = Math.round(Number(tx.amount_kes))
    if (Number.isFinite(v.amount) && Math.round(v.amount) !== expected) {
      console.error(`[PalPluss] AMOUNT MISMATCH on tx ${tx.id}: paid KES ${v.amount}, expected KES ${expected}. NOT crediting - review manually.`)
      return { state: 'pending', reason: 'amount_mismatch' }
    }
  }
  return { state, providerStatus: v.status }
}

// The callback URL carries a secret derived from the API credential, so the
// endpoint ignores random POSTs. It is only a spam filter: the handler also
// re-checks every event against the PalPluss API before crediting anything.
function webhookSecret() {
  const key = process.env.PALPLUSS_API_KEY || process.env.PALPLUSS_BASIC_AUTH_TOKEN
  if (!key) return null
  return crypto.createHmac('sha256', key).update('gwave-palpluss-webhook-v1').digest('hex').slice(0, 48)
}

function palplussCallbackUrl() {
  const u = new URL(process.env.PALPLUSS_CALLBACK_URL)
  u.searchParams.set('s', webhookSecret())
  return u.toString()
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// ══════════════════════════════════════════════════════════════════
// Provider-agnostic interface used by wallet.js
// ══════════════════════════════════════════════════════════════════

// Returns { externalId } - the id stored as the transaction's `reference`
// (Daraja CheckoutRequestID or PalPluss transactionId).
async function initiateStk(provider, { phone, amountKES, reference, txId }) {
  if (provider === 'palpluss') return palplussInitiateStk({ phone, amountKES, txId })
  if (provider === 'daraja') {
    const r = await darajaInitiateStk(phone, amountKES, reference)
    return { externalId: r.checkoutRequestId }
  }
  throw new ProviderError(`Unknown provider ${provider}`)
}

// Returns { state: 'completed' | 'failed' | 'pending' } for a deposit row.
async function queryStatus(tx) {
  if (providerOf(tx) === 'palpluss') return palplussCheck(tx)
  return { state: mapDarajaQuery(await darajaQueryStatus(tx.reference)) }
}

// Moves a deposit out of 'pending' exactly once and credits it on success.
//
// The pending -> final update is conditional (.eq('status','pending')), so
// when a webhook and a status poll race, only one of them wins the update and
// only that one credits the balance. Returns true if THIS call settled it.
async function settleDeposit(tx, outcome, reference = null) {
  const update = { status: outcome }
  if (reference) update.reference = reference

  const { data, error } = await db.supabase
    .from('transactions')
    .update(update)
    .eq('id', tx.id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    console.log(`[Payments] Transaction ${tx.id} was already settled, skipping`)
    return false
  }

  if (outcome === 'completed') {
    try {
      const account = await db.getAccountByUserAndType(tx.user_id, 'real')
      if (!account) throw new Error(`no real account for user ${tx.user_id}`)
      await db.addBalance(account.id, parseFloat(tx.amount_usd))
      console.log(`[Payments] Credited ${tx.amount_usd} USD to account ${account.id} (tx ${tx.id})`)
    } catch (err) {
      // Put it back to pending so a retry (webhook redelivery / poll) can credit it.
      console.error(`[Payments] Credit failed for tx ${tx.id}, reverting to pending:`, err.message)
      await db.supabase.from('transactions').update({ status: 'pending' }).eq('id', tx.id).eq('status', 'completed')
      throw err
    }
  }
  return true
}

// ── PalPluss webhook (POST /wallet/palpluss/callback) ───────────────

async function palplussCallback(req, res) {
  try {
    const secret = webhookSecret()
    if (!secret || !safeEqual(req.query.s || '', secret)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }

    const body = req.body || {}
    const txn = body.transaction || {}
    const providerTxId = txn.id || txn.transactionId
    console.log(`[PalPluss] Webhook: ${body.event_type || 'unknown event'} for ${providerTxId || 'unknown tx'}`)

    if (!providerTxId || typeof providerTxId !== 'string') {
      return res.status(200).json({ success: true, ignored: 'no transaction id' })
    }

    const tx = await db.getTransactionByReference(providerTxId)
    if (!tx || providerOf(tx) !== 'palpluss') {
      console.warn(`[PalPluss] Webhook for unknown transaction ${providerTxId}`)
      return res.status(200).json({ success: true, ignored: 'unknown transaction' })
    }
    if (tx.status !== 'pending') {
      return res.status(200).json({ success: true, ignored: `already ${tx.status}` })
    }

    // Never trust the webhook body for the outcome: ask PalPluss directly.
    let check
    try {
      check = await palplussCheck(tx)
    } catch (err) {
      console.error(`[PalPluss] Could not verify ${providerTxId}:`, err.message)
      return res.status(502).json({ success: false, error: 'Verification failed, please retry' })
    }

    if (check.state !== 'pending') {
      await settleDeposit(tx, check.state, providerTxId)
      console.log(`[PalPluss] Transaction ${tx.id} -> ${check.state}`)
    }
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('[PalPluss] Webhook error:', err)
    res.status(500).json({ success: false, error: 'Webhook processing failed' })
  }
}

// ── Admin: view / switch the active provider ────────────────────────

function describe(preferred, active) {
  const info = (p) => ({ configured: isConfigured(p), missing: missingEnv(p) })
  return {
    preferred,
    active: active ? { provider: active.provider, reason: active.reason } : null,
    providers: { palpluss: info('palpluss'), daraja: info('daraja') },
  }
}

function registerRoutes(app, { mw }) {
  logStartup()

  app.post('/wallet/palpluss/callback', palplussCallback)

  const adminOnly = [mw.authenticate, mw.requireRole('admin')]

  app.get('/admin/payments/provider', ...adminOnly, async (req, res, next) => {
    try {
      const preferred = await getPreferredProvider()
      res.json({ success: true, data: describe(preferred, await resolveProvider()) })
    } catch (err) { next(err) }
  })

  app.put('/admin/payments/provider', ...adminOnly, async (req, res, next) => {
    try {
      const provider = req.body && req.body.provider
      if (!PROVIDERS.includes(provider)) {
        return res.status(400).json({ success: false, error: 'provider must be "palpluss" or "daraja".', code: 'VALIDATION_ERROR' })
      }
      if (!isConfigured(provider)) {
        return res.status(400).json({
          success: false,
          error: `${provider} cannot be selected: missing env vars ${missingEnv(provider).join(', ')}.`,
          code: 'PROVIDER_NOT_CONFIGURED',
        })
      }

      const previous = await getPreferredProvider()
      const { error } = await db.supabase
        .from('app_settings')
        .upsert(
          { key: SETTING_KEY, value: provider, updated_by: req.user.id, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
      if (error) throw error
      prefCache = { value: provider, at: Date.now() }

      console.warn(`[Payments] admin ${req.user.id} switched deposit provider ${previous} -> ${provider}`)
      const { error: auditErr } = await db.supabase.from('admin_audit_log').insert({
        admin_id: req.user.id,
        action: 'set_payment_provider',
        target_type: 'setting',
        details: { key: SETTING_KEY, from: previous, to: provider },
      })
      if (auditErr) console.warn('[Payments] audit log insert failed:', auditErr.message)

      res.json({ success: true, data: describe(provider, await resolveProvider()) })
    } catch (err) { next(err) }
  })
}

module.exports = {
  PROVIDERS,
  ProviderError,
  isConfigured,
  resolveProvider,
  providerOf,
  initiateStk,
  queryStatus,
  settleDeposit,
  formatPhoneNumber,
  registerRoutes,
  palplussCallback,
  // Daraja-only helpers kept for anything that called them directly
  darajaInitiateStk,
  darajaQueryStatus,
  // exported for tests
  mapPalplussStatus,
  mapDarajaQuery,
}
