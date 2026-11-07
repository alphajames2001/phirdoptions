// push.js
// Builds the M-PESA "You have received..." message for a sent influencer
// withdrawal, stores it on the row, and pushes it to the influencer's devices.
//
// Env: FIREBASE_SERVICE_ACCOUNT = the full service-account JSON (one line).
// If it is missing, pushes are skipped and everything else keeps working.

const db = require('./database')

const SENDER_NAME = 'PALPLUS FUTURE'

// ── Firebase ─────────────────────────────────────────────────────────
// Uses the modular entry points (firebase-admin/app, firebase-admin/messaging),
// which work on every firebase-admin version from v10 up. The old
// `require('firebase-admin').credential` namespace is not present in all builds.

let fcm = null
let initTried = false

function getMessaging() {
  if (fcm || initTried) return fcm
  initTried = true
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    console.warn('[Push] FIREBASE_SERVICE_ACCOUNT not set - push notifications disabled')
    return null
  }
  try {
    const { initializeApp, getApps, cert } = require('firebase-admin/app')
    const { getMessaging: getFirebaseMessaging } = require('firebase-admin/messaging')

    const account = JSON.parse(raw)
    // Hosting dashboards often turn the key's "\n" into a literal backslash-n.
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n')

    const app = getApps()[0] || initializeApp({ credential: cert(account) })
    fcm = getFirebaseMessaging(app)
    console.log('[Push] Firebase ready')
  } catch (err) {
    console.error('[Push] Firebase init failed:', err.message)
  }
  return fcm
}

// ── KES rate ─────────────────────────────────────────────────────────
// Reads the same /wallet/rate endpoint the pages use. If exchange.js exports
// a getter, you can call that here instead.

let rateCache = { value: 130, at: 0 }

async function getKesRate() {
  if (Date.now() - rateCache.at < 60 * 1000) return rateCache.value
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 4000}/wallet/rate`)
    const json = await res.json()
    if (json && json.success && json.data && json.data.rate) {
      rateCache = { value: Number(json.data.rate), at: Date.now() }
    }
  } catch { /* keep last known rate (130 fallback, same as the pages) */ }
  return rateCache.value
}

// ── Message text (same logic as mpesa-messages.html) ─────────────────

function hash32(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function rng(seed) {
  let a = seed
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nairobi(date) {
  const o = {}
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', day: 'numeric', month: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(date).forEach(p => { o[p.type] = p.value })
  return { d: +o.day, m: +o.month, y: +o.year, time: `${o.hour}:${o.minute} ${String(o.dayPeriod).toUpperCase()}` }
}

function mpesaCode(id, n) {
  const r = rng(hash32('code' + id))
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const yearCh = String.fromCharCode(65 + 20 + Math.max(0, Math.min(5, n.y - 2026)))
  const monthCh = String.fromCharCode(64 + n.m)
  const dayCh = n.d < 10 ? String(n.d) : String.fromCharCode(55 + n.d)
  let tail = ''
  for (let i = 0; i < 7; i++) tail += chars[Math.floor(r() * chars.length)]
  return yearCh + monthCh + dayCh + tail
}

const money = cents =>
  (cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function buildMessageText({ id, when, kesCents, balanceCents }) {
  const n = nairobi(when)
  return (
    `${mpesaCode(id, n)} Confirmed.You have received Ksh${money(kesCents)} from ${SENDER_NAME} ` +
    `on ${n.d}/${n.m}/${String(n.y).slice(2)} at ${n.time}. ` +
    `New M-PESA balance is Ksh${money(balanceCents)}. Transaction cost, Ksh0.00.`
  )
}

// ── Sending ──────────────────────────────────────────────────────────

async function sendToUser(userId, { title, body, withdrawalId }) {
  const messaging = getMessaging()
  if (!messaging) return

  const { data: rows, error } = await db.supabase
    .from('device_tokens').select('token').eq('user_id', userId)
  if (error) throw error
  const tokens = (rows || []).map(r => r.token)
  if (!tokens.length) return

  // Data-only + high priority: the app builds the notification itself, so it
  // looks the same whether the app is open or closed.
  const result = await messaging.sendEachForMulticast({
    tokens,
    data: { title, body, withdrawalId: String(withdrawalId) },
    android: { priority: 'high', ttl: 60 * 60 * 1000 },
  })

  const dead = []
  result.responses.forEach((r, i) => {
    const code = r.error && r.error.code
    if (!r.success && (code === 'messaging/registration-token-not-registered' ||
                       code === 'messaging/invalid-registration-token')) {
      dead.push(tokens[i])
    }
  })
  if (dead.length) await db.supabase.from('device_tokens').delete().in('token', dead)
}

// Call with the row returned by updateInfluencerWithdrawalStatus(..., 'sent').
// Never throws: a push failure must not affect the withdrawal itself.
async function notifyWithdrawalSent(w) {
  try {
    const rate = await getKesRate()
    const kesCents = Math.round(parseFloat(w.amount_usd) * rate * 100)

    const { error: e1 } = await db.supabase
      .from('influencer_withdrawals').update({ amount_kes: kesCents / 100 }).eq('id', w.id)
    if (e1) throw e1

    const { data: sent, error: e2 } = await db.supabase
      .from('influencer_withdrawals').select('amount_usd, amount_kes')
      .eq('user_id', w.user_id).eq('status', 'sent')
    if (e2) throw e2

    const balanceCents = (sent || []).reduce((sum, r) => sum + (
      r.amount_kes != null
        ? Math.round(parseFloat(r.amount_kes) * 100)
        : Math.round(parseFloat(r.amount_usd) * rate * 100)
    ), 0)

    const text = buildMessageText({
      id: w.id,
      when: new Date(w.simulated_at || w.created_at),
      kesCents,
      balanceCents,
    })

    const { error: e3 } = await db.supabase
      .from('influencer_withdrawals').update({ message_text: text }).eq('id', w.id)
    if (e3) throw e3

    await sendToUser(w.user_id, { title: 'MPESA', body: text, withdrawalId: w.id })
  } catch (err) {
    console.error(`[Push] Failed for withdrawal ${w && w.id}:`, err.message || err)
  }
}

module.exports = { notifyWithdrawalSent, sendToUser }
