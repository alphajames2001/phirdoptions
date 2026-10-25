// database.js
const { createClient } = require('@supabase/supabase-js')
const { getCachedAccountId, setCachedAccountId, invalidateCachedRole } = require('./redis')

// Service role client — full DB access, never sent to frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Accounts ──────────────────────────────────────────────────────

// Creates the demo and real accounts for a user if they don't exist.
//
// The signup trigger (see database.sql) already inserts these
// rows on auth.users insert, so this is a fallback for users created
// without the trigger. It has to be idempotent - a plain insert runs
// into the UNIQUE(user_id, type) constraint against the rows the
// trigger already wrote.
async function ensureUserAccounts(userId) {
  const { error } = await supabase.from('accounts').upsert([
    { user_id: userId, type: 'demo', balance: 10000 },
    { user_id: userId, type: 'real', balance: 0 },
  ], { onConflict: 'user_id,type', ignoreDuplicates: true })
  if (error) throw error
}

async function getAccountsByUserId(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return data
}

async function getAccountByUserAndType(userId, type) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('type', type)
    .single()
  if (error) throw error
  return data
}

// Same as getAccountByUserAndType, but returns only the id and reads it
// from Redis first. The account row is created once at signup and never
// changes, so the id is safe to cache; the balance that lives on the
// same row deliberately isn't, since Postgres stays authoritative for
// money.
async function getAccountIdByUserAndType(userId, type) {
  const cached = await getCachedAccountId(userId, type)
  if (cached) return cached

  const { data, error } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('type', type)
    .single()
  if (error || !data) return null

  await setCachedAccountId(userId, type, data.id)
  return data.id
}

// ── Roles ─────────────────────────────────────────────────────────

// The list of email addresses that are allowed to hold the admin role.
// Compared case-insensitively so a mixed-case entry in .env still
// matches a lowercase signup.
function getAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

function isAdminEmail(email) {
  if (!email) return false
  return getAdminEmails().includes(String(email).trim().toLowerCase())
}

async function getUserRole(userId) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single()
  if (error || !data) return null
  return data.role
}

// True once the user has confirmed their email address.
//
// This gates the ADMIN_EMAILS promotion. With "Confirm email" enabled
// in Supabase, the address only gets confirmed by clicking the link
// Supabase sends, so passing this check means the caller controls the
// inbox. Without that check, anyone could register an allowlisted
// address and claim the admin role.
async function isEmailConfirmed(userId, user) {
  const fromSession = user?.email_confirmed_at
  if (fromSession !== undefined) return Boolean(fromSession)

  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) return false
  return Boolean(data.user.email_confirmed_at)
}

// Grants the admin role to a user whose email is on the ADMIN_EMAILS
// allowlist. Idempotent - re-running it just rewrites the same row.
//
// The caller is responsible for confirming the address first (see
// isEmailConfirmed).
async function promoteAdminIfAllowlisted(userId, email) {
  if (!isAdminEmail(email)) return false

  const { error } = await supabase
    .from('user_roles')
    .upsert({ user_id: userId, role: 'admin' })

  if (error) throw error

  // The role cache would otherwise keep serving the old role for up to
  // a minute after the change.
  await invalidateCachedRole(userId)

  console.log(`[roles] promoted ${email} to admin via ADMIN_EMAILS allowlist`)
  return true
}

// Atomic balance operations using Postgres functions
async function deductBalance(accountId, amount) {
  const { error } = await supabase.rpc('deduct_balance', {
    p_account_id: accountId,
    p_amount: amount,
  })
  if (error) {
    if (error.message.includes('INSUFFICIENT_BALANCE')) throw new Error('INSUFFICIENT_BALANCE')
    throw error
  }
}

async function addBalance(accountId, amount) {
  const { error } = await supabase.rpc('increment_balance', {
    p_account_id: accountId,
    p_amount: amount,
  })
  if (error) throw error
}

async function updatePL(accountId, plDelta) {
  const { error } = await supabase.rpc('update_pl', {
    p_account_id: accountId,
    p_delta: plDelta,
  })
  if (error) throw error
}

// ── Contracts ─────────────────────────────────────────────────────

