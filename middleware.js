// middleware.js
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const { createClient } = require('@supabase/supabase-js')
const { validationResult, body, param, header } = require('express-validator')
const jwt = require('jsonwebtoken')
const db = require('./database') // service-role client — used for role checks so RLS doesn't block them
const { getCachedRole, setCachedRole } = require('./redis')

function securityHeaders() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
}

const corsOptions = {
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many attempts. Try again in 15 minutes.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
})

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, error: 'Rate limit exceeded.', code: 'RATE_LIMITED' },
})

const withdrawalLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 256,
  message: { success: false, error: 'Maximum 256 withdrawals per day.', code: 'RATE_LIMITED' },
})

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// Counters for how requests were authenticated. A growing `fallback` means
// requests are paying for a network round trip to Supabase Auth.
const authStats = { local: 0, expired: 0, fallback: 0 }

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Not authenticated.', code: 'UNAUTHORIZED' })
  }

  const token = authHeader.split(' ')[1]

  // Fast path: verify the JWT locally instead of calling Supabase Auth.
  //
  // Supabase access tokens are signed with the project's JWT secret —
  // the same secret the WebSocket layer already verifies against in
  // market.js. Doing the check in-process removes a network round trip
  // to Supabase from every authenticated request, and that call was the
  // single largest latency cost on the trade path.
  //
  // If the token can't be verified locally (no secret configured, an
  // asymmetric signing key, an expired token) we fall back to the
  // network call, so behaviour is unchanged for anything unusual.
  const local = verifyTokenDetailed(token)
  if (local.user) {
    authStats.local++
    req.user = local.user
    req.token = token
    return next()
  }

  // Signature was valid but the token has expired: no point asking Supabase
  // Auth, it would say the same thing after a network round trip.
  if (local.expired) {
    authStats.expired++
    return res.status(401).json({ success: false, error: 'Session expired or invalid.', code: 'TOKEN_EXPIRED' })
  }

  // Anything else means local verification could not be used at all (no
  // secret, a non-HS256 signing key, a malformed token). If this fires for
  // real users it is a network call on every request - see authStats.
  authStats.fallback++
  if (authStats.fallback === 1 || authStats.fallback % 100 === 0) {
    console.warn(`[auth] local JWT verification unavailable (${local.fallback}); using network fallback (count=${authStats.fallback})`)
  }

  const { data: { user }, error } = await supabaseAuth.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ success: false, error: 'Session expired or invalid.', code: 'TOKEN_EXPIRED' })
  }

  req.user = { id: user.id, email: user.email }
  req.token = token
  next()
}

// Verifies a Supabase access token against SUPABASE_JWT_SECRET without
// touching the network. Returns null when the token can't be verified
// locally, which is the signal to fall back to the network path.
function verifyTokenLocally(token) {
  return verifyTokenDetailed(token).user || null
}

// Same check, but says why it failed: { user } | { expired: true } | { fallback: reason }.
function verifyTokenDetailed(token) {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return { fallback: 'no-secret' }
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (!payload || !payload.sub) return { fallback: 'no-sub' }
    return { user: { id: payload.sub, email: payload.email || null } }
  } catch (err) {
    // jsonwebtoken checks the signature before the expiry, so this is a
    // genuine, correctly signed token that has simply run out.
    if (err && err.name === 'TokenExpiredError') return { expired: true }
    return { fallback: (err && err.name) || 'verify-failed' }
  }
}

// Role lookup with a short-lived Redis cache in front of the database.
// user_roles is read on every admin request but changes rarely, so a
// 60s TTL (plus explicit invalidation when a role is changed) removes a
// database round trip without making permission changes sluggish.
async function resolveRole(userId) {
  const cached = await getCachedRole(userId)
  if (cached) return cached

  const { data, error } = await db.supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null

  await setCachedRole(userId, data.role)
  return data.role
}

function requireRole(role) {
  return async (req, res, next) => {
    try {
      // Use the service-role client (db.supabase), not the anon `supabaseAuth`
      // client above. `supabaseAuth` never carries the caller's JWT into this
      // query, so with RLS enabled on `user_roles` it always ran as an
      // unauthenticated role and returned no rows — every admin request was
      // silently rejected with 403 even for real admins. The login route in
      // server.js already uses `db.supabase` for this exact check, so this
      // keeps the two role checks consistent.
      //
      // The result is cached in Redis for 60s (see resolveRole). The cache
      // is keyed by user id and is invalidated explicitly by
      // admin.setUserRole, so a demotion takes effect immediately.
      const userRole = await resolveRole(req.user.id)

      if (!userRole || userRole !== role) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required.',
          code: 'FORBIDDEN'
        })
      }

      req.isAdmin = true
      next()
    } catch (err) {
      res.status(403).json({ success: false, error: 'Admin access required.', code: 'FORBIDDEN' })
    }
  }
}

function requireOwnership(getResourceFn) {
  return async (req, res, next) => {
    try {
      const resource = await getResourceFn(req)
      if (!resource) {
        return res.status(404).json({ success: false, error: 'Not found.', code: 'NOT_FOUND' })
      }
      if (resource.user_id !== req.user.id && !req.isAdmin) {
        return res.status(403).json({ success: false, error: 'Access denied.', code: 'FORBIDDEN' })
      }
      req.resource = resource
      next()
    } catch (err) {
      next(err)
    }
  }
}

