// market.js
const db = require('./database')
const houseEdge = require('./houseEdge')

const SYMBOLS = {
  V20_1S: {
    id: 'V20_1S',
    label: 'Volatility 20 (1s) Index',
    sigma: 0.0002,
    tickIntervalMs: 1000,
    startPrice: 5000,
  },
  V50_1S: {
    id: 'V50_1S',
    label: 'Volatility 50 (1s) Index',
    sigma: 0.0008,
    tickIntervalMs: 1000,
    startPrice: 8000,
  },
  V100_1S: {
    id: 'V100_1S',
    label: 'Volatility 100 (1s) Index',
    sigma: 0.002,
    tickIntervalMs: 1000,
    startPrice: 10000,
  },
}

const TICK_BUFFER_SIZE = 500

const engineState = {
  V20_1S: { price: 5000, tickCount: 0, sessionOpen: 5000 },
  V50_1S: { price: 8000, tickCount: 0, sessionOpen: 8000 },
  V100_1S: { price: 10000, tickCount: 0, sessionOpen: 10000 },
}

const tickBuffers = {
  V20_1S: [],
  V50_1S: [],
  V100_1S: [],
}

const latestTick = {
  V20_1S: null,
  V50_1S: null,
  V100_1S: null,
}

const subscribers = {
  V20_1S: new Set(),
  V50_1S: new Set(),
  V100_1S: new Set(),
}

const userConnections = new Map()

// ── Price Generation ──────────────────────────────────────────────

