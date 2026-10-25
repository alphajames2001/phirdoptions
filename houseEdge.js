// houseEdge.js
//
// DEBUG-ONLY payout tuning.
//
// What this does: lets a developer set a target return-to-player (RTP) per
// account class (demo / influencer / normal) so payout multipliers can be
// checked against different house edges. The edge comes ONLY from the
// payout ratio:   multiplier = RTP / winProbability.
//
// It also has a second, separate tool: FORCED OUTCOMES. For testing things
// like bot stop-loss / take-profit, an admin can make a chosen account class
// or a single account win X% of the time regardless of what the market
// actually did. This DOES change the win/loss result written at settlement
// (never the ticks themselves, which stay random). See the "Forced outcomes"
// section below.
//
// What the house-edge part does NOT do: it never touches tick generation,
// outcome resolution, or settlement; only the number a winning contract pays.
//
// Safety rails:
//   - Inactive unless DEBUG_MODE=true (and NODE_ENV is not "production").
//     When inactive, every function here is a no-op and market.js keeps
//     using its normal multiplier table.
//   - Config lives in memory only. A server restart returns everything
//     to defaults.
//   - Admin routes require the admin role AND debug mode, and every change
//     is logged with the admin's user id.
//   - Payouts are stored on each contract at placement, so changing the
//     config never alters trades that are already open.
//   - Forced outcomes are likewise decided at placement and stored per
//     contract, so both settle paths (engine + /trade/settle) always agree.
//   - Forced outcomes are opt-in per class or per account: nothing is forced
//     for anyone the admin hasn't explicitly targeted.
//   - The debug PAGE itself can only be opened from the admin dashboard: the
//     dashboard mints a single-use, 30-second ticket (admin + debug mode
//     required) and the page route redeems it. Any other request, including a
//     typed or bookmarked URL, is redirected to the admin login page. The page
//     file lives OUTSIDE public/ so express.static can never serve it.

const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const db = require('./database')

const CLASSES = ['demo', 'influencer', 'real']
const RTP_MIN = 0.5
const RTP_MAX = 1.0          // no negative-edge settings
const MIN_MULTIPLIER = 1.01  // a win must always pay more than the stake

function isDebugMode() {
  return process.env.DEBUG_MODE === 'true' && process.env.NODE_ENV !== 'production'
}

// mode 'default' = market.js multiplier table, mode 'rtp' = RTP / p
const config = Object.fromEntries(
  CLASSES.map((c) => [c, { mode: 'default', rtp: 0.95 }])
)

// ── Probability model ─────────────────────────────────────────────
// Mirrors resolveOutcome() in market.js, assuming a uniform digit.

function winProbability(contractType, direction, selectedDigit) {
  switch (contractType) {
    case 'rise_fall':
    case 'even_odd':
      return 0.5
    case 'over_under': {
      const d = selectedDigit ?? 5
      return direction === 'over' ? (9 - d) / 10 : d / 10
    }
    case 'match_differ':
      return direction === 'differ' ? 0.9 : 0.1
    default:
      return null
  }
}

// Returns a multiplier override, or null to fall back to market.js defaults.
function getMultiplier(accountClass, contractType, direction, selectedDigit) {
  if (!isDebugMode() || !accountClass) return null
  const cfg = config[accountClass]
  if (!cfg || cfg.mode !== 'rtp') return null

  const p = winProbability(contractType, direction, selectedDigit)
  // p of 0 (over 9 / under 0) can never win, so there is nothing to price.
  if (!p) return null

  // Floor to 4dp so the payout never exceeds the target RTP; the epsilon stops
  // float error (0.95 / 0.1 = 9.4999...) from costing an extra step.
  const m = Math.floor((cfg.rtp / p) * 10000 + 1e-9) / 10000
  return Math.max(MIN_MULTIPLIER, m)
}

// ── Account class resolution ──────────────────────────────────────

async function resolveClass({ accountType, userId }) {
  if (!isDebugMode()) return null // zero extra work when inactive
  if (accountType === 'demo') return 'demo'
  const role = userId ? await db.getUserRole(userId) : null
  return role === 'influencer' ? 'influencer' : 'real'
}

// For routes that aren't behind mw.authenticate (payout-preview). Same
// token check handleWsConnection() uses in market.js.
function optionalUserId(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  try {
    const jwt = require('jsonwebtoken')
    return jwt.verify(token, process.env.SUPABASE_JWT_SECRET).sub || null
  } catch {
    return null
  }
}

// ── Config changes ────────────────────────────────────────────────

