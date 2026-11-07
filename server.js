// server.js
require('dotenv').config()

const http = require('http')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const { WebSocketServer } = require('ws')

const db = require('./database')
const mw = require('./middleware')
const auth = require('./auth')
const wallet = require('./wallet')
const market = require('./market')
const admin = require('./admin')
const exchange = require('./exchange')
const influencer = require('./influencer')
const redis = require('./redis')

const app = express()
const httpServer = http.createServer(app)

// ── Global middleware ──────────────────────────────────────────────

app.use(mw.securityHeaders())
app.use(cors(mw.corsOptions))
app.use(express.json({ limit: '10kb' }))
app.use(morgan('combined'))
app.use(mw.apiLimiter)

//static file serving
app.use(express.static('public'));

// ── Health check ───────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: redis.isReady() ? 'up' : 'down'
  })
})

// ── Admin Login ───────────────────────────────────────────────────
app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password required.',
        code: 'VALIDATION_ERROR'
      });
    }

    // Sign in using the anon-key client (mw.supabaseAuth), NOT db.supabase.
    const { data, error } = await mw.supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.',
        code: 'AUTH_FAILED'
      });
    }

    // Check if user has a role allowed through this login form
    let role = await db.getUserRole(data.user.id)

    // Emails on the ADMIN_EMAILS allowlist are promoted to admin on
    // first login. The signup trigger can't read .env, and the signup
    // webhook isn't guaranteed to fire, so without this the first
    // admin would have to be promoted by hand - and there'd be no way
    // to sign in to do it, since only an admin can change roles.
    if (role !== 'admin' && role !== 'influencer' && db.isAdminEmail(data.user.email)) {
      // Only promote an address that has actually been confirmed, so a
      // signup with an unverified allowlisted address can't claim the
      // admin role.
      if (await db.isEmailConfirmed(data.user.id, data.user)) {
        await db.promoteAdminIfAllowlisted(data.user.id, data.user.email)
        role = 'admin'
      }
    }

    if (!role || !['admin', 'influencer'].includes(role)) {
      await mw.supabaseAuth.auth.signOut();
      return res.status(403).json({
        success: false,
        error: 'Admin access required.',
        code: 'FORBIDDEN'
      });
    }

    // Warm the role cache so the first admin request doesn't have to hit
    // the database for it.
    await redis.setCachedRole(data.user.id, role);

    // Get display name - simple approach with fallback, never crashes
    let displayName = data.user.email?.split('@')[0] || 'User';
    try {
      const { data: userData } = await mw.supabaseAuth.auth.getUser(data.session.access_token);
      if (userData?.user?.user_metadata?.display_name) {
        displayName = userData.user.user_metadata.display_name;
      }
    } catch (err) {
      // Silently fall back to email-based name, never crash
      console.warn('[Login] Could not fetch user metadata, using email fallback');
    }

    res.json({
      success: true,
      data: {
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          role: role,
          displayName: displayName
        }
      }
    });
  } catch (err) {
    console.error('[Admin Login] Error:', err);
    res.status(500).json({
      success: false,
      error: 'Login failed.',
      code: 'SERVER_ERROR'
    });
  }
});

// ── Auth routes ────────────────────────────────────────────────────

app.post('/auth/on-signup', auth.onSignup)
app.get('/auth/me', mw.authenticate, auth.getMe)
app.patch('/auth/profile', mw.authenticate, mw.validators.updateProfile, mw.validate, auth.updateProfile)
app.get('/auth/profile', mw.authenticate, auth.getProfile)

// ── Trade routes ───────────────────────────────────────────────────

app.get('/trade/symbols', (req, res) => {
  res.json({ success: true, data: { symbols: Object.values(market.SYMBOLS) } })
})

app.get('/trade/payout-preview', (req, res) => {
  const { contractType, stake, direction, selectedDigit } = req.query
  if (!contractType || !stake) {
    return res.status(400).json({ 
      success: false, 
      error: 'contractType and stake required.', 
      code: 'VALIDATION_ERROR' 
    })
  }
  const payout = market.calculatePayout(contractType, parseFloat(stake), direction, selectedDigit ? parseInt(selectedDigit) : null)
  res.json({ success: true, data: { potentialPayout: payout } })
})