function gaussianRandom() {
  let u, v
  do { u = Math.random() } while (u === 0)
  do { v = Math.random() } while (v === 0)
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function nextPrice(currentPrice, sigma) {
  const change = currentPrice * sigma * gaussianRandom()
  return Math.max(0.01, parseFloat((currentPrice + change).toFixed(5)))
}

// ── Payout Calculation ────────────────────────────────────────────

const PAYOUT_MULTIPLIERS = {
  rise_fall: 4.00,
  over_under: 4.00,
  even_odd: 5.56,
  match_differ: 8.00,
}

  // Edge cases for Over/Under (barrier 0 + over, barrier 9 + under)
const OVER_UNDER_EDGE_MULTIPLIER = 2.25

// Match/Differ: 'differ' wins ~90% of time - same discounted rate as edges
const MATCH_DIFFER_DIFFER_MULTIPLIER = 2.25

// accountClass ('demo' | 'influencer' | 'real') only matters in DEBUG_MODE;
// otherwise houseEdge.getMultiplier() returns null and nothing changes.
function calculatePayout(contractType, stake, direction = null, selectedDigit = null, accountClass = null) {
  const override = houseEdge.getMultiplier(accountClass, contractType, direction, selectedDigit)
  if (override !== null) {
    return parseFloat((stake * override).toFixed(8))
  }

  let multiplier = PAYOUT_MULTIPLIERS[contractType] ?? 1.88
  
  // Special case: Over/Under edge barriers
  if (contractType === 'over_under' && direction && selectedDigit !== null) {
    const isEdge = (selectedDigit === 0 && direction === 'over') || 
                   (selectedDigit === 9 && direction === 'under')
    if (isEdge) {
      multiplier = OVER_UNDER_EDGE_MULTIPLIER
      console.log(`[Payout] Edge case detected: ${direction} ${selectedDigit}  multiplier ${multiplier}`)
    }
  }

  // Match/Differ: 'differ' has ~90% win rate
  if (contractType === 'match_differ' && direction === 'differ') {
    multiplier = MATCH_DIFFER_DIFFER_MULTIPLIER
  }
  
  return parseFloat((stake * multiplier).toFixed(8))
}

// ── Outcome Resolution ────────────────────────────────────────────

function naturalOutcome(contract, exitPrice) {
  const entry = parseFloat(contract.entry_price)
  const exit = parseFloat(exitPrice)
  const dir = contract.direction

  switch (contract.contract_type) {
    case 'rise_fall':
      return dir === 'rise' ? (exit > entry ? 'win' : 'loss')
                            : (exit < entry ? 'win' : 'loss')

    case 'over_under': {
      const selectedDigit = contract.selected_digit ?? 5
      const lastDigit = Math.floor(exit) % 10
      return dir === 'over' ? (lastDigit > selectedDigit ? 'win' : 'loss')
                            : (lastDigit < selectedDigit ? 'win' : 'loss')
    }

    case 'even_odd': {
      const lastDigit = Math.floor(exit) % 10
      return dir === 'even' ? (lastDigit % 2 === 0 ? 'win' : 'loss')
                            : (lastDigit % 2 !== 0 ? 'win' : 'loss')
    }

    case 'match_differ': {
      const selectedDigit = contract.selected_digit ?? 0
      const exitDigit = Math.floor(exit) % 10
      return dir === 'match' ? (exitDigit === selectedDigit ? 'win' : 'loss')
                             : (exitDigit !== selectedDigit ? 'win' : 'loss')
    }

    default: return 'loss'
  }
}

// Single choke point for both settle paths (engine + /trade/settle).
// Outside DEBUG_MODE, or for contracts nobody targeted, this returns the
// natural result unchanged.
function resolveOutcome(contract, exitPrice) {
  return houseEdge.applyForcedOutcome(contract.id, naturalOutcome(contract, exitPrice))
}

// ── Broadcasting ──────────────────────────────────────────────────

function broadcastTick(symbolId, tick) {
  const payload = JSON.stringify({ type: 'tick', ...tick })
  for (const ws of subscribers[symbolId]) {
    if (ws.readyState === 1) {
      ws.send(payload)
    } else {
      subscribers[symbolId].delete(ws)
    }
  }
}

function notifyUser(userId, message) {
  const connections = userConnections.get(userId)
  if (!connections) return
  const payload = JSON.stringify(message)
  for (const ws of connections) {
    if (ws.readyState === 1) ws.send(payload)
    else connections.delete(ws)
  }
}

// ── Open-contract index ───────────────────────────────────────────
// Every open contract is mirrored in memory so the tick loop never polls
// the database. The engine used to run `select * from contracts` per
// symbol every second (3 queries/sec even when nothing was open) and
// filter due contracts in JS. Now:
//   - /trade/place adds each new contract (trackContract),
//   - boot and a slow reconcile loop load anything missing from the DB,
//   - a tick only looks up the bucket that expires on that tick.
// Postgres stays authoritative: settle_contracts still claims every row
// atomically, so a drifted index can delay a settlement but never pay twice.

const SYMBOL_IDS = Object.keys(SYMBOLS)
const RECONCILE_INTERVAL_MS = 30000
const RECENT_SETTLED_TTL_MS = 5 * 60 * 1000

const openByExpiry = Object.fromEntries(SYMBOL_IDS.map((id) => [id, new Map()])) // expiryTick -> Map(id -> contract)
const dueQueue = Object.fromEntries(SYMBOL_IDS.map((id) => [id, new Map()]))     // due, waiting to be settled
const settling = Object.fromEntries(SYMBOL_IDS.map((id) => [id, false]))         // in-flight guard per symbol
const contractById = new Map()                                                    // open contracts
const recentlySettled = new Map()                                                 // id -> { contract, at }, for ownership checks

function slimContract(raw) {
  const entryTick = parseInt(raw.entry_tick)
  const durationTicks = parseInt(raw.duration_ticks)
  return {
    id: raw.id,
    user_id: raw.user_id,
    symbol: raw.symbol,
    contract_type: raw.contract_type,
    direction: raw.direction,
    selected_digit: raw.selected_digit ?? null,
    entry_price: raw.entry_price,
    entry_tick: entryTick,
    duration_ticks: durationTicks,
    expiry_tick: entryTick + durationTicks,
  }
}

// Adds an open contract row (as returned by place_trade or selected from
// the DB) to the index. Safe to call twice for the same contract.
function trackContract(raw) {
  if (!raw || !raw.id || !openByExpiry[raw.symbol]) return null
  if (contractById.has(raw.id)) return contractById.get(raw.id)

  const c = slimContract(raw)
  if (!Number.isFinite(c.expiry_tick)) return null
  contractById.set(c.id, c)

  // Already past its expiry (loaded late) - settle on the next pass.
  if (c.expiry_tick <= engineState[c.symbol].tickCount) {
    dueQueue[c.symbol].set(c.id, c)
    return c
  }

  const byExpiry = openByExpiry[c.symbol]
  let bucket = byExpiry.get(c.expiry_tick)
  if (!bucket) {
    bucket = new Map()
    byExpiry.set(c.expiry_tick, bucket)
  }
  bucket.set(c.id, c)
  return c
}

function untrackContract(id) {
  const c = contractById.get(id)
  if (!c) return
  contractById.delete(id)
  dueQueue[c.symbol].delete(id)
  const byExpiry = openByExpiry[c.symbol]
  const bucket = byExpiry.get(c.expiry_tick)
  if (bucket) {
    bucket.delete(id)
    if (bucket.size === 0) byExpiry.delete(c.expiry_tick)
  }
}

// Called once a contract is settled (by the engine or by /trade/settle).
// Keeps a short memory of it so a late client settle call can still do its
// ownership check without a database read.
function markSettled(id) {
  const c = contractById.get(id)
  if (c) recentlySettled.set(id, { contract: c, at: Date.now() })
  untrackContract(id)
  houseEdge.forgetContract(id)
}

// { contract, open } for a contract this process knows about, else null.
function lookupContract(id) {
  const open = contractById.get(id)
  if (open) return { contract: open, open: true }
  const rec = recentlySettled.get(id)
  if (rec) return { contract: rec.contract, open: false }
  return null
}

// Price of a specific tick, if it is still in the 500-tick buffer. Used so a
// contract settles at its expiry tick's price no matter when the settle runs.
function getTickPrice(symbolId, tickNumber) {
  const buf = tickBuffers[symbolId]
  const last = buf[buf.length - 1]
  if (!last) return null
  const idx = buf.length - 1 - (last.tick - tickNumber)
  if (idx < 0 || idx >= buf.length) return null
  const t = buf[idx]
  return t && t.tick === tickNumber ? t.price : null
}

function pruneRecentlySettled() {
  const cutoff = Date.now() - RECENT_SETTLED_TTL_MS
  for (const [id, rec] of recentlySettled) {
    if (rec.at < cutoff) recentlySettled.delete(id)
  }
}

// ── Contract Settlement ───────────────────────────────────────────

// Moves whatever expires on this tick into the symbol's due queue.
function collectDue(symbolId, tick) {
  const byExpiry = openByExpiry[symbolId]
  const bucket = byExpiry.get(tick)
  if (!bucket) return
  for (const c of bucket.values()) dueQueue[symbolId].set(c.id, c)
  byExpiry.delete(tick)
}

// Settles everything in the symbol's due queue in one database round trip.
// Never awaited by the tick loop. If the database call fails, the batch
// stays queued and is retried on the next tick.
async function settleDue(symbolId) {
  if (settling[symbolId]) return
  const queue = dueQueue[symbolId]
  if (queue.size === 0) return

  settling[symbolId] = true
  try {
    const batch = Array.from(queue.values())
    const currentPrice = engineState[symbolId].price
    const settledAt = new Date().toISOString()

    const items = batch.map((c) => {
      const exitPrice = getTickPrice(symbolId, c.expiry_tick) ?? currentPrice
      return {
        contract_id: c.id,
        exit_price: exitPrice,
        outcome: resolveOutcome(c, exitPrice),
        settled_at: settledAt,
      }
    })

    let results
    try {
      results = await db.settleContracts(items)
    } catch (err) {
      console.error('Settlement error for', symbolId, err)
      return // batch stays queued for the next tick
    }

    // Settled, already settled elsewhere, or unknown - none need retrying.
    for (const c of batch) markSettled(c.id)

    for (const r of results) {
      // Lost the race - some other path already settled this contract.
      if (r.already_settled) continue

      const payout = parseFloat(r.payout)
      const pnl = parseFloat(r.pl)

      if (r.outcome === 'win') {
        console.log(`[Settle] User ${r.user_id} won ${payout} on contract ${r.contract_id}`)
      } else {
        console.log(`[Settle] User ${r.user_id} lost on contract ${r.contract_id}`)
      }

      notifyUser(r.user_id, {
        type: 'contract_settled',
        contractId: r.contract_id,
        outcome: r.outcome,
        payout,
        exitPrice: parseFloat(r.exit_price),
        pnl,
      })
    }
  } finally {
    settling[symbolId] = false
  }
}

// Loads open contracts from the database into the index. Runs at boot (so
// contracts that were open across a restart are picked up) and every
// RECONCILE_INTERVAL_MS as a safety net for anything the index missed.
async function reconcileOpenContracts() {
  let rows
  try {
    rows = await db.getAllOpenContracts()
  } catch (err) {
    console.error('[Engine] Reconcile failed:', err)
    return
  }

  let added = 0
  for (const row of rows) {
    if (!contractById.has(row.id) && trackContract(row)) added++
  }
  if (added > 0) console.log(`[Engine] Reconcile: tracked ${added} open contract(s) from the database`)

  pruneRecentlySettled()
  for (const id of SYMBOL_IDS) {
    settleDue(id).catch((err) => console.error(`[Engine] settleDue failed for ${id}:`, err))
  }
}

// ── Engine ────────────────────────────────────────────────────────

async function startEngine() {
  await reconcileOpenContracts()

  for (const symbol of Object.values(SYMBOLS)) {
    setInterval(() => {
      try {
        const state = engineState[symbol.id]

        state.price = nextPrice(state.price, symbol.sigma)
        state.tickCount++

        const change = parseFloat((state.price - state.sessionOpen).toFixed(5))
        const changePct = parseFloat(((change / state.sessionOpen) * 100).toFixed(4))

        const tick = {
          symbol: symbol.id,
          price: state.price,
          tick: state.tickCount,
          change,
          changePct,
          timestamp: Date.now(),
        }

        latestTick[symbol.id] = tick

        tickBuffers[symbol.id].push(tick)
        if (tickBuffers[symbol.id].length > TICK_BUFFER_SIZE) {
          tickBuffers[symbol.id].shift()
        }

        broadcastTick(symbol.id, tick)

        // No database work on the tick path: look up what expires now and
        // hand it to settleDue, which runs in the background.
        collectDue(symbol.id, state.tickCount)
        settleDue(symbol.id).catch((err) => {
          console.error(`[Engine] settleDue failed for ${symbol.id}:`, err)
        })
      } catch (err) {
        console.error(`[Engine] Error processing tick for ${symbol.id}:`, err)
      }
    }, symbol.tickIntervalMs)
  }

  setInterval(reconcileOpenContracts, RECONCILE_INTERVAL_MS)
}

// ── WebSocket Handler ─────────────────────────────────────────────

function handleWsConnection(ws, req) {
  const url = new URL(req.url, 'http://localhost')
  const token = url.searchParams.get('token')
  let userId = null

  if (token) {
    try {
      const jwt = require('jsonwebtoken')
      const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
      userId = payload.sub
      if (!userConnections.has(userId)) userConnections.set(userId, new Set())
      userConnections.get(userId).add(ws)
    } catch {
      // Invalid token - connection still allowed for public tick stream
    }
  }

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'subscribe': {
        const sym = msg.symbol
        if (!SYMBOLS[sym]) {
          return ws.send(JSON.stringify({ 
            type: 'error', 
            code: 'INVALID_SYMBOL', 
            message: 'Unknown symbol' 
          }))
        }
        subscribers[sym].add(ws)

        ws.send(JSON.stringify({ 
          type: 'history', 
          symbol: sym, 
          ticks: tickBuffers[sym] 
        }))

        if (latestTick[sym]) {
          ws.send(JSON.stringify({ type: 'tick', ...latestTick[sym] }))
        }
        break
      }

      case 'unsubscribe':
        subscribers[msg.symbol]?.delete(ws)
        break

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        break
    }
  })

  ws.on('close', () => {
    for (const set of Object.values(subscribers)) set.delete(ws)
    if (userId) userConnections.get(userId)?.delete(ws)
  })
}

function getLatestTick(symbolId) {
  return latestTick[symbolId]
}

module.exports = {
  startEngine,
  handleWsConnection,
  getLatestTick,
  getTickPrice,
  trackContract,
  lookupContract,
  markSettled,
  calculatePayout,
  resolveOutcome,
  SYMBOLS,
  PAYOUT_MULTIPLIERS,
  OVER_UNDER_EDGE_MULTIPLIER,
}