function validate(req, res, next) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      fields: errors.array().map(e => ({ field: e.path, message: e.msg })),
    })
  }
  next()
}

function checkIdempotency() {
  return async (req, res, next) => {
    const rawKey = req.headers['x-idempotency-key']
    if (!rawKey) {
      req.idempotencyKey = null
      req.idempotencyStore = null
      return next()
    }

    // Scope the stored key by route. idempotency_keys only has
    // UNIQUE(key, user_id) — no endpoint/action column — so if a client
    // ever reused the same raw key across two different mutating routes
    // (e.g. a deposit and, later, a withdrawal) within the 24h window,
    // this lookup would match the OTHER route's cached response and
    // return it immediately without ever running the current handler.
    // That looks like a normal 200 success to the caller — e.g. a
    // withdrawal request silently replaying an old deposit's response —
    // while writing nothing and deducting nothing. Prefixing with the
    // method+path keeps different endpoints from colliding even if the
    // raw client key is reused.
    const key = `${req.method}:${req.path}:${rawKey}`

    // These two queries have to run through the service-role client.
    // `supabaseAuth` is built with the anon key and never carries the
    // caller's JWT, so it connects as an unauthenticated role - and with
    // RLS on `idempotency_keys` (policy: auth.uid() = user_id) it saw
    // no rows on read and was rejected on write. The result was that the
    // idempotency guard never matched a replayed request and never
    // stored a response, so a retried deposit or withdrawal went
    // through a second time.
    const { data } = await db.supabase
      .from('idempotency_keys')
      .select('response, created_at')
      .eq('key', key)
      .eq('user_id', req.user.id)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)

    const cached = data && data[0]
    if (cached) {
      return res.status(200).json(cached.response)
    }
    
    req.idempotencyKey = key
    req.idempotencyStore = (response) => {
      return db.supabase.from('idempotency_keys').insert({
        key,
        user_id: req.user.id,
        response,
      })
    }
    next()
  }
}

function isValidKenyanPhone(phone) {
  if (!phone) return false
  const cleaned = phone.replace(/\s/g, '')
  const patterns = [
    /^07\d{8}$/,
    /^01\d{8}$/,
    /^2547\d{8}$/,
    /^2541\d{8}$/,
    /^7\d{8}$/,
    /^1\d{8}$/,
  ]
  return patterns.some(p => p.test(cleaned))
}

const validatePhone = (value) => {
  if (!isValidKenyanPhone(value)) {
    throw new Error('Phone must be in format 07XXXXXXXX or 01XXXXXXXX')
  }
  return true
}

const validators = {
  placeTrade: [
    body('accountType').isIn(['demo', 'real']),
    body('symbol').isIn(['V20_1S', 'V50_1S', 'V100_1S']),
    body('contractType').isIn(['rise_fall', 'over_under', 'match_differ', 'even_odd']),
    body('direction').isIn(['rise', 'fall', 'over', 'under', 'match', 'differ', 'even', 'odd']),
    body('stake').isFloat({ min: 2 }).withMessage('Minimum stake is $2'),
    body('durationTicks').isInt({ min: 2, max: 3600 }).withMessage('Minimum duration is 2 ticks (2 seconds)'),
    body('selectedDigit').optional().isInt({ min: 0, max: 9 }),
  ],

  depositMpesa: [
    header('x-idempotency-key').optional().isString().isLength({ min: 10 }),
    body('phone').custom(validatePhone),
    // ✅ UPDATED: Minimum deposit is now $4 (520 KES at ~130 rate)
    body('amountKES').isFloat({ min: 520 }).withMessage('Minimum deposit is KES 520 (~$4)'),
  ],

  withdrawMpesa: [
    header('x-idempotency-key').optional().isString().isLength({ min: 10 }),
    body('phone').custom(validatePhone),
    body('amountUSD').isFloat({ min: 2 }).withMessage('Minimum withdrawal is $2'),
  ],

  updateProfile: [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
  ],

  adminKycReview: [
    body('userId').isUUID(),
    body('status').isIn(['approved', 'rejected']),
    body('notes').optional().isString().isLength({ max: 500 }),
  ],

  adminWithdrawalReview: [
    body('withdrawalId').isUUID(),
    body('action').isIn(['approve', 'reject']),
    body('notes').optional().isString().isLength({ max: 500 }),
  ],

  setUserRole: [
    param('userId').isUUID(),
    body('role').isIn(['user', 'support', 'admin', 'tech', 'influencer']),
  ],

  // ✅ NEW: Influencer validators
  influencerWithdraw: [
    body('amountUSD').isFloat({ min: 2 }).withMessage('Minimum withdrawal is $2'),
  ],

  adminInfluencerWithdrawalReview: [
    body('notes').optional().isString().isLength({ max: 500 }),
  ],

  kycUpload: [],
}

module.exports = {
  securityHeaders,
  corsOptions,
  authLimiter,
  apiLimiter,
  withdrawalLimiter,
  authenticate,
  verifyTokenLocally,
  authStats,
  resolveRole,
  requireRole,
  requireOwnership,
  validate,
  checkIdempotency,
  validators,
  supabaseAuth,
  isValidKenyanPhone,
  validatePhone,
}