app.post('/trade/place', 
  mw.authenticate, 
  mw.validators.placeTrade, 
  mw.validate, 
  async (req, res, next) => {
    try {
      const { accountType, symbol, contractType, direction, selectedDigit, stake, durationTicks } = req.body

      // Only the account id is needed here, and that comes from the
      // Redis cache (falling back to the database on a miss), so the
      // trade path doesn't have to fetch the account row.
      const accountId = await db.getAccountIdByUserAndType(req.user.id, accountType)
      if (!accountId) {
        return res.status(404).json({ 
          success: false, 
          error: 'Account not found.', 
          code: 'NOT_FOUND' 
        })
      }

      const tick = market.getLatestTick(symbol)
      if (!tick) {
        return res.status(503).json({ 
          success: false, 
          error: 'Market not ready.', 
          code: 'MARKET_UNAVAILABLE' 
        })
      }

      const potentialPayout = market.calculatePayout(contractType, parseFloat(stake), direction, selectedDigit ? parseInt(selectedDigit) : null)

      // Deduct + record the stake + create the contract in one round trip
      // (place_trade does all three in a single transaction, so the stake
      // can no longer be deducted without a contract being created).
      const contract = await db.placeTrade({
        userId: req.user.id,
        accountId,
        symbol,
        contractType,
        direction,
        selectedDigit: selectedDigit ?? null,
        stake: parseFloat(stake),
        potentialPayout,
        entryPrice: tick.price,
        entryTick: tick.tick,
        durationTicks: parseInt(durationTicks),
      })

      res.json({
        success: true,
        data: {
          contractId: contract.id,
          entryPrice: tick.price,
          entryTick: tick.tick,
          potentialPayout,
          expiresAtTick: tick.tick + parseInt(durationTicks),
        },
      })
    } catch (err) {
      if (err.message && err.message.includes('INSUFFICIENT_BALANCE')) {
        return res.status(400).json({ 
          success: false, 
          error: 'Insufficient balance.', 
          code: 'INSUFFICIENT_BALANCE' 
        })
      }
      next(err)
    }
  }
)

// ── Trade Settlement Endpoint ─────────────────────────────

app.post('/trade/settle/:contractId',
  mw.authenticate,
  async (req, res, next) => {
    try {
      const { contractId } = req.params

      const contract = await db.getContractById(contractId)
      if (!contract) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found.',
          code: 'NOT_FOUND'
        })
      }

      if (contract.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied.',
          code: 'FORBIDDEN'
        })
      }

      // The exit price comes from the engine, never from the request
      // body. The client used to submit its own exitPrice and that value
      // was used to resolve the outcome, which meant the caller could
      // pick the price its own trade was settled at. The engine's live
      // tick is the authoritative price for the symbol.
      const tick = market.getLatestTick(contract.symbol)
      if (!tick) {
        return res.status(503).json({
          success: false,
          error: 'Market not ready.',
          code: 'MARKET_UNAVAILABLE'
        })
      }

      const outcome = market.resolveOutcome(contract, tick.price)

      // settle_contracts claims the contract atomically, so if the
      // engine's tick loop got there first this returns the settled
      // state with alreadySettled = true instead of paying out twice.
      const results = await db.settleContracts([
        {
          contract_id: contract.id,
          exit_price: tick.price,
          outcome,
          settled_at: new Date().toISOString(),
        },
      ])

      const result = results[0]
      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found.',
          code: 'NOT_FOUND'
        })
      }

      const data = {
        contractId: result.contract_id,
        outcome: result.outcome,
        exitPrice: result.exit_price !== undefined && result.exit_price !== null ? parseFloat(result.exit_price) : tick.price,
        pnl: parseFloat(result.pl),
        newBalance: parseFloat(result.new_balance),
        accountType: result.account_type,
      }
      if (result.already_settled) data.alreadySettled = true

      res.json({ success: true, data })
    } catch (err) {
      console.error('[Settle] Error:', err)
      next(err)
    }
  }
)

// ── Position routes ────────────────────────────────────────────────

