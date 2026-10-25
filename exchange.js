// exchange.js
const db = require('./database')

// ── Exchange Rate API Integration ──────────────────────────────────

/**
 * Fetch real exchange rate from multiple providers
 */
async function fetchRealExchangeRate() {
  const providers = [
    fetchFromFrankfurter,
    fetchFromFrankfurterBackup,
    fetchFromCurrencyAPI,
    fetchFromExchangeRateAPI,
  ]

  for (const provider of providers) {
    try {
      const rate = await provider()
      if (rate && rate > 0) {
        return rate
      }
    } catch (err) {
      console.warn(`[Exchange] Provider failed: ${err.message}`)
    }
  }

  return null
}

/**
 * Frankfurter API (Primary - Working!)
 * https://api.frankfurter.dev/v2/rate/USD/KES
 * Returns: { date, base, quote, rate }
 */
async function fetchFromFrankfurter() {
  const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/KES', {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'G-Wave/1.0'
    }
  })
  
  if (!response.ok) {
    throw new Error(`Frankfurter API error: ${response.status}`)
  }
  
  const data = await response.json()
  
  // Response format: { date, base, quote, rate }
  if (!data.rate || typeof data.rate !== 'number') {
    throw new Error('Invalid response from Frankfurter')
  }
  
  return data.rate
}

/**
 * Frankfurter Backup (v1 endpoint)
 * https://api.frankfurter.app/latest?from=USD&to=KES
 */
async function fetchFromFrankfurterBackup() {
  const response = await fetch('https://api.frankfurter.app/latest?from=USD&to=KES', {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'G-Wave/1.0'
    }
  })
  
  if (!response.ok) {
    throw new Error(`Frankfurter backup error: ${response.status}`)
  }
  
  const data = await response.json()
  
  if (!data.rates || !data.rates.KES) {
    throw new Error('Invalid response from Frankfurter backup')
  }
  
  return data.rates.KES
}

/**
 * Currency API - Free, no key required
 */
async function fetchFromCurrencyAPI() {
  const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'G-Wave/1.0'
    }
  })
  
  if (!response.ok) {
    throw new Error(`Currency API error: ${response.status}`)
  }
  
  const data = await response.json()
  
  if (!data.usd || !data.usd.kes || typeof data.usd.kes !== 'number') {
    throw new Error('Invalid response from Currency API')
  }
  
  return data.usd.kes
}

/**
 * ExchangeRate-API (free tier)
 */
async function fetchFromExchangeRateAPI() {
  const response = await fetch('https://open.er-api.com/v6/latest/USD', {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'G-Wave/1.0'
    }
  })
  
  if (!response.ok) {
    throw new Error(`ExchangeRate-API error: ${response.status}`)
  }
  
  const data = await response.json()
  
  if (!data.rates || !data.rates.KES) {
    throw new Error('Invalid response from ExchangeRate-API')
  }
  
  return data.rates.KES
}

// ── Database Operations ────────────────────────────────────────────

async function updateExchangeRate(rate, source = 'frankfurter') {
  const { error } = await db.supabase
    .from('exchange_rates')
    .insert({
      from_ccy: 'USD',
      to_ccy: 'KES',
      rate: rate,
      source: source,
      updated_at: new Date().toISOString(),
    })
  
  if (error) throw error
  console.log(`[Exchange] Rate updated to ${rate} KES/USD (source: ${source})`)
}

async function getExchangeRate() {
  const { data, error } = await db.supabase
    .from('exchange_rates')
    .select('rate, updated_at, source')
    .eq('from_ccy', 'USD')
    .eq('to_ccy', 'KES')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    const fallback = parseFloat(process.env.DEFAULT_USD_KES_RATE || '130')
    console.warn(`[Exchange] No rate in DB, using fallback: ${fallback}`)
    return fallback
  }

  return data.rate
}

async function getExchangeRateWithMetadata() {
  const { data, error } = await db.supabase
    .from('exchange_rates')
    .select('rate, updated_at, source')
    .eq('from_ccy', 'USD')
    .eq('to_ccy', 'KES')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    const fallback = parseFloat(process.env.DEFAULT_USD_KES_RATE || '130')
    return {
      rate: fallback,
      updated_at: null,
      source: 'fallback',
      from: 'USD',
      to: 'KES',
    }
  }

  return {
    rate: data.rate,
    updated_at: data.updated_at,
    source: data.source || 'database',
    from: 'USD',
    to: 'KES',
  }
}

async function getRateHistory(limit = 24) {
  const { data, error } = await db.supabase
    .from('exchange_rates')
    .select('rate, updated_at, source')
    .eq('from_ccy', 'USD')
    .eq('to_ccy', 'KES')
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[Exchange] Failed to get rate history:', error)
    return []
  }

  return data || []
}

// ── Scheduled Update ──────────────────────────────────────────────

function needsUpdate(updatedAt) {
  if (!updatedAt) return true
  const age = Date.now() - new Date(updatedAt).getTime()
  return age > 5 * 60 * 1000
}

async function refreshExchangeRateIfNeeded() {
  try {
    const { data } = await db.supabase
      .from('exchange_rates')
      .select('updated_at')
      .eq('from_ccy', 'USD')
      .eq('to_ccy', 'KES')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (!needsUpdate(data?.updated_at)) {
      console.log('[Exchange] Rate is fresh, no update needed')
      return
    }

    console.log('[Exchange] Fetching fresh exchange rate...')
    const rate = await fetchRealExchangeRate()

    if (rate && rate > 0) {
      await updateExchangeRate(rate, 'frankfurter')
      console.log(`[Exchange] Rate updated to ${rate} KES/USD`)
    } else {
      console.warn('[Exchange] Could not fetch real rate, keeping existing')
    }

  } catch (err) {
    console.error('[Exchange] Failed to refresh rate:', err.message)
  }
}

async function forceRefreshExchangeRate() {
  console.log('[Exchange] Forcing exchange rate refresh...')
  const rate = await fetchRealExchangeRate()
  
  if (rate && rate > 0) {
    await updateExchangeRate(rate, 'frankfurter')
    console.log(`[Exchange] Rate forced update to ${rate} KES/USD`)
    return rate
  } else {
    throw new Error('Could not fetch exchange rate from any provider')
  }
}

// ── Start Exchange Rate Updater ──────────────────────────────────

let updateInterval = null

function startExchangeRateUpdater() {
  refreshExchangeRateIfNeeded()
  updateInterval = setInterval(refreshExchangeRateIfNeeded, 5 * 60 * 1000)
  console.log('[Exchange] Rate updater started (every 5 minutes)')
}

function stopExchangeRateUpdater() {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
    console.log('[Exchange] Rate updater stopped')
  }
}

module.exports = {
  fetchRealExchangeRate,
  fetchFromFrankfurter,
  fetchFromFrankfurterBackup,
  fetchFromCurrencyAPI,
  fetchFromExchangeRateAPI,
  updateExchangeRate,
  getExchangeRate,
  getExchangeRateWithMetadata,
  getRateHistory,
  refreshExchangeRateIfNeeded,
  forceRefreshExchangeRate,
  startExchangeRateUpdater,
  stopExchangeRateUpdater,
  needsUpdate,
}