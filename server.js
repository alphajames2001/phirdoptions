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
const payments = require('./payments')
const market = require('./market')
const houseEdge = require('./houseEdge')
const admin = require('./admin')
const exchange = require('./exchange')
const influencer = require('./influencer')
const redis = require('./redis')

const app = express()
const httpServer = http.createServer(app)

// Behind a reverse proxy every request arrives from the proxy's IP, so
// without this the rate limiter counts ALL users as one client. Set
// TRUST_PROXY to the number of proxy hops in front of the app (usually 1).
// Left unset it does nothing, which is correct when there is no proxy:
// trusting X-Forwarded-For with no proxy lets clients spoof their IP.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY
  app.set('trust proxy', /^\d+$/.test(v) ? parseInt(v, 10) : v === 'true' ? true : v === 'false' ? false : v)
}

// ── Global middleware ──────────────────────────────────────────────

app.use(mw.securityHeaders())
app.use(cors(mw.corsOptions))
app.use(express.json({ limit: '10kb' }))
app.use(morgan('combined'))
app.use(mw.apiLimiter)

// Debug page gate: must come before static serving (see houseEdge.js).
houseEdge.registerPageGate(app)

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

// ── Trade timing (opt-in) ──────────────────────────────────────────
// TRADE_TIMING=true logs one line per trade request with the time spent in
// each stage, e.g.  [timing] POST /trade/place total=212ms auth+validate=3ms account=1ms rpc=207ms
const TRADE_TIMING = process.env.TRADE_TIMING === 'true'

function tradeTiming() {
  return (req, res, next) => {
    if (!TRADE_TIMING) return next()
    const start = process.hrtime.bigint()
    let last = start
    const parts = []
    req.timing = {
      mark(name) {
        const now = process.hrtime.bigint()
        parts.push(`${name}=${Math.round(Number(now - last) / 1e6)}ms`)
        last = now
      },
    }
    res.on('finish', () => {
      const total = Math.round(Number(process.hrtime.bigint() - start) / 1e6)
      console.log(`[timing] ${req.method} ${req.path} total=${total}ms ${parts.join(' ')}`)
    })
    next()
  }
}

const mark = (req, name) => { if (req.timing) req.timing.mark(name) }

// ── Trade routes ───────────────────────────────────────────────────

app.get('/trade/symbols', (req, res) => {
  res.json({ success: true, data: { symbols: Object.values(market.SYMBOLS) } })
})

// Outside DEBUG_MODE (accountClass === null) this is exactly the original
// parsing, which turns a numeric 0 into null (0 is falsy). In debug mode 0 is
// kept as a real barrier so the house-edge maths prices it correctly.
const parseDigit = (v, accountClass) => {
  if (accountClass) return v === undefined || v === null || v === '' ? null : parseInt(v)
  return v ? parseInt(v) : null
}

app.get('/trade/payout-preview', async (req, res, next) => {
  try {
    const { contractType, stake, direction, selectedDigit, accountType } = req.query
    if (!contractType || !stake) {
      return res.status(400).json({ 
        success: false, 
        error: 'contractType and stake required.', 
        code: 'VALIDATION_ERROR' 
      })
    }
    // Account class only matters in DEBUG_MODE (null otherwise).
    const accountClass = await houseEdge.resolveClass({
      accountType,
      userId: houseEdge.optionalUserId(req),
    })
    const payout = market.calculatePayout(contractType, parseFloat(stake), direction, parseDigit(selectedDigit, accountClass), accountClass)
    res.json({ success: true, data: { potentialPayout: payout } })
  } catch (err) { next(err) }
})