app.get('/positions/open', 
  mw.authenticate, 
  async (req, res, next) => {
    try {
      const { accountType = 'real' } = req.query
      const accountId = await db.getAccountIdByUserAndType(req.user.id, accountType)
      if (!accountId) {
        return res.status(404).json({ success: false, error: 'Account not found.', code: 'NOT_FOUND' })
      }
      const positions = await db.getOpenContractsByAccount(accountId)
      res.json({ success: true, data: { positions } })
    } catch (err) { next(err) }
  }
)

app.get('/positions/history', 
  mw.authenticate, 
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, accountType = 'real' } = req.query
      const accountId = await db.getAccountIdByUserAndType(req.user.id, accountType)
      if (!accountId) {
        return res.status(404).json({ success: false, error: 'Account not found.', code: 'NOT_FOUND' })
      }
      const positions = await db.getContractsByAccount(accountId, {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
      })
      res.json({ 
        success: true, 
        data: { 
          positions, 
          page: parseInt(page), 
          limit: parseInt(limit) 
        } 
      })
    } catch (err) { next(err) }
  }
)

app.get('/positions/:id',
  mw.authenticate,
  mw.requireOwnership(req => db.getContractById(req.params.id)),
  (req, res) => res.json({ success: true, data: { position: req.resource } })
)

// ── Wallet routes ──────────────────────────────────────────────────

app.get('/wallet/balance', mw.authenticate, wallet.getBalance)
app.get('/wallet/transactions', 
  mw.authenticate, 
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20, type, status } = req.query
      const offset = (parseInt(page) - 1) * parseInt(limit)
      
      const transactions = await db.getTransactionsByUser(req.user.id, {
        limit: parseInt(limit), 
        offset, 
        type,
        status,
      })
      
      const total = await db.getTransactionsCount(req.user.id, { type, status })
      
      res.json({ 
        success: true, 
        data: { 
          transactions, 
          page: parseInt(page), 
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        } 
      })
    } catch (err) { next(err) }
  }
)
app.get('/wallet/rate', wallet.getRateHandler)
app.get('/wallet/withdrawals', mw.authenticate, wallet.getWithdrawals)

app.post('/wallet/deposit/mpesa', 
  mw.authenticate, 
  mw.checkIdempotency(),
  mw.validators.depositMpesa, 
  mw.validate, 
  wallet.depositMpesa
)

app.post('/wallet/mpesa/callback', wallet.mpesaCallback)

app.post('/wallet/withdraw/mpesa', 
  mw.authenticate, 
  mw.withdrawalLimiter,
  mw.checkIdempotency(),
  mw.validators.withdrawMpesa, 
  mw.validate, 
  wallet.withdrawMpesa
)

