// admin.js
const db = require('./database')
const { getKycStatus } = require('./auth')
const { initiatePayout } = require('./wallet')
const { invalidateCachedRole } = require('./redis')

// PostgREST never exposes the `auth` schema, so `auth.users` can't be
// embedded or queried directly from here (that was the cause of the
// 500s on /admin/kyc/pending, /admin/withdrawals/pending, /admin/users,
// /admin/audit-log). Instead we look users up in `public.profiles`
// (kept in sync by the signup trigger — see database.sql) and attach
// flat `email` / `display_name` fields onto each row.
async function attachProfiles(rows, userIdField) {
  if (!rows || rows.length === 0) return rows || []

  const ids = [...new Set(rows.map(r => r[userIdField]).filter(Boolean))]
  if (ids.length === 0) return rows

  const { data: profiles, error } = await db.supabase
    .from('profiles')
    .select('id, email, display_name')
    .in('id', ids)

  if (error) throw error

  const byId = new Map((profiles || []).map(p => [p.id, p]))
  return rows.map(row => {
    const profile = byId.get(row[userIdField])
    return {
      ...row,
      email: profile?.email || null,
      display_name: profile?.display_name || null,
    }
  })
}

async function getPendingKyc(req, res, next) {
  try {
    const { data, error } = await db.supabase
      .from('kyc_submissions')
      .select('id, user_id, status, submitted_at')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })

    if (error) throw error

    const submissions = await attachProfiles(data, 'user_id')
    res.json({ success: true, data: { submissions } })
  } catch (err) { next(err) }
}

async function getKycDetails(req, res, next) {
  try {
    const { userId } = req.params
    
    const [submission, documents] = await Promise.all([
      db.supabase
        .from('kyc_submissions')
        .select('*')
        .eq('user_id', userId)
        .single(),
      db.getKycDocumentsByUser(userId),
    ])

    res.json({
      success: true,
      data: {
        submission: submission.data,
        documents,
      },
    })
  } catch (err) { next(err) }
}

async function reviewKyc(req, res, next) {
  try {
    const { userId, status, notes } = req.body
    const adminId = req.user.id

    // Get current status
    const { data: current } = await db.supabase
      .from('kyc_submissions')
      .select('status')
      .eq('user_id', userId)
      .single()

    if (!current) {
      return res.status(404).json({
        success: false,
        error: 'KYC submission not found.',
        code: 'NOT_FOUND'
      })
    }

    if (current.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'KYC already reviewed.',
        code: 'INVALID_STATE'
      })
    }

    await db.supabase
      .from('kyc_submissions')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId,
        notes,
      })
      .eq('user_id', userId)

    await db.supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'kyc_review',
      target_type: 'user',
      target_id: userId,
      details: { status, notes },
    })

    res.json({
      success: true,
      data: { message: `KYC ${status} for user ${userId}` },
    })
  } catch (err) { next(err) }
}

async function getPendingWithdrawals(req, res, next) {
  try {
    const { data, error } = await db.supabase
      .from('withdrawal_requests')
      .select('id, user_id, amount_usd, amount_kes, phone, status, created_at')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true })

    if (error) throw error

    const withdrawals = await attachProfiles(data, 'user_id')
    res.json({ success: true, data: { withdrawals } })
  } catch (err) { next(err) }
}

async function reviewWithdrawal(req, res, next) {
  try {
    const { withdrawalId, action, notes } = req.body
    const adminId = req.user.id

    const { data: withdrawal, error } = await db.supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('id', withdrawalId)
      .single()

    if (error || !withdrawal) {
      return res.status(404).json({ 
        success: false, 
        error: 'Withdrawal not found.', 
        code: 'NOT_FOUND' 
      })
    }

    if (withdrawal.status !== 'pending_review') {
      return res.status(400).json({
        success: false,
        error: 'Withdrawal already processed.',
        code: 'INVALID_STATE',
      })
    }

    if (action === 'approve') {
      try {
        const result = await initiatePayout(
          withdrawal.phone,
          Math.round(withdrawal.amount_kes),
          'GWave Withdrawal'
        )

        await db.supabase
          .from('withdrawal_requests')
          .update({
            status: 'completed',
            approved_at: new Date().toISOString(),
            reviewed_at: new Date().toISOString(),
            reviewed_by: adminId,
            notes,
          })
          .eq('id', withdrawalId)

        await db.updateTransactionStatus(
          withdrawal.transaction_id,
          'completed',
          result.conversationId
        )

      } catch (err) {
        const account = await db.getAccountByUserAndType(withdrawal.user_id, 'real')
        await db.addBalance(account.id, parseFloat(withdrawal.amount_usd))

        await db.supabase
          .from('withdrawal_requests')
          .update({
            status: 'failed',
            reviewed_at: new Date().toISOString(),
            reviewed_by: adminId,
            notes: `Failed: ${err.message}`,
          })
          .eq('id', withdrawalId)

        await db.updateTransactionStatus(withdrawal.transaction_id, 'failed')

        return res.status(502).json({
          success: false,
          error: 'Payout failed. Balance restored.',
          code: 'PAYOUT_FAILED',
        })
      }

    } else if (action === 'reject') {
      const account = await db.getAccountByUserAndType(withdrawal.user_id, 'real')
      await db.addBalance(account.id, parseFloat(withdrawal.amount_usd))

      await db.supabase
        .from('withdrawal_requests')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminId,
          notes,
        })
        .eq('id', withdrawalId)

      await db.updateTransactionStatus(withdrawal.transaction_id, 'failed')
    }

    await db.supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'withdrawal_review',
      target_type: 'withdrawal_request',
      target_id: withdrawalId,
      details: { action, notes },
    })

    res.json({
      success: true,
      data: { message: `Withdrawal ${action}d successfully.` },
    })
  } catch (err) { next(err) }
}