function setConfig(accountClass, { mode, rtp }) {
  if (!CLASSES.includes(accountClass)) throw new Error('Unknown account class.')
  if (mode !== 'default' && mode !== 'rtp') throw new Error('mode must be "default" or "rtp".')

  const next = { ...config[accountClass], mode }
  if (rtp !== undefined) {
    const n = Number(rtp)
    if (!Number.isFinite(n) || n < RTP_MIN || n > RTP_MAX) {
      throw new Error(`rtp must be between ${RTP_MIN} and ${RTP_MAX}.`)
    }
    next.rtp = Math.round(n * 1000) / 1000
  }
  config[accountClass] = next
  return next
}

function reset(accountClass) {
  const targets = accountClass ? [accountClass] : CLASSES
  for (const c of targets) {
    if (!CLASSES.includes(c)) throw new Error('Unknown account class.')
    config[c] = { mode: 'default', rtp: 0.95 }
  }
}

// ── Forced outcomes (test-only) ───────────────────────────────────
// Lets an admin make targeted accounts win X% of the time no matter what
// the market did, so stop-loss / take-profit flows can be exercised on demand.
//
// How it works:
//   1. When a trade is placed, registerContract() finds the most specific
//      matching rule (a specific account beats its class), rolls once against
//      the rule's winRate, and remembers 'win' or 'loss' for that contract id.
//   2. When the contract settles, market.resolveOutcome() passes the natural
//      result through applyForcedOutcome(), which swaps in the remembered
//      one. A forced win pays the payout stored at placement.
//   3. Contracts with no entry (nobody targeted, DEBUG_MODE off, or opened
//      before a restart) settle naturally.
//
// winRate 1 = always win, 0 = always lose, in between = random per trade.

const MAX_ACCOUNT_RULES = 25
const MAX_TRACKED_CONTRACTS = 5000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORCED_ACCOUNT_TYPES = ['any', 'demo', 'real']

const forcedClasses = Object.fromEntries(
  CLASSES.map((c) => [c, { enabled: false, winRate: 1 }])
)
const forcedAccounts = new Map()    // userId -> { winRate, accountType }
const forcedByContract = new Map()  // contractId -> 'win' | 'loss'
const forcedStats = { applied: 0, flipped: 0 }

function parseWinRate(v) {
  const n = Number(v)
  if (v === undefined || v === null || v === '' || !Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error('winRate must be a number between 0 and 1.')
  }
  return Math.round(n * 100) / 100
}

function setForcedClass(accountClass, { enabled, winRate }) {
  if (!CLASSES.includes(accountClass)) throw new Error('Unknown account class.')
  if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false.')
  const next = { enabled, winRate: forcedClasses[accountClass].winRate }
  if (winRate !== undefined) next.winRate = parseWinRate(winRate)
  forcedClasses[accountClass] = next
  return next
}

function setForcedAccount(userId, { winRate, accountType = 'any' }) {
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) throw new Error('userId must be a valid user UUID.')
  if (!FORCED_ACCOUNT_TYPES.includes(accountType)) throw new Error('accountType must be "any", "demo" or "real".')
  const id = userId.toLowerCase()
  if (!forcedAccounts.has(id) && forcedAccounts.size >= MAX_ACCOUNT_RULES) {
    throw new Error(`At most ${MAX_ACCOUNT_RULES} account rules are allowed.`)
  }
  const rule = { winRate: parseWinRate(winRate), accountType }
  forcedAccounts.set(id, rule)
  return rule
}

function removeForcedAccount(userId) {
  return forcedAccounts.delete(String(userId).toLowerCase())
}

function resetForced() {
  for (const c of CLASSES) forcedClasses[c] = { enabled: false, winRate: 1 }
  forcedAccounts.clear()
  forcedByContract.clear()
  forcedStats.applied = 0
  forcedStats.flipped = 0
}

// Most specific rule wins: a specific account beats its class.
function findForcedRule({ userId, accountType, accountClass }) {
  const acct = userId ? forcedAccounts.get(String(userId).toLowerCase()) : null
  if (acct && (acct.accountType === 'any' || acct.accountType === accountType)) return acct
  const cls = accountClass ? forcedClasses[accountClass] : null
  return cls && cls.enabled ? cls : null
}

// Called right after a trade is placed. No-op unless a rule matches.
function registerContract({ contractId, userId, accountType, accountClass }) {
  if (!isDebugMode() || !contractId) return null
  const rule = findForcedRule({ userId, accountType, accountClass })
  if (!rule) return null
  const outcome = Math.random() < rule.winRate ? 'win' : 'loss'
  forcedByContract.set(contractId, outcome)
  // Safety valve: never let this map grow without bound.
  if (forcedByContract.size > MAX_TRACKED_CONTRACTS) {
    forcedByContract.delete(forcedByContract.keys().next().value)
  }
  return outcome
}