app.post('/wallet/kyc/upload', 
  mw.authenticate, 
  wallet.kycUpload.fields([
    { name: 'id_front', maxCount: 1 },
    { name: 'id_back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]), 
  wallet.uploadKycDocuments
)

app.get('/wallet/kyc/status', mw.authenticate, wallet.getKycStatusHandler)

// ── Test Routes (Development Only) ────────────────────────────────

if (process.env.NODE_ENV === 'development') {
  app.post('/wallet/test/complete/:reference',
    mw.authenticate,
    wallet.completeTransactionManually
  )
  
  app.get('/wallet/test/status', (req, res) => {
    res.json({
      success: true,
      data: {
        mode: 'mock',
        message: 'M-Pesa is running in mock mode for local testing',
        endpoints: {
          deposit: 'POST /wallet/deposit/mpesa',
          complete: 'POST /wallet/test/complete/:reference',
          withdraw: 'POST /wallet/withdraw/mpesa',
        }
      }
    })
  })
}

// ── Admin routes ───────────────────────────────────────────────────

app.get('/admin/kyc/pending', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  admin.getPendingKyc
)

app.get('/admin/kyc/:userId', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  admin.getKycDetails
)

app.post('/admin/kyc/review', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  mw.validators.adminKycReview, 
  mw.validate, 
  admin.reviewKyc
)

app.get('/admin/withdrawals/pending', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  admin.getPendingWithdrawals
)

app.post('/admin/withdrawals/review', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  mw.validators.adminWithdrawalReview, 
  mw.validate, 
  admin.reviewWithdrawal
)

app.get('/admin/users', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  admin.getUsers
)

app.post('/admin/users/:userId/role', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  mw.validators.setUserRole, 
  mw.validate, 
  admin.setUserRole
)

app.get('/admin/audit-log', 
  mw.authenticate, 
  mw.requireRole('admin'), 
  admin.getAuditLog
)

app.get('/admin/exchange/rate',
  mw.authenticate,
  mw.requireRole('admin'),
  admin.getExchangeRateAdmin
)

app.post('/admin/exchange/refresh',
  mw.authenticate,
  mw.requireRole('admin'),
  admin.refreshExchangeRate
)

app.get('/admin/transactions',
  mw.authenticate,
  mw.requireRole('admin'),
  admin.getAllTransactions
  )
  
  app.get('/admin/stats',
    mw.authenticate,
    mw.requireRole('admin'),
    admin.getStats
  )
  app.get('/admin/stats/daily',
    mw.authenticate,
    mw.requireRole('admin'),
    admin.getDailyStats
  )

app.get('/admin/influencer-withdrawals',
  mw.authenticate,
  mw.requireRole('admin'),
  admin.getInfluencerWithdrawals
)

app.post('/admin/influencer-withdrawals/:id/mark-sent',
  mw.authenticate,
  mw.requireRole('admin'),
  mw.validators.adminInfluencerWithdrawalReview,
  mw.validate,
  admin.markInfluencerWithdrawalSent
)

app.post('/admin/influencer-withdrawals/:id/mark-failed',
  mw.authenticate,
  mw.requireRole('admin'),
  mw.validators.adminInfluencerWithdrawalReview,
  mw.validate,
  admin.markInfluencerWithdrawalFailed
)

// ── Influencer routes ───────────────────────────────────────────────

app.get('/influencer/balance',
  mw.authenticate,
  mw.requireRole('influencer'),
  influencer.getBalance
)

app.get('/influencer/withdrawals',
  mw.authenticate,
  mw.requireRole('influencer'),
  influencer.getWithdrawals
)

app.post('/influencer/withdraw',
  mw.authenticate,
  mw.requireRole('influencer'),
  mw.withdrawalLimiter,
  mw.validators.influencerWithdraw,
  mw.validate,
  influencer.requestWithdrawal
)

app.post('/influencer/device-token',
  mw.authenticate,
  mw.requireRole('influencer'),
  influencer.registerDevice
)

app.post('/influencer/reset-international-transfers',
  mw.authenticate,
  mw.requireRole('influencer'),
  influencer.resetInternationalTransfers
)

// ── Global error handler ───────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.stack || err.message || err)
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error.', 
    code: 'SERVER_ERROR' 
  })
})

// ── WebSocket server ───────────────────────────────────────────────

const wss = new WebSocketServer({ 
  server: httpServer, 
  path: '/ws'
})

wss.on('connection', (ws, req) => {
  market.handleWsConnection(ws, req)
})

// ── Boot sequence ──────────────────────────────────────────────────

async function start() {
  console.log('[G Wave] Starting engine...')
  
  // Redis is optional. If it isn't reachable the app still boots and
  // everything still works - just without the cache.
  await redis.connectRedis()
  
  exchange.startExchangeRateUpdater()
  market.startEngine()
  console.log('[G Wave] Market engine started')

  const port = process.env.PORT || 4000
  httpServer.listen(port, () => {
    console.log(`[G Wave] API: http://localhost:${port}`)
    console.log(`[G Wave] WS: ws://localhost:${port}/ws`)
    console.log(`[G Wave] Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`[G Wave] Redis: ${redis.isReady() ? 'connected' : 'unavailable (running without cache)'}`)
  })
}

start().catch(err => {
  console.error('[G Wave] Boot failed:', err)
  process.exit(1)
})

process.on('SIGTERM', () => {
  console.log('[G Wave] Shutting down...')
  exchange.stopExchangeRateUpdater()
  httpServer.close(() => {
    console.log('[G Wave] Server closed')
    process.exit(0)
  })
})