async function getUsers(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const { data: profiles, error, count } = await db.supabase
      .from('profiles')
      .select('id, email, display_name, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) throw error

    const ids = profiles.map(p => p.id)

    const [{ data: roles, error: rolesErr }, { data: kyc, error: kycErr }] = await Promise.all([
      db.supabase.from('user_roles').select('user_id, role').in('user_id', ids),
      db.supabase.from('kyc_submissions').select('user_id, status').in('user_id', ids),
    ])
    if (rolesErr) throw rolesErr
    if (kycErr) throw kycErr

    const roleByUser = new Map((roles || []).map(r => [r.user_id, r.role]))
    const kycByUser = new Map((kyc || []).map(k => [k.user_id, k.status]))

    const users = profiles.map(p => ({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      created_at: p.created_at,
      role: roleByUser.get(p.id) || 'user',
      kyc_status: kycByUser.get(p.id) || 'none',
    }))

    res.json({
      success: true,
      data: {
        users,
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
      },
    })
  } catch (err) { next(err) }
}

async function setUserRole(req, res, next) {
  try {
    const { userId } = req.params
    const { role } = req.body

    if (!['user', 'support', 'admin', 'tech', 'influencer'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role.',
        code: 'VALIDATION_ERROR',
      })
    }

    await db.supabase
      .from('user_roles')
      .upsert({ user_id: userId, role })

    // The role cache is keyed by user id with a short TTL, so a stale
    // entry would keep the old role alive for up to a minute. Drop it
    // explicitly so the change takes effect immediately.
    await invalidateCachedRole(userId)

    await db.supabase.from('admin_audit_log').insert({
      admin_id: req.user.id,
      action: 'set_user_role',
      target_type: 'user',
      target_id: userId,
      details: { role },
    })

    res.json({ success: true, data: { message: `Role updated to ${role}` } })
  } catch (err) { next(err) }
}