// Places a trade in a single round trip.
//
// This replaces three separate calls (deductBalance + createTransaction
// + createContract) that used to run back to back over the network. The
// Postgres function does all three inside one transaction, so the
// deduction can no longer survive a failed contract insert.
//
  // See database.sql for the function body.
async function placeTrade({
  userId, accountId, symbol, contractType, direction, selectedDigit,
  stake, potentialPayout, entryPrice, entryTick, durationTicks,
}) {
  const { data, error } = await supabase.rpc('place_trade', {
    p_user_id: userId,
    p_account_id: accountId,
    p_symbol: symbol,
    p_contract_type: contractType,
    p_direction: direction,
    p_selected_digit: selectedDigit ?? null,
    p_stake: stake,
    p_potential_payout: potentialPayout,
    p_entry_price: entryPrice,
    p_entry_tick: entryTick,
    p_duration_ticks: durationTicks,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

// Settles a batch of contracts in a single round trip.
//
// Each item is { contract_id, exit_price, outcome, settled_at }. The
// function claims each contract atomically (only rows still 'open' are
// matched), credits the balance, writes the win/loss transaction and
// updates P/L. Items that were already settled come back with
// already_settled = true and no balance movement, which is what keeps a
// client-initiated settle and the engine's expiry settle from paying
// the same win twice.
//
  // See database.sql for the function body.
async function settleContracts(items) {
  const { data, error } = await supabase.rpc('settle_contracts', {
    p_items: items,
  })
  if (error) throw error
  return data || []
}

async function getOpenContractsByAccount(accountId) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

async function getContractsByAccount(accountId, { limit = 20, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('account_id', accountId)
    .neq('status', 'open')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return data
}

async function getContractById(contractId) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single()
  if (error) return null
  return data
}

async function getOpenContractsBySymbol(symbol, currentTick) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('symbol', symbol)
    .eq('status', 'open')
    .lte('entry_tick', currentTick - 1)
  if (error) throw error
  return data
}

// Every open contract, paged because PostgREST caps a response at 1000 rows
// by default. Used to load the engine's in-memory index at boot and for its
// periodic reconcile. Only the columns the engine needs are selected.
async function getAllOpenContracts() {
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('contracts')
      .select('id,user_id,symbol,contract_type,direction,selected_digit,entry_price,entry_tick,duration_ticks')
      .eq('status', 'open')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

// ── Transactions ──────────────────────────────────────────────────

async function createTransaction(data) {
  const { data: tx, error } = await supabase
    .from('transactions')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return tx
}

// database.js - Replace the getTransactionsByUser function

async function getTransactionsByUser(userId, { limit = 20, offset = 0, type, status } = {}) {
  let q = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  
  if (type) q = q.eq('type', type)
  if (status) q = q.eq('status', status)
  
  const { data, error } = await q
  if (error) throw error
  return data
}

// Also add a count function for pagination
async function getTransactionsCount(userId, { type, status } = {}) {
  let q = supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  
  if (type) q = q.eq('type', type)
  if (status) q = q.eq('status', status)
  
  const { count, error } = await q
  if (error) throw error
  return count || 0
}

async function updateTransactionStatus(transactionId, status, reference = null) {
  const update = { status }
  if (reference) update.reference = reference
  const { error } = await supabase
    .from('transactions')
    .update(update)
    .eq('id', transactionId)
  if (error) throw error
}

async function getTransactionByReference(reference) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference', reference)
    .single()
  if (error) return null
  return data
}

// ── KYC ──────────────────────────────────────────────────────────

async function createKycDocument(data) {
  const { error } = await supabase.from('kyc_documents').insert(data)
  if (error) throw error
}

async function getKycDocumentsByUser(userId) {
  const { data, error } = await supabase
    .from('kyc_documents')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return data
}

// ── Exchange rates ────────────────────────────────────────────────

// database.js - replace the getExchangeRate function

// ── Exchange rates ────────────────────────────────────────────────

// database.js - update the getExchangeRate function

async function getExchangeRate(fromCcy, toCcy) {
  // If it's USD to KES, use the exchange module
  if (fromCcy === 'USD' && toCcy === 'KES') {
    const exchange = require('./exchange')
    return exchange.getExchangeRate()
  }
  
  // Generic fallback for other pairs
  const { data } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('from_ccy', fromCcy)
    .eq('to_ccy', toCcy)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()
  return data?.rate ?? parseFloat(process.env.DEFAULT_USD_KES_RATE || '130')
}

// ── Admin: transactions & stats ─────────────────────────────────────

async function getAllTransactionsAdmin({ limit = 20, offset = 0, type, status } = {}) {
  // PostgREST never exposes the `auth` schema (see database.sql), so
  // embedding `users:auth.users(email)` here threw at the DB layer on
  // every call — that's what was surfacing as "transactions fail to
  // load" on the admin dashboard. admin.js's getAllTransactions already
  // calls attachProfiles() against `public.profiles` to attach
  // email/display_name, so this embed was both broken and redundant.
  let q = supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (type) q = q.eq('type', type)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw error
  return data
}

async function getAllTransactionsCountAdmin({ type, status } = {}) {
  let q = supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  if (type) q = q.eq('type', type)
  if (status) q = q.eq('status', status)

  const { count, error } = await q
  if (error) throw error
  return count || 0
}

async function getPlatformStats() {
  const { data, error } = await supabase.rpc('get_platform_stats').single()
  if (error) throw error
  return data
}

  async function getDailyStats() {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayISO = todayStart.toISOString()

    const [newUsersRes, depositsRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayISO),
      supabase.from('transactions').select('amount_usd').eq('type', 'deposit').eq('status', 'completed').gte('created_at', todayISO),
    ])

    if (newUsersRes.error) throw newUsersRes.error
    if (depositsRes.error) throw depositsRes.error

    let amountDeposited = 0
    if (depositsRes.data) {
      for (const t of depositsRes.data) {
        amountDeposited += parseFloat(t.amount_usd || 0)
      }
    }

    return {
      newUsers: newUsersRes.count || 0,
      amountDeposited,
    }
  }