// Called from market.resolveOutcome(). Returns the natural outcome untouched
// unless this contract was registered for a forced one.
function applyForcedOutcome(contractId, naturalOutcome) {
  if (!isDebugMode()) return naturalOutcome
  const forced = forcedByContract.get(contractId)
  if (!forced) return naturalOutcome
  forcedStats.applied++
  if (forced !== naturalOutcome) {
    forcedStats.flipped++
    console.warn(`[HouseEdge][DEBUG] contract ${contractId}: natural ${naturalOutcome} -> forced ${forced}`)
  }
  return forced
}

function forgetContract(contractId) {
  forcedByContract.delete(contractId)
}

function forcedSnapshot() {
  return {
    classes: JSON.parse(JSON.stringify(forcedClasses)),
    accounts: Array.from(forcedAccounts, ([userId, r]) => ({ userId, ...r })),
    maxAccountRules: MAX_ACCOUNT_RULES,
    stats: { ...forcedStats, pending: forcedByContract.size },
  }
}

// ── Preview table (what each bet would pay, per class) ────────────

function betList() {
  const bets = [
    { label: 'Rise', t: 'rise_fall', d: 'rise', digit: null },
    { label: 'Fall', t: 'rise_fall', d: 'fall', digit: null },
    { label: 'Even', t: 'even_odd', d: 'even', digit: null },
    { label: 'Odd', t: 'even_odd', d: 'odd', digit: null },
    { label: 'Match (any digit)', t: 'match_differ', d: 'match', digit: 5 },
    { label: 'Differ (any digit)', t: 'match_differ', d: 'differ', digit: 5 },
  ]
  for (let b = 0; b <= 8; b++) bets.push({ label: `Over ${b}`, t: 'over_under', d: 'over', digit: b })
  for (let b = 1; b <= 9; b++) bets.push({ label: `Under ${b}`, t: 'over_under', d: 'under', digit: b })
  return bets
}

function buildPreview(calculatePayout) {
  const r4 = (n) => Math.round(n * 10000) / 10000
  return betList().map((b) => {
    const p = winProbability(b.t, b.d, b.digit)
    const cell = (cls) => {
      const mult = calculatePayout(b.t, 1, b.d, b.digit, cls)
      return { mult: r4(mult), rtp: r4(mult * p) }
    }
    return {
      label: b.label,
      p,
      default: cell(null),
      classes: Object.fromEntries(CLASSES.map((c) => [c, cell(c)])),
    }
  })
}

function snapshot(market) {
  return {
    debugMode: true,
    limits: { rtpMin: RTP_MIN, rtpMax: RTP_MAX, minMultiplier: MIN_MULTIPLIER },
    config: JSON.parse(JSON.stringify(config)),
    forced: forcedSnapshot(),
    preview: buildPreview(market.calculatePayout),
  }
}

// ── Page access gate ──────────────────────────────────────────────
// The page is not a static file. It is served by this route only when the
// request carries a ticket that an authenticated admin just minted from the
// dashboard. Tickets are single-use, expire after 30s and live in memory.
// (The data endpoints stay protected by admin auth on their own.)

const PAGE_PATH = '/admin/house-edge.html'
// The page is looked up in these places, first hit wins. 'private/' is the
// intended home; the others make a misplaced file still work instead of
// failing. Access is gated by the ticket route either way.
const PAGE_CANDIDATES = [
  path.join(__dirname, 'private', 'house-edge.html'),
  path.join(__dirname, 'house-edge.html'),
  path.join(__dirname, 'public', 'admin', 'house-edge.html'),
]
function findPageFile() {
  return PAGE_CANDIDATES.find((f) => fs.existsSync(f)) || null
}
const LOGIN_PATH = '/admin/login.html'
const TICKET_TTL_MS = 30 * 1000
const MAX_TICKETS = 200
const tickets = new Map() // ticket -> { userId, expires }

function mintTicket(userId) {
  const now = Date.now()
  for (const [t, v] of tickets) if (v.expires <= now) tickets.delete(t)
  if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value)
  const ticket = crypto.randomBytes(32).toString('hex')
  tickets.set(ticket, { userId, expires: now + TICKET_TTL_MS })
  return ticket
}

// Returns the minting admin's id if the ticket was valid, else null.
// Always deletes the ticket, so a second use fails.
function redeemTicket(ticket) {
  if (typeof ticket !== 'string') return null
  const entry = tickets.get(ticket)
  tickets.delete(ticket)
  return entry && entry.expires > Date.now() ? entry.userId : null
}