async function getAuditLog(req, res, next) {
  try {
    const { page = 1, limit = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const { data, error } = await db.supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) throw error

    const logs = await attachProfiles(data, 'admin_id')
    res.json({
      success: true,
      data: {
        logs,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    })
  } catch (err) { next(err) }
}

// ── Admin Exchange Rate Endpoints ──────────────────────────────────

/**
 * GET /admin/exchange/rate
 * Get current rate with history
 */
async function getExchangeRateAdmin(req, res, next) {
  try {
    const exchange = require('./exchange')
    const current = await exchange.getExchangeRateWithMetadata()
    const history = await exchange.getRateHistory(24)
    
    res.json({
      success: true,
      data: {
        current,
        history,
      },
    })
  } catch (err) { next(err) }
}

/**
 * POST /admin/exchange/refresh
 * Force refresh the exchange rate
 */
async function refreshExchangeRate(req, res, next) {
  try {
    const exchange = require('./exchange')
    const rate = await exchange.forceRefreshExchangeRate()
    
    await db.supabase.from('admin_audit_log').insert({
      admin_id: req.user.id,
      action: 'refresh_exchange_rate',
      target_type: 'exchange_rate',
      details: { rate },
    })
    
    res.json({
      success: true,
      data: {
        rate,
        message: 'Exchange rate refreshed successfully',
      },
    })
  } catch (err) {
    res.status(502).json({
      success: false,
      error: 'Failed to refresh exchange rate',
      code: 'EXCHANGE_RATE_ERROR',
    })
  }
}

// ── Admin: All transactions & platform stats ───────────────────────

async function getDailyStats(req, res, next) {
  try {
    const stats = await db.getDailyStats()
    res.json({ success: true, data: stats })
  } catch (err) {
    next(err)
  }
}

/**
 * GET /admin/transactions
 * View all transactions across all users, paginated/filterable.
 */
async function getAllTransactions(req, res, next) {
  try {
    const { page = 1, limit = 20, type, status } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const [transactions, total] = await Promise.all([
      db.getAllTransactionsAdmin({ limit: parseInt(limit), offset, type, status }),
      db.getAllTransactionsCountAdmin({ type, status }),
    ])

    const withProfiles = await attachProfiles(transactions, 'user_id')

    // For withdrawal-type transactions, pull in the linked withdrawal_request
    // so the dashboard can show Approve/Reject for the ones still pending.
    const txIds = withProfiles.filter(t => t.type === 'withdrawal').map(t => t.id)
    let withdrawalByTx = new Map()
    if (txIds.length > 0) {
      const { data: wds, error: wdErr } = await db.supabase
        .from('withdrawal_requests')
        .select('id, transaction_id, status')
        .in('transaction_id', txIds)
      if (wdErr) throw wdErr
      withdrawalByTx = new Map((wds || []).map(w => [w.transaction_id, w]))
    }

    const enriched = withProfiles.map(t => {
      const wd = withdrawalByTx.get(t.id)
      return {
        ...t,
        withdrawal_request_id: wd?.id || null,
        withdrawal_request_status: wd?.status || null,
      }
    })

    res.json({
      success: true,
      data: {
        transactions: enriched,
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    })
  } catch (err) { next(err) }
}

/**
 * GET /admin/stats
 * Total balance sitting in the DB (real + demo), total deposited,
 * total withdrawn, and total mock influencer withdrawals.
 */
async function getStats(req, res, next) {
  try {
    const stats = await db.getPlatformStats()
    res.json({
      success: true,
      data: {
        totalBalanceReal: parseFloat(stats.total_balance_real || 0),
        totalBalanceDemo: parseFloat(stats.total_balance_demo || 0),
        totalDeposited: parseFloat(stats.total_deposited || 0),
        totalWithdrawn: parseFloat(stats.total_withdrawn || 0),
        totalInfluencerWithdrawn: parseFloat(stats.total_influencer_withdrawn || 0),
        totalUsers: parseInt(stats.total_users || 0),
      },
    })
  } catch (err) { next(err) }
}

// ── Admin: Influencer withdrawal simulation ─────────────────────────

/**
 * GET /admin/influencer-withdrawals
 * List influencer mock withdrawals (optionally filtered by status),
 * for the future "simulate send" interface.
 */
async function getInfluencerWithdrawals(req, res, next) {
  try {
    const { status } = req.query
    const raw = await db.getAllInfluencerWithdrawals({ status })
    const withdrawals = await attachProfiles(raw, 'user_id')
    res.json({ success: true, data: { withdrawals } })
  } catch (err) { next(err) }
}

/**
 * POST /admin/influencer-withdrawals/:id/mark-sent
 * Simulates the withdrawal having been sent off-platform. No real
 * money movement — just flips status so the demo record is accurate.
 */
async function markInfluencerWithdrawalSent(req, res, next) {
  try {
    const { id } = req.params
    const { notes } = req.body
    const adminId = req.user.id

    const claimed = await db.updateInfluencerWithdrawalStatus(id, 'sent', { simulatedBy: adminId, notes })
    if (!claimed) {
      return res.status(400).json({
        success: false,
        error: 'Withdrawal not found or already resolved.',
        code: 'INVALID_STATE',
      })
    }

    await db.supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'influencer_withdrawal_mark_sent',
      target_type: 'influencer_withdrawal',
      target_id: id,
      details: { notes },
    })

    res.json({ success: true, data: { message: 'Marked as sent.', withdrawal: claimed } })
  } catch (err) { next(err) }
}

/**
 * POST /admin/influencer-withdrawals/:id/mark-failed
 * Simulates a failed send and refunds the influencer's real balance.
 */
async function markInfluencerWithdrawalFailed(req, res, next) {
  try {
    const { id } = req.params
    const { notes } = req.body
    const adminId = req.user.id

    const claimed = await db.updateInfluencerWithdrawalStatus(id, 'failed', { simulatedBy: adminId, notes })
    if (!claimed) {
      return res.status(400).json({
        success: false,
        error: 'Withdrawal not found or already resolved.',
        code: 'INVALID_STATE',
      })
    }

    await db.addBalance(claimed.account_id, parseFloat(claimed.amount_usd))

    await db.supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      action: 'influencer_withdrawal_mark_failed',
      target_type: 'influencer_withdrawal',
      target_id: id,
      details: { notes },
    })

    res.json({ success: true, data: { message: 'Marked as failed. Balance restored.', withdrawal: claimed } })
  } catch (err) { next(err) }
}

module.exports = {
  getPendingKyc,
  getExchangeRateAdmin,
  refreshExchangeRate,
  getKycDetails,
  reviewKyc,
  getPendingWithdrawals,
  reviewWithdrawal,
  getUsers,
  setUserRole,
  getAuditLog,
  getAllTransactions,
  getStats,
  getDailyStats,
  getInfluencerWithdrawals,
  markInfluencerWithdrawalSent,
  markInfluencerWithdrawalFailed,
}