// ── Influencer withdrawals (mock flow) ──────────────────────────────

async function createInfluencerWithdrawal(data) {
  const { data: row, error } = await supabase
    .from('influencer_withdrawals')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return row
}

async function getInfluencerWithdrawalById(id) {
  const { data, error } = await supabase
    .from('influencer_withdrawals')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

async function getInfluencerWithdrawalsByUser(userId) {
  const { data, error } = await supabase
    .from('influencer_withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

async function getAllInfluencerWithdrawals({ status } = {}) {
  // Same broken auth.users embed as getAllTransactionsAdmin above — removed
  // for the same reason. Email/display_name should be attached via
  // attachProfiles() by the caller (admin.js) if the UI needs it.
  let q = supabase
    .from('influencer_withdrawals')
    .select('*')
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw error
  return data
}

async function updateInfluencerWithdrawalStatus(id, status, { simulatedBy = null, notes = null } = {}) {
  const update = { status }
  if (status !== 'pending') {
    update.simulated_at = new Date().toISOString()
    update.simulated_by = simulatedBy
  }
  if (notes) update.notes = notes

  const { data, error } = await supabase
    .from('influencer_withdrawals')
    .update(update)
    .eq('id', id)
    .eq('status', 'pending') // atomic claim, same pattern as settleContract
    .select()
  if (error) throw error
  return data && data.length > 0 ? data[0] : null
}

module.exports = {
  supabase,
  ensureUserAccounts,
  getAccountsByUserId,
  getAccountByUserAndType,
  getAccountIdByUserAndType,
  getUserRole,
  isAdminEmail,
  isEmailConfirmed,
  promoteAdminIfAllowlisted,
  deductBalance,
  addBalance,
  updatePL,
  placeTrade,
  settleContracts,
  getOpenContractsByAccount,
  getContractsByAccount,
  getContractById,
  getOpenContractsBySymbol,
  getAllOpenContracts,
  createTransaction,
  getTransactionsByUser,
  getTransactionsCount,
  updateTransactionStatus,
  getTransactionByReference,
  createKycDocument,
  getKycDocumentsByUser,
  getExchangeRate,
  getAllTransactionsAdmin,
  getAllTransactionsCountAdmin,
  getPlatformStats,
  getDailyStats,
  createInfluencerWithdrawal,
  getInfluencerWithdrawalById,
  getInfluencerWithdrawalsByUser,
  getAllInfluencerWithdrawals,
  updateInfluencerWithdrawalStatus,
}