app.post('/trade/place', 
  tradeTiming(),
  mw.authenticate, 
  mw.validators.placeTrade, 
  mw.validate, 
  async (req, res, next) => {
    try {
      const { accountType, symbol, contractType, direction, selectedDigit, stake, durationTicks } = req.body
      mark(req, 'auth+validate')

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

      mark(req, 'account')

      const tick = market.getLatestTick(symbol)
      if (!tick) {
        return res.status(503).json({ 
          success: false, 
          error: 'Market not ready.', 
          code: 'MARKET_UNAVAILABLE' 
        })
      }

      // Account class only matters in DEBUG_MODE (null otherwise).
      const accountClass = await houseEdge.resolveClass({ accountType, userId: req.user.id })
      const potentialPayout = market.calculatePayout(contractType, parseFloat(stake), direction, parseDigit(selectedDigit, accountClass), accountClass)

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
      mark(req, 'rpc')

      // Mirror the new contract in the engine's in-memory index so expiry
      // is detected without polling the database.
      market.trackContract(contract)

      // DEBUG_MODE only: decide now whether this trade is a forced win/loss,
      // so every settle path agrees. No-op unless an admin targeted this account.
      houseEdge.registerContract({
        contractId: contract.id,
        userId: req.user.id,
        accountType,
        accountClass,
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

// Client-initiated settle. The engine settles every contract at its expiry
// tick on its own; this endpoint exists so the client can fetch the result
// (and as a fallback if a push was missed). It can only settle a contract
// that has EXPIRED - it is not an early-exit/cashout, which would need its
// own discounted payout instead of the stored potential_payout.
app.post('/trade/settle/:contractId',
  tradeTiming(),
  mw.authenticate,
  async (req, res, next) => {
    try {
      const { contractId } = req.params
      mark(req, 'auth')

      // The engine's in-memory index knows every open contract, and
      // contracts it settled in the last few minutes, so the common case
      // needs no database read before the settle call.
      let contract
      let isOpen
      const known = market.lookupContract(contractId)
      if (known) {
        contract = known.contract
        isOpen = known.open
      } else {
        contract = await db.getContractById(contractId)
        mark(req, 'lookup')
        if (!contract) {
          return res.status(404).json({
            success: false,
            error: 'Contract not found.',
            code: 'NOT_FOUND'
          })
        }
        isOpen = contract.status === 'open'
      }

      if (contract.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied.',
          code: 'FORBIDDEN'
        })
      }

      const tick = market.getLatestTick(contract.symbol)
      if (!tick) {
        return res.status(503).json({
          success: false,
          error: 'Market not ready.',
          code: 'MARKET_UNAVAILABLE'
        })
      }

      // An open contract cannot be settled before its expiry tick. Without
      // this check a caller could settle the moment the price moved in their
      // favour and collect the full payout.
      const expiryTick = parseInt(contract.entry_tick) + parseInt(contract.duration_ticks)
      if (isOpen && tick.tick < expiryTick) {
        return res.status(409).json({
          success: false,
          error: 'Contract has not expired yet.',
          code: 'NOT_EXPIRED',
          data: { ticksRemaining: expiryTick - tick.tick }
        })
      }

      // The exit price comes from the engine, never from the request body,
      // and is the price of the EXPIRY tick (what the engine would have used)
      // rather than whatever the latest tick is when this call arrives.
      const exitPrice = market.getTickPrice(contract.symbol, expiryTick) ?? tick.price
      const outcome = market.resolveOutcome(contract, exitPrice)

      // settle_contracts claims the contract atomically, so if the
      // engine's tick loop got there first this returns the settled
      // state with alreadySettled = true instead of paying out twice.
      const results = await db.settleContracts([
        {
          contract_id: contract.id,
          exit_price: exitPrice,
          outcome,
          settled_at: new Date().toISOString(),
        },
      ])
      mark(req, 'rpc')

      const result = results[0]
      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Contract not found.',
          code: 'NOT_FOUND'
        })
      }

      market.markSettled(result.contract_id)

      const data = {
        contractId: result.contract_id,
        outcome: result.outcome,
        exitPrice: result.exit_price !== undefined && result.exit_price !== null ? parseFloat(result.exit_price) : exitPrice,
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

// PalPluss webhook + admin provider switch (GET/PUT /admin/payments/provider)
payments.registerRoutes(app, { mw })

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

// ── Debug-only: house edge controls (inactive unless DEBUG_MODE=true) ──
houseEdge.registerRoutes(app, { mw, market })

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
  await market.startEngine()
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