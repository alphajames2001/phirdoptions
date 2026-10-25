// redis.js
// Optional Redis connection. Everything here is fail-soft on purpose:
// if Redis is missing, unreachable, or still reconnecting, the app keeps
// running against Postgres alone. Nothing in this file is allowed to be
// the reason a request fails.
//
// Today it caches role lookups (which were a network round trip on every
// admin request). It is the foundation for the trading hot path later.
//
// The "redis" package is loaded defensively so a missing dependency
// degrades to "no cache" instead of crashing the process on boot.

let createClient = null
try {
  ({ createClient } = require('redis'))
} catch {
  console.warn('[Redis] "redis" package not installed - running without Redis cache')
}

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'gw:v1'
const ROLE_TTL_SECONDS = 60
const ACCOUNT_TTL_SECONDS = 3600
const COMMAND_TIMEOUT_MS = 1000

let client = null
let connected = false

if (createClient) {
  client = createClient({
    url: REDIS_URL,
    // Fail fast instead of queueing commands while the socket is down -
    // a queued command would hang the request that issued it.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 250, 5000),
    },
  })

  client.on('error', (err) => {
    if (connected) console.warn('[Redis] Connection error:', err.message)
    connected = false
  })
  client.on('ready', () => {
    connected = true
    console.log(`[Redis] Connected to ${REDIS_URL}`)
  })
  client.on('end', () => {
    connected = false
  })
}

// ── Key helpers ─────────────────────────────────────────────────────

const keys = {
  role: (userId) => `${KEY_PREFIX}:role:${userId}`,
  account: (userId, type) => `${KEY_PREFIX}:acct:${userId}:${type}`,
}

// ── Connection lifecycle ────────────────────────────────────────────

async function connectRedis() {
  if (!client) return false
  if (client.isOpen) {
    connected = true
    return true
  }
  try {
    await client.connect()
    connected = true
    return true
  } catch (err) {
    console.warn(`[Redis] Could not connect to ${REDIS_URL} (${err.message}). Continuing without Redis.`)
    connected = false
    return false
  }
}

function isReady() {
  return connected
}

// ── Fail-soft primitives ────────────────────────────────────────────
// Each of these resolves to a safe default when Redis is unavailable, so
// callers never have to branch on connectivity themselves.

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function safeGet(key) {
  if (!connected) return null
  try {
    return await withTimeout(client.get(key), COMMAND_TIMEOUT_MS, 'GET')
  } catch (err) {
    console.warn('[Redis] GET failed:', err.message)
    return null
  }
}

async function safeSet(key, value, ttlSeconds) {
  if (!connected) return false
  try {
    await withTimeout(client.set(key, value, { EX: ttlSeconds }), COMMAND_TIMEOUT_MS, 'SET')
    return true
  } catch (err) {
    console.warn('[Redis] SET failed:', err.message)
    return false
  }
}

async function safeDel(key) {
  if (!connected) return false
  try {
    await withTimeout(client.del(key), COMMAND_TIMEOUT_MS, 'DEL')
    return true
  } catch (err) {
    console.warn('[Redis] DEL failed:', err.message)
    return false
  }
}

// ── Role cache ──────────────────────────────────────────────────────
// user_roles is read on every admin request. It changes rarely, so a
// short TTL plus explicit invalidation on role change is enough.

async function getCachedRole(userId) {
  return safeGet(keys.role(userId))
}

async function setCachedRole(userId, role) {
  return safeSet(keys.role(userId), role, ROLE_TTL_SECONDS)
}

async function invalidateCachedRole(userId) {
  return safeDel(keys.role(userId))
}

// ── Account id cache ───────────────────────────────────────────────
// A user's demo/real account row is created at signup and never
// changes, so its id is stable. Caching it removes a database round
// trip from the trade path, which only needs the id - not the balance,
// which stays authoritative in Postgres.

async function getCachedAccountId(userId, type) {
  return safeGet(keys.account(userId, type))
}

async function setCachedAccountId(userId, type, accountId) {
  return safeSet(keys.account(userId, type), accountId, ACCOUNT_TTL_SECONDS)
}

module.exports = {
  REDIS_URL,
  connectRedis,
  isReady,
  keys,
  getCachedRole,
  setCachedRole,
  invalidateCachedRole,
  getCachedAccountId,
  setCachedAccountId,
}