// Must be registered BEFORE express.static so it wins for this path.
function registerPageGate(app) {
  app.get(PAGE_PATH, (req, res) => {
    const adminId = isDebugMode() ? redeemTicket(req.query.ticket) : null
    if (!adminId) return res.redirect(302, LOGIN_PATH)
    console.warn(`[HouseEdge][DEBUG] admin ${adminId} opened the house-edge page`)
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    const file = findPageFile()
    if (!file) {
      console.error('[HouseEdge] house-edge.html not found. Looked in:\n  ' + PAGE_CANDIDATES.join('\n  '))
      return res.status(500).send('Page unavailable: house-edge.html not found on server.')
    }
    // dotfiles:'allow' so a project path containing a dot-folder doesn't 404.
    res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'allow' }, (err) => {
      if (err) console.error('[HouseEdge] sendFile failed:', file, err.code, err.message)
      if (err && !res.headersSent) res.status(500).send('Page unavailable.')
    })
  })
}

// ── Routes ────────────────────────────────────────────────────────

function registerRoutes(app, { mw, market }) {
  if (isDebugMode()) {
    console.warn('')
    console.warn('╔══════════════════════════════════════════════════════════╗')
    console.warn('║  DEBUG_MODE is ON: house edge overrides are available.   ║')
    console.warn('║  Never enable this in production.                        ║')
    console.warn('╚══════════════════════════════════════════════════════════╝')
    console.warn('')
  }

  const adminOnly = [mw.authenticate, mw.requireRole('admin')]
  const requireDebug = (req, res, next) =>
    isDebugMode()
      ? next()
      : res.status(404).json({ success: false, error: 'Not found.', code: 'NOT_FOUND' })

  // Always answers (for admins) so the dashboard knows whether to show the link.
  app.get('/admin/debug/status', ...adminOnly, (req, res) => {
    res.json({ success: true, data: { debugMode: isDebugMode() } })
  })

  // The dashboard calls this when the admin clicks the link, then navigates
  // to the returned URL. This is the only way to obtain a ticket.
  app.post('/admin/debug/page-ticket', ...adminOnly, requireDebug, (req, res) => {
    res.json({ success: true, data: { url: `${PAGE_PATH}?ticket=${mintTicket(req.user.id)}` } })
  })

  app.get('/admin/debug/house-edge', ...adminOnly, requireDebug, (req, res) => {
    res.json({ success: true, data: snapshot(market) })
  })

  app.put('/admin/debug/house-edge', ...adminOnly, requireDebug, (req, res) => {
    try {
      const { class: accountClass, mode, rtp } = req.body || {}
      const applied = setConfig(accountClass, { mode, rtp })
      console.warn(`[HouseEdge][DEBUG] admin ${req.user.id} set ${accountClass} -> ${JSON.stringify(applied)}`)
      res.json({ success: true, data: snapshot(market) })
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' })
    }
  })

  app.post('/admin/debug/house-edge/reset', ...adminOnly, requireDebug, (req, res) => {
    try {
      const accountClass = req.body && req.body.class
      reset(accountClass)
      console.warn(`[HouseEdge][DEBUG] admin ${req.user.id} reset ${accountClass || 'ALL classes'} to defaults`)
      res.json({ success: true, data: snapshot(market) })
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' })
    }
  })
  // ── Forced outcomes ──
  app.put('/admin/debug/forced-outcome', ...adminOnly, requireDebug, (req, res) => {
    try {
      const { scope, class: accountClass, userId, enabled, winRate, accountType } = req.body || {}
      if (scope === 'class') {
        const applied = setForcedClass(accountClass, { enabled, winRate })
        console.warn(`[HouseEdge][DEBUG] admin ${req.user.id} forced-outcome class ${accountClass} -> ${JSON.stringify(applied)}`)
      } else if (scope === 'account') {
        const applied = setForcedAccount(userId, { winRate, accountType })
        console.warn(`[HouseEdge][DEBUG] admin ${req.user.id} forced-outcome account ${userId} -> ${JSON.stringify(applied)}`)
      } else {
        throw new Error('scope must be "class" or "account".')
      }
      res.json({ success: true, data: snapshot(market) })
    } catch (err) {
      res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' })
    }
  })

  app.delete('/admin/debug/forced-outcome/account/:userId', ...adminOnly, requireDebug, (req, res) => {
    removeForcedAccount(req.params.userId)
    console.warn(`[HouseEdge][DEBUG] admin ${req.user.id} removed forced-outcome rule for account ${req.params.userId}`)
    res.json({ success: true, data: snapshot(market) })
  })

  app.post('/admin/debug/forced-outcome/reset', ...adminOnly, requireDebug, (req, res) => {
    resetForced()
    console.warn(`[HouseEdge][DEBUG] admin ${req.user.id} cleared ALL forced-outcome rules`)
    res.json({ success: true, data: snapshot(market) })
  })
}

module.exports = {
  isDebugMode,
  getMultiplier,
  resolveClass,
  optionalUserId,
  registerContract,
  applyForcedOutcome,
  forgetContract,
  registerRoutes,
  registerPageGate,
  // exported for tests
  winProbability,
  setConfig,
  reset,
  setForcedClass,
  setForcedAccount,
  removeForcedAccount,
  resetForced,
}