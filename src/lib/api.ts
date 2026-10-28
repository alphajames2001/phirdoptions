// src/lib/api.ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws'

// Symbol mapping: frontend -> backend
const SYMBOL_MAP: Record<string, string> = {
  'v100_1s': 'V100_1S',
  'v50_1s': 'V50_1S', 
  'v25_1s': 'V20_1S',
}

const REVERSE_SYMBOL_MAP: Record<string, string> = {
  'V100_1S': 'v100_1s',
  'V50_1S': 'v50_1s',
  'V20_1S': 'v25_1s',
}

export function mapSymbolToBackend(frontendSymbol: string): string {
  return SYMBOL_MAP[frontendSymbol] || frontendSymbol
}

export function mapSymbolToFrontend(backendSymbol: string): string {
  return REVERSE_SYMBOL_MAP[backendSymbol] || backendSymbol
}

export function getToken(): string | null {
  return sessionStorage.getItem('gwave_token')
}

export function setToken(token: string) {
  sessionStorage.setItem('gwave_token', token)
}

export function removeToken() {
  sessionStorage.removeItem('gwave_token')
}

// typed error that carries the backend's error code and HTTP status
export class ApiError extends Error {
  code?: string
  status: number
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      removeToken()
      window.location.href = '/login'
    }
    throw new ApiError(data.error || data.message || 'API request failed', response.status, data.code)
  }

  return data
}

// ── Auth API ─────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name?: string
  displayName?: string
  role?: string
  accountType?: string
  demoBalance?: number
  realBalance?: number
}

export interface AuthResponse {
  success: boolean
  data: {
    user: User
    accounts: Array<{
      id: string
      type: 'demo' | 'real'
      balance: number
      total_pl: number
    }>
    kycStatus: 'none' | 'pending' | 'approved' | 'rejected'
    role: 'user' | 'support' | 'admin' | 'tech' | 'influencer'
  }
}

export async function getMe(): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/me')
}

export async function updateProfile(name: string) {
  return apiFetch<{ success: true; data: { message: string } }>(
    '/auth/profile',
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }
  )
}

// ── Wallet API ───────────────────────────────────────────────────

export interface BalanceResponse {
  success: true
  data: {
    demo: { usd: string; kes: string }
    real: { usd: string; kes: string }
    rate: number
  }
}

export async function getBalances(): Promise<BalanceResponse> {
  return apiFetch<BalanceResponse>('/wallet/balance')
}

export interface Transaction {
  id: string
  type: 'deposit' | 'withdrawal' | 'trade_win' | 'trade_loss' | 'stake'
  amount_usd: string
  amount_kes?: string
  method?: string
  reference?: string
  status: 'pending' | 'completed' | 'failed'
  created_at: string
}

export interface TransactionsResponse {
  success: true
  data: {
    transactions: Transaction[]
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export async function getTransactions(
  page = 1,
  limit = 20,
  type?: string,
  status?: string
): Promise<TransactionsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  })
  if (type) params.append('type', type)
  if (status) params.append('status', status)
  
  return apiFetch<TransactionsResponse>(`/wallet/transactions?${params}`)
}

export interface RateResponse {
  success: true
  data: {
    rate: number
    from: string
    to: string
    lastUpdated: string
    source: string
  }
}

export async function getExchangeRate(): Promise<RateResponse> {
  return apiFetch<RateResponse>('/wallet/rate')
}

export interface DepositResponse {
  success: true
  data: {
    reference: string
    transactionId: string
    amount: number
    currency: string
    message: string
    checkoutRequestId: string
    existing?: boolean
  }
}

export async function depositMpesa(
  phone: string,
  amountKES: number,
  idempotencyKey?: string
): Promise<DepositResponse> {
  const headers: Record<string, string> = {}
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey
  }

  let formattedPhone = phone.replace(/\s/g, '')
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.substring(1)
  } else if (formattedPhone.startsWith('7')) {
    formattedPhone = '254' + formattedPhone
  } else if (formattedPhone.startsWith('1')) {
    formattedPhone = '254' + formattedPhone
  } else if (formattedPhone.startsWith('+254')) {
    formattedPhone = formattedPhone.substring(1)
  }

  return apiFetch<DepositResponse>('/wallet/deposit/mpesa', {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: formattedPhone, amountKES }),
  })
}

export interface WithdrawResponse {
  success: true
  data: {
    withdrawalId: string
    message: string
    status: string
  }
}

export async function withdrawMpesa(
  phone: string,
  amountUSD: number,
  idempotencyKey?: string
): Promise<WithdrawResponse> {
  const headers: Record<string, string> = {}
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey
  }

  let formattedPhone = phone.replace(/\s/g, '')
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.substring(1)
  } else if (formattedPhone.startsWith('7')) {
    formattedPhone = '254' + formattedPhone
  } else if (formattedPhone.startsWith('1')) {
    formattedPhone = '254' + formattedPhone
  } else if (formattedPhone.startsWith('+254')) {
    formattedPhone = formattedPhone.substring(1)
  }

  return apiFetch<WithdrawResponse>('/wallet/withdraw/mpesa', {
    method: 'POST',
    body: JSON.stringify({ phone: formattedPhone, amountUSD }),
  })
}

// ── Normal Withdrawals (for regular users) ─────────────────────

export interface WithdrawalRequest {
  id: string
  amount_usd: string
  amount_kes: string
  phone: string
  status: 'pending_review' | 'approved' | 'processing' | 'completed' | 'rejected' | 'failed'
  created_at: string
}

export async function getWithdrawals(): Promise<{
  success: true
  data: { withdrawals: WithdrawalRequest[] }
}> {
  return apiFetch('/wallet/withdrawals')
}

// ── Influencer Withdrawals (for influencer users) ──────────────

export interface InfluencerWithdrawal {
  id: string
  amount_usd: string
  status: 'pending' | 'sent' | 'failed'
  created_at: string
  is_influencer: true // Added to identify in UI
}

export async function getInfluencerWithdrawals(): Promise<{
  success: true
  data: { withdrawals: InfluencerWithdrawal[] }
}> {
  return apiFetch('/influencer/withdrawals')
}

export interface InfluencerBalanceResponse {
  success: true
  data: {
    balance: number
    totalWithdrawn: number
    pendingWithdrawn: number
    sentWithdrawn: number
  }
}

export async function getInfluencerBalance(): Promise<InfluencerBalanceResponse> {
  return apiFetch<InfluencerBalanceResponse>('/influencer/balance')
}

export interface InfluencerWithdrawResponse {
  success: true
  data: {
    withdrawalId: string
    message: string
    status: string
    newBalance: number
  }
}

export async function requestInfluencerWithdrawal(
  amountUSD: number
): Promise<InfluencerWithdrawResponse> {
  return apiFetch<InfluencerWithdrawResponse>('/influencer/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amountUSD }),
  })
}

// ── KYC API ──────────────────────────────────────────────────────

export interface KYCStatusResponse {
  success: true
  data: {
    status: 'none' | 'pending' | 'approved' | 'rejected'
    documents: string[]
    documentsSubmitted: number
  }
}

export async function getKYCStatus(): Promise<KYCStatusResponse> {
  return apiFetch<KYCStatusResponse>('/wallet/kyc/status')
}

export async function uploadKYCDocuments(
  idFront: File,
  idBack: File,
  selfie: File
): Promise<{ success: true; data: { message: string } }> {
  const formData = new FormData()
  formData.append('id_front', idFront)
  formData.append('id_back', idBack)
  formData.append('selfie', selfie)

  const token = getToken()
  const response = await fetch(`${API_URL}/wallet/kyc/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || data.message || 'KYC upload failed')
  }
  return data
}

// ── Trade API ────────────────────────────────────────────────────

export interface Symbol {
  id: string
  label: string
  sigma: number
  tickIntervalMs: number
  startPrice: number
}

export async function getSymbols(): Promise<{
  success: true
  data: { symbols: Symbol[] }
}> {
  return apiFetch('/trade/symbols')
}

export interface PayoutPreviewResponse {
  success: true
  data: { potentialPayout: number }
}

export async function getPayoutPreview(
  contractType: string,
  stake: number,
  direction?: string,
  selectedDigit?: number
): Promise<PayoutPreviewResponse> {
  const params = new URLSearchParams({ contractType, stake: String(stake) })
  if (direction) params.append('direction', direction)
  if (selectedDigit !== undefined && selectedDigit !== null) {
    params.append('selectedDigit', String(selectedDigit))
  }
  return apiFetch<PayoutPreviewResponse>(`/trade/payout-preview?${params.toString()}`)
}

export interface PlaceTradeRequest {
  accountType: 'demo' | 'real'
  symbol: string
  contractType: string
  direction: string
  selectedDigit?: number
  stake: number
  durationTicks: number
}

export interface PlaceTradeResponse {
  success: true
  data: {
    contractId: string
    entryPrice: number
    entryTick: number
    potentialPayout: number
    expiresAtTick: number
  }
}

export async function placeTrade(trade: PlaceTradeRequest): Promise<PlaceTradeResponse> {
  const backendSymbol = mapSymbolToBackend(trade.symbol)
  return apiFetch<PlaceTradeResponse>('/trade/place', {
    method: 'POST',
    body: JSON.stringify({ ...trade, symbol: backendSymbol }),
  })
}

export interface Position {
  id: string
  symbol: string
  contract_type: string
  direction: string
  stake: string
  potential_payout: string
  entry_price: string
  entry_tick: number
  duration_ticks: number
  status: 'open' | 'settled' | 'cancelled'
  outcome?: 'win' | 'loss'
  created_at: string
}

export async function getOpenPositions(accountType: string = 'real'): Promise<{
  success: true
  data: { positions: Position[] }
}> {
  return apiFetch(`/positions/open?accountType=${accountType}`)
}

export async function getPositionHistory(
  page = 1,
  limit = 20,
  accountType = 'real'
): Promise<{
  success: true
  data: { positions: Position[]; page: number; limit: number }
}> {
  return apiFetch(`/positions/history?page=${page}&limit=${limit}&accountType=${accountType}`)
}

export async function getPosition(id: string): Promise<{
  success: true
  data: { position: Position }
}> {
  return apiFetch(`/positions/${id}`)
}

// ── Settle Trade API ─────────────────────────────────────────────

export interface SettleTradeResponse {
  success: true
  data: {
    contractId: string
    outcome: 'win' | 'loss'
    exitPrice?: number
    pnl: number
    newBalance: number
    accountType: 'demo' | 'real'
    alreadySettled?: boolean
  }
}

export async function settleTrade(
  contractId: string,
  exitPrice: number,
  accountType: 'demo' | 'real'
): Promise<SettleTradeResponse> {
  return apiFetch<SettleTradeResponse>(`/trade/settle/${contractId}`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

// ── WebSocket ────────────────────────────────────────────────────

export class MarketWebSocket {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private listeners: Map<string, Set<(data: any) => void>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private subscribedSymbols: Set<string> = new Set()
  private token: string | undefined
  private userId: string | null = null
  private intentionalClose = false

  constructor(token?: string) {
    this.token = token
  }

  connect() {
    // Never leave a previous socket attached when (re)connecting.
    this.detachSocket()
    this.intentionalClose = false
    let url = WS_URL
    if (this.token) {
      url = `${WS_URL}?token=${this.token}`
    }
    
    console.log('[WS] Connecting to:', url.replace(/token=[^&]+/, 'token=***'))
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[WS] Connected')
      this.reconnectAttempts = 0
      this.emit('connected', { connected: true })
      
      for (const symbol of this.subscribedSymbols) {
        this.subscribe(symbol)
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleMessage(data)
      } catch (err) {
        console.error('[WS] Parse error:', err)
      }
    }

    this.ws.onclose = (event) => {
      console.log('[WS] Disconnected', event.code, event.reason)
      this.emit('disconnected', { disconnected: true, code: event.code })
      if (!this.intentionalClose && event.code !== 1000) {
        this.reconnect()
      }
    }

    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error)
    }
  }

  private handleMessage(data: any) {
    const messageType = data.event ?? data.type

    switch (messageType) {
      case 'tick': {
        const frontendSymbol = mapSymbolToFrontend(data.symbol)
        const tickData = { ...data, symbol: frontendSymbol }
        this.emit('tick', tickData)
        this.emit(`tick:${frontendSymbol}`, tickData)
        break
      }

      case 'history': {
        const frontendSymbol = mapSymbolToFrontend(data.symbol)
        const historyData = { ...data, symbol: frontendSymbol }
        this.emit('history', historyData)
        break
      }

      case 'pong':
        this.emit('pong', data)
        break

      case 'contract_settled':
        console.log('[WS] Contract settled:', data)
        this.emit('contract_settled', data)
        break

      case 'transaction_updated':
        console.log('[WS] Transaction updated:', data)
        this.emit('transaction_updated', data)
        break

      case 'error':
        console.error('[WS] Error message:', data)
        this.emit('error', data)
        break

      default:
        console.log('[WS] Unknown message type:', messageType, data)
        this.emit('message', data)
    }
  }

  private reconnect() {
    if (this.reconnectTimer) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts reached')
      this.emit('error', { type: 'error', code: 'MAX_RECONNECT', message: 'Max reconnect attempts reached' })
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000)

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  subscribe(symbol: string) {
    const backendSymbol = mapSymbolToBackend(symbol)
    this.subscribedSymbols.add(symbol)
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        symbol: backendSymbol,
      }))
      console.log(`[WS] Subscribed to ${symbol} (${backendSymbol})`)
    }
  }

  unsubscribe(symbol: string) {
    const backendSymbol = mapSymbolToBackend(symbol)
    this.subscribedSymbols.delete(symbol)
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        symbol: backendSymbol,
      }))
    }
  }

  ping() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }))
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  off(event: string, callback: (data: any) => void) {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data)
        } catch (err) {
          console.error(`[WS] Error in ${event} handler:`, err)
        }
      }
    }
  }

  // Detach handlers and close the underlying socket in ANY state.
  // The old code only closed OPEN sockets, so a socket that was still
  // CONNECTING when disconnect() ran leaked: it finished connecting,
  // kept emitting ticks / 'connected' / 'disconnected' into the store,
  // and (closing abnormally) even kicked off its own reconnect loop.
  private detachSocket() {
    const sock = this.ws
    if (!sock) return
    sock.onopen = null
    sock.onmessage = null
    sock.onclose = null
    sock.onerror = null
    if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
      try { sock.close(1000, 'Disconnected by client') } catch {}
    }
    this.ws = null
  }

  disconnect() {
    this.intentionalClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.detachSocket()
    this.subscribedSymbols.clear()
    console.log('[WS] Disconnected by client')
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}