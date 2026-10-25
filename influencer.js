// influencer.js
// Mock withdrawal flow for influencer demo accounts. No real payout happens
// here — money is moved out of the influencer's real balance into the
// influencer_withdrawals table so their on-screen balance behaves exactly
// like a real withdrawal would, and a separate admin/tech interface later
// simulates the "send" step. See migration_roles_influencer.sql.

const db = require('./database')

// ── GET /influencer/balance ──────────────────────────────────────────

async function getBalance(req, res, next) {
  try {
    const account = await db.getAccountByUserAndType(req.user.id, 'real')
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Real account not found.',
        code: 'NOT_FOUND',
      })
    }

    const withdrawals = await db.getInfluencerWithdrawalsByUser(req.user.id)
    const totalWithdrawn = withdrawals.reduce((sum, w) => sum + parseFloat(w.amount_usd), 0)
    const pending = withdrawals.filter(w => w.status === 'pending')
      .reduce((sum, w) => sum + parseFloat(w.amount_usd), 0)
    const sent = withdrawals.filter(w => w.status === 'sent')
      .reduce((sum, w) => sum + parseFloat(w.amount_usd), 0)

    res.json({
      success: true,
      data: {
        balance: parseFloat(account.balance),
        totalWithdrawn,
        pendingWithdrawn: pending,
        sentWithdrawn: sent,
      },
    })
  } catch (err) { next(err) }
}

// ── GET /influencer/withdrawals ──────────────────────────────────────

async function getWithdrawals(req, res, next) {
  try {
    const withdrawals = await db.getInfluencerWithdrawalsByUser(req.user.id)
    res.json({ success: true, data: { withdrawals } })
  } catch (err) { next(err) }
}

// ── POST /influencer/withdraw ────────────────────────────────────────

async function requestWithdrawal(req, res, next) {
  try {
    const { amountUSD } = req.body
    const userId = req.user.id

    const account = await db.getAccountByUserAndType(userId, 'real')
    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Real account not found.',
        code: 'NOT_FOUND',
      })
    }

    if (parseFloat(account.balance) < amountUSD) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance.',
        code: 'INSUFFICIENT_BALANCE',
      })
    }

    // Deduct immediately — same "deduct now, resolve later" pattern used
    // for real withdrawal_requests, so the influencer's balance reflects
    // the withdrawal right away even though nothing has actually been sent.
    await db.deductBalance(account.id, amountUSD)

    const withdrawal = await db.createInfluencerWithdrawal({
      user_id: userId,
      account_id: account.id,
      amount_usd: amountUSD,
      status: 'pending',
    })

    const transaction = await db.createTransaction({
      user_id: userId,
      type: 'withdrawal',
      amount_usd: amountUSD,
      status: 'pending',
      metadata: { mock: true, influencer_withdrawal_id: withdrawal.id },
    })

    // ── Auto-complete after a short delay ──────────────────────────────
    // Since this is a mock flow for influencers, we auto-complete the
    // withdrawal after 2 seconds to simulate the money being sent to M-PESA.
    // This removes the need for admin approval and makes the demo flow smooth.
    setTimeout(async () => {
      try {
        // Mark the influencer withdrawal as 'sent' (simulating money sent to M-PESA)
        const claimed = await db.updateInfluencerWithdrawalStatus(
          withdrawal.id, 
          'sent', 
          { 
            simulatedBy: userId, 
            notes: 'Auto-completed (mock flow)' 
          }
        )

        if (claimed) {
          // Update the transaction status to 'completed'
          await db.updateTransactionStatus(transaction.id, 'completed')
          console.log(`[Influencer] Auto-completed withdrawal ${withdrawal.id} for user ${userId}`)
        } else {
          console.warn(`[Influencer] Withdrawal ${withdrawal.id} already resolved, skipping auto-complete`)
        }
      } catch (err) {
        console.error(`[Influencer] Failed to auto-complete withdrawal ${withdrawal.id}:`, err.message)
      }
    }, 2000) // 2 second delay

    // Return immediately with pending status, but it will auto-complete shortly
    res.json({
      success: true,
      data: {
        withdrawalId: withdrawal.id,
        message: 'Withdrawal recorded and will be sent to your M-PESA shortly.',
        status: 'pending',
        newBalance: parseFloat(account.balance) - amountUSD,
      },
    })
  } catch (err) {
    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ success: false, error: 'Insufficient balance.', code: 'INSUFFICIENT_BALANCE' })
    }
    next(err)
  }
}

async function resetInternationalTransfers(req, res, next) {
  try {
    const userId = req.user.id
    const { data: account, error: accErr } = await db.supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('type', 'real')
      .single()

    if (accErr || !account) {
      return res.status(404).json({ success: false, error: 'Account not found.', code: 'NOT_FOUND' })
    }

    const { data: withdrawals } = await db.supabase
      .from('influencer_withdrawals')
      .select('id')
      .eq('user_id', userId)

    if (withdrawals && withdrawals.length > 0) {
      const ids = withdrawals.map(w => w.id)
      const { error: delErr } = await db.supabase
        .from('influencer_withdrawals')
        .delete()
        .in('id', ids)
      if (delErr) throw delErr
    }

    res.json({ success: true, data: { message: 'International transfers reset to 0' } })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getBalance,
  getWithdrawals,
  requestWithdrawal,
  resetInternationalTransfers,
}