// src/lib/ai-engine.ts
import { type VolatilityId, type Direction, type ContractType, type RiskTolerance, VOLATILITIES, CONTRACTS, PAYOUT_MULTIPLIER, OVER_UNDER_EDGE_MULTIPLIER, STAKE_RANGES, NEGATIVE_DIRECTIONS } from './store';

// ✅ FIXED: 'differ' wins on ~90% of digits and must be paid out at the same
// reduced rate as the other ~90%-win-rate contracts (mirrors
// OVER_UNDER_EDGE_MULTIPLIER), not at the ~10%-win-rate 'match' rate.
// This MUST stay in sync with MATCH_DIFFER_DIFFER_MULTIPLIER in the
// backend's market.js — that file is the authoritative payout source.
const MATCH_DIFFER_DIFFER_MULTIPLIER = 1.19;

// ✅ NEW: digit 9 is not a selectable Over/Under barrier (mirrors the real
// platform). Must stay in sync with OVER_UNDER_MAX_DIGIT in market.js.
const MAX_OVER_UNDER_DIGIT = 8;

export interface MarketData {
  symbol: VolatilityId;
  price: number;
  prevPrice: number;
  change: number;
  changePct: number;
  volatility: number; // sigma
  tickCount?: number;
  lastDigit: number; // Last digit of current price
}

export interface AIDecision {
  symbol: VolatilityId;
  contract: ContractType;
  direction: Direction;
  barrier?: number; // For Over/Under and Match/Differ
  confidence: number; // 0-100
  score: number; // 0-100 raw score
  expectedValue: number; // Expected profit per $1 staked
  winRate: number; // Estimated win rate 0-1
  reasoning: {
    market: string;
    contract: string;
    direction: string;
    barrier?: string;
    volatility: string;
    trend: string;
    reversion: string;
    winRate: string;
    risk: string;
    expectedValue: string;
    historicalAccuracy?: string;
    sampleSize?: string;
  };
  suggestedStake: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  timestamp: number;
}

export interface AIPerformance {
  totalDecisions: number;
  wins: number;
  losses: number;
  totalPnl: number;
  symbolPerformance: Record<VolatilityId, { wins: number; losses: number; pnl: number; trades: number }>;
  contractPerformance: Record<ContractType, { wins: number; losses: number; pnl: number; trades: number }>;
  // ✅ NEW: Detailed historical performance by contract type + direction + barrier
  detailedPerformance: Map<string, { wins: number; losses: number; trades: number }>;
}

interface TradeHistory {
  id?: string; // Trade ID for deduplication
  symbol: VolatilityId;
  contract: ContractType;
  direction: Direction;
  barrier?: number;
  outcome: 'win' | 'loss';
  pnl: number;
  timestamp?: number;
}

// ── Contract Configuration ────────────────────────────────────────

interface ContractOption {
  contract: ContractType;
  direction: Direction;
  barrier?: number;
  label: string;
  winRate: number; // Estimated win rate based on market conditions
  expectedValue: number; // EV = winRate * payout - (1-winRate) * stake
  payoutMultiplier: number;
}

// ── AI Engine ──────────────────────────────────────────────────────

export class AIEngine {
  private tradeHistory: TradeHistory[] = [];
  private maxHistorySize = 500; // ✅ Increased for better statistics
  private decisions: AIDecision[] = [];
  private lastDecision: AIDecision | null = null;
  private performance: AIPerformance;

  constructor(initialHistory?: TradeHistory[]) {
    this.performance = {
      totalDecisions: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      symbolPerformance: {
        v100_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        v50_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        v25_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
      },
      contractPerformance: {
        rise_fall: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        over_under: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        match_differ: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        even_odd: { wins: 0, losses: 0, pnl: 0, trades: 0 },
      },
      // ✅ NEW: Detailed performance map
      detailedPerformance: new Map(),
    };

    if (initialHistory) {
      this.tradeHistory = initialHistory.slice(-this.maxHistorySize);
      this.updatePerformanceFromHistory();
    }
  }

  // ── Public Methods ──────────────────────────────────────────────

  /**
   * Evaluate ALL markets and ALL contracts, return the best combination.
   * If `lockedContract` is given, only that contract type is considered —
   * the AI still picks whichever market (volatility) and direction/barrier
   * scores best for that contract.
   */
  public evaluate(
    markets: MarketData[],
    balance: number,
    riskTolerance: RiskTolerance = 'moderate',
    lockedContract?: ContractType
  ): AIDecision | null {
    if (markets.length === 0) return null;

    // Generate all possible trade combinations
    const allOptions: (ContractOption & { market: MarketData; score: number })[] = [];

    for (const market of markets) {
      // Generate options for each contract type
      let options = this.generateContractOptions(market);
      // If the person has locked in a contract type, restrict to it —
      // the AI still evaluates every market for the best direction/barrier.
      if (lockedContract) {
        options = options.filter((o) => o.contract === lockedContract);
      }
      for (const option of options) {
        // Calculate score for this combination
        const score = this.calculateCombinationScore(market, option, riskTolerance);
        allOptions.push({
          ...option,
          market,
          score,
        });
      }
    }

    // Sort by score (highest first)
    const sorted = allOptions.sort((a, b) => b.score - a.score);

    // Get the best option
    const best = sorted[0];
    if (!best || best.score < 30) {
      return null;
    }

    // Apply risk tolerance threshold
    const threshold = riskTolerance === 'conservative' ? 65 : riskTolerance === 'moderate' ? 50 : 35;
    if (best.score < threshold) {
      return null;
    }

    // Build the decision
    const confidence = Math.min(95, best.score);
    const decision = this.buildDecision(best, balance, confidence, riskTolerance);

    this.decisions.push(decision);
    this.lastDecision = decision;

    return decision;
  }

  /**
   * Generate all possible contract options for a market
   * ✅ FIXED: Uses historical data for win rate estimation
   */
  private generateContractOptions(market: MarketData): ContractOption[] {
    const options: ContractOption[] = [];
    const lastDigit = market.lastDigit;

    // ── Rise/Fall ──────────────────────────────────────────────────
    const trendScore = this.calculateTrendScore(market);
    const direction = trendScore > 50 ? 'rise' : 'fall';
    const rfPayout = PAYOUT_MULTIPLIER.rise_fall;
    const rfWinRate = this.estimateHistoricalWinRate(market.symbol, 'rise_fall', direction as Direction);
    
    options.push({
      contract: 'rise_fall',
      direction: direction as Direction,
      barrier: undefined,
      label: `${direction.toUpperCase()}`,
      winRate: rfWinRate,
      expectedValue: rfWinRate * rfPayout - (1 - rfWinRate),
      payoutMultiplier: rfPayout,
    });

    // ── Over/Under ─────────────────────────────────────────────────
    const ouPayout = PAYOUT_MULTIPLIER.over_under;
    
    // Over 0 — wins on digits 1-9 (90% theoretical)
    // ✅ FIXED: this is the reduced-payout edge case in market.js, not the
    // flat over_under rate — was previously inflating this option's EV to
    // ~+1.59/$1 (real EV is ~-0.03/$1), which made it dominate the score.
    options.push({
      contract: 'over_under',
      direction: 'over' as Direction,
      barrier: 0,
      label: 'Over 0',
      winRate: this.estimateHistoricalWinRate(market.symbol, 'over_under', 'over', 0),
      expectedValue: this.calculateExpectedValue(market.symbol, 'over_under', 'over', 0, OVER_UNDER_EDGE_MULTIPLIER),
      payoutMultiplier: OVER_UNDER_EDGE_MULTIPLIER,
    });

    // ✅ REMOVED: 'Under 9' (barrier 9) — digit 9 is no longer a selectable
    // barrier for Over/Under, matching the real platform's restriction. This
    // was also the highest-probability, lowest-payout option available, so
    // dropping it removes one of the easiest bets to lean on repeatedly.
    // MAX_OVER_UNDER_DIGIT below documents the allowed barrier range (0-8)
    // for any future digit-sweep options — keep it in sync with market.js's
    // OVER_UNDER_MAX_DIGIT if either changes.

    // Over 5 — wins if lastDigit > 5 (40% theoretical)
    options.push({
      contract: 'over_under',
      direction: 'over' as Direction,
      barrier: 5,
      label: 'Over 5',
      winRate: this.estimateHistoricalWinRate(market.symbol, 'over_under', 'over', 5),
      expectedValue: this.calculateExpectedValue(market.symbol, 'over_under', 'over', 5, ouPayout),
      payoutMultiplier: ouPayout,
    });

    // Under 5 — wins if lastDigit < 5 (50% theoretical)
    options.push({
      contract: 'over_under',
      direction: 'under' as Direction,
      barrier: 5,
      label: 'Under 5',
      winRate: this.estimateHistoricalWinRate(market.symbol, 'over_under', 'under', 5),
      expectedValue: this.calculateExpectedValue(market.symbol, 'over_under', 'under', 5, ouPayout),
      payoutMultiplier: ouPayout,
    });

    // ── Match/Differ ──────────────────────────────────────────────
    const mdPayout = PAYOUT_MULTIPLIER.match_differ; // 'match' rate only (~10% win rate)
    
    // Match each digit 0-9 (10% theoretical each)
    for (let digit = 0; digit <= 9; digit++) {
      options.push({
        contract: 'match_differ',
        direction: 'match' as Direction,
        barrier: digit,
        label: `Match ${digit}`,
        winRate: this.estimateHistoricalWinRate(market.symbol, 'match_differ', 'match', digit),
        expectedValue: this.calculateExpectedValue(market.symbol, 'match_differ', 'match', digit, mdPayout),
        payoutMultiplier: mdPayout,
      });
    }

    // Differ each digit 0-9 (90% theoretical each)
    // ✅ FIXED: was using mdPayout (8.00, the 'match' rate) here too, giving
    // 'differ' bets an apparent EV of ~+7.1/$1 — the real backend rate is
    // MATCH_DIFFER_DIFFER_MULTIPLIER (1.19), same as the other ~90%-win
    // contracts, for a real EV of ~-0.03/$1.
    for (let digit = 0; digit <= 9; digit++) {
      options.push({
        contract: 'match_differ',
        direction: 'differ' as Direction,
        barrier: digit,
        label: `Differ ${digit}`,
        winRate: this.estimateHistoricalWinRate(market.symbol, 'match_differ', 'differ', digit),
        expectedValue: this.calculateExpectedValue(market.symbol, 'match_differ', 'differ', digit, MATCH_DIFFER_DIFFER_MULTIPLIER),
        payoutMultiplier: MATCH_DIFFER_DIFFER_MULTIPLIER,
      });
    }

    // ── Even/Odd ──────────────────────────────────────────────────
    const eoPayout = PAYOUT_MULTIPLIER.even_odd;
    
    options.push({
      contract: 'even_odd',
      direction: 'even' as Direction,
      barrier: undefined,
      label: 'Even',
      winRate: this.estimateHistoricalWinRate(market.symbol, 'even_odd', 'even'),
      expectedValue: this.calculateExpectedValue(market.symbol, 'even_odd', 'even', undefined, eoPayout),
      payoutMultiplier: eoPayout,
    });

    options.push({
      contract: 'even_odd',
      direction: 'odd' as Direction,
      barrier: undefined,
      label: 'Odd',
      winRate: this.estimateHistoricalWinRate(market.symbol, 'even_odd', 'odd'),
      expectedValue: this.calculateExpectedValue(market.symbol, 'even_odd', 'odd', undefined, eoPayout),
      payoutMultiplier: eoPayout,
    });

    // Defensive guard: no Over/Under option should ever carry barrier 9,
    // even if a future edit adds one — keeps MAX_OVER_UNDER_DIGIT meaningful.
    return options.filter(
      (o) => o.contract !== 'over_under' || o.barrier === undefined || o.barrier <= MAX_OVER_UNDER_DIGIT
    );
  }

  /**
   * ✅ NEW: Estimate win rate from historical data
   * Falls back to theoretical probability with confidence penalty for small sample sizes
   */
  private estimateHistoricalWinRate(
    symbol: VolatilityId,
    contract: ContractType,
    direction: Direction,
    barrier?: number
  ): number {
    // Get historical performance for this exact combination
    const history = this.getDetailedPerformance(symbol, contract, direction, barrier);
    
    // Theoretical baseline probabilities
    const theoretical = this.theoreticalWinRate(contract, direction, barrier);
    
    if (history.trades === 0) {
      // No history — use theoretical probability
      return theoretical;
    }
    
    if (history.trades < 20) {
      // Small sample — blend theoretical with observed, heavily weighted toward theoretical
      const blendWeight = Math.max(0, 1 - history.trades / 20);
      const observed = history.wins / history.trades;
      return theoretical * blendWeight + observed * (1 - blendWeight);
    }
    
    // Sufficient data — use observed win rate
    return history.wins / history.trades;
  }

  /**
   * Calculate expected value for a contract option
   * ✅ FIXED: previously hardcoded 'v100_1s' regardless of which market was
   * actually being evaluated, so the EV component of the score for V50/V25
   * markets was silently computed from V100's history instead of their own.
   */
  private calculateExpectedValue(
    symbol: VolatilityId,
    contract: ContractType,
    direction: Direction,
    barrier: number | undefined,
    payoutMultiplier: number
  ): number {
    const winRate = this.estimateHistoricalWinRate(
      symbol,
      contract,
      direction,
      barrier
    );
    return winRate * payoutMultiplier - (1 - winRate);
  }

  /**
   * Get detailed historical performance for a specific combination
   */
  private getDetailedPerformance(
    symbol: VolatilityId,
    contract: ContractType,
    direction: Direction,
    barrier?: number
  ): { wins: number; losses: number; trades: number } {
    const key = this.getPerformanceKey(symbol, contract, direction, barrier);
    const perf = this.performance.detailedPerformance.get(key);
    if (!perf) {
      return { wins: 0, losses: 0, trades: 0 };
    }
    return perf;
  }

  /**
   * Generate a unique key for detailed performance tracking
   */
  private getPerformanceKey(
    symbol: VolatilityId,
    contract: ContractType,
    direction: Direction,
    barrier?: number
  ): string {
    const barrierStr = barrier !== undefined ? `_${barrier}` : '';
    return `${symbol}_${contract}_${direction}${barrierStr}`;
  }

  /**
   * Theoretical win rate based on probability
   */
  private theoreticalWinRate(
    contract: ContractType,
    direction: Direction,
    barrier?: number
  ): number {
    switch (contract) {
      case 'rise_fall':
        return 0.5;
      case 'over_under':
        if (barrier === 0 && direction === 'over') return 0.9;
        if (barrier === 9 && direction === 'under') return 0.9;
        if (barrier === 5 && direction === 'over') return 0.4;
        if (barrier === 5 && direction === 'under') return 0.5;
        return 0.5;
      case 'match_differ':
        if (direction === 'match') return 0.1;
        if (direction === 'differ') return 0.9;
        return 0.5;
      case 'even_odd':
        return 0.5;
      default:
        return 0.5;
    }
  }

  /**
   * Calculate score for a specific combination
   */
  private calculateCombinationScore(
    market: MarketData,
    option: ContractOption,
    riskTolerance: RiskTolerance
  ): number {
    const volatilityScore = this.calculateVolatilityScore(market);
    const trendScore = this.calculateTrendScore(market);
    const reversionScore = this.calculateReversionScore(market);
    const winRateScore = this.calculateWinRateScore(market.symbol, option);
    const riskScore = this.calculateRiskScore(market);
    const expectedValueScore = this.calculateExpectedValueScore(option);
    
    // ✅ NEW: Confidence penalty for small sample sizes
    const history = this.getDetailedPerformance(market.symbol, option.contract, option.direction, option.barrier);
    const sampleSizePenalty = Math.max(0, 1 - (history.trades / 50));
    const confidencePenalty = sampleSizePenalty * 10; // Up to 10% penalty
    
    // Weights
    const weights = {
      volatility: 0.10,
      trend: 0.15,
      reversion: 0.10,
      winRate: 0.20, // ✅ Increased weight for historical win rate
      risk: 0.05,
      expectedValue: 0.40, // Highest weight - EV is most important
    };

    // Risk tolerance adjustments
    let riskMultiplier = 1;
    if (riskTolerance === 'conservative') {
      riskMultiplier = 0.5;
    } else if (riskTolerance === 'aggressive') {
      riskMultiplier = 1.5;
    }

    const totalScore =
      volatilityScore * weights.volatility +
      trendScore * weights.trend +
      reversionScore * weights.reversion +
      winRateScore * weights.winRate +
      riskScore * weights.risk * riskMultiplier +
      expectedValueScore * weights.expectedValue -
      confidencePenalty;

    return Math.min(100, Math.max(0, totalScore));
  }

  /**
   * Calculate Expected Value Score (0-100)
   * Higher EV = higher score
   */
  private calculateExpectedValueScore(option: ContractOption): number {
    // EV is typically between -0.5 and +1.5
    // Map to 0-100
    const normalized = (option.expectedValue + 0.5) / 2.0; // -0.5 → 0, 1.5 → 100
    return Math.min(100, Math.max(0, normalized * 100));
  }

  /**
   * Build the final decision object
   */
  private buildDecision(
    best: ContractOption & { market: MarketData; score: number },
    balance: number,
    confidence: number,
    riskTolerance: RiskTolerance
  ): AIDecision {
    const isNegative = NEGATIVE_DIRECTIONS.includes(best.direction);
    
    // Get historical accuracy for this combination
    const history = this.getDetailedPerformance(
      best.market.symbol,
      best.contract,
      best.direction,
      best.barrier
    );
    
    const sampleSize = history.trades;
    const historicalAccuracy = sampleSize > 0 ? (history.wins / history.trades) * 100 : undefined;

    return {
      symbol: best.market.symbol,
      contract: best.contract,
      direction: best.direction,
      barrier: best.barrier,
      confidence,
      score: best.score,
      expectedValue: best.expectedValue,
      winRate: best.winRate,
      reasoning: {
        market: VOLATILITIES.find(v => v.id === best.market.symbol)?.name || best.market.symbol,
        contract: best.contract.replace('_', ' ').toUpperCase(),
        direction: best.direction.toUpperCase(),
        barrier: best.barrier !== undefined ? best.barrier.toString() : 'N/A',
        volatility: best.market.volatility > 0.001 ? 'High' : best.market.volatility > 0.0005 ? 'Medium' : 'Low',
        trend: this.buildTrendReasoning(best.market),
        reversion: this.buildReversionReasoning(best.market),
        winRate: `${(best.winRate * 100).toFixed(0)}%`,
        risk: isNegative ? 'Higher risk (negative direction)' : 'Lower risk (positive direction)',
        expectedValue: `$${best.expectedValue.toFixed(2)} per $1 staked`,
        historicalAccuracy: historicalAccuracy !== undefined ? `${historicalAccuracy.toFixed(0)}%` : 'No data',
        sampleSize: sampleSize > 0 ? `${sampleSize} trades` : 'No history',
      },
      suggestedStake: this.calculateSuggestedStake(balance, confidence, best.winRate, riskTolerance),
      suggestedStopLoss: this.calculateSuggestedStopLoss(balance, confidence),
      suggestedTakeProfit: this.calculateSuggestedTakeProfit(balance, confidence),
      timestamp: Date.now(),
    };
  }

  private buildTrendReasoning(market: MarketData): string {
    const change = market.changePct || 0;
    if (change > 0.5) return `Strong upward (${change.toFixed(2)}%)`;
    if (change > 0.1) return `Upward (${change.toFixed(2)}%)`;
    if (change > -0.1) return 'Sideways';
    if (change > -0.5) return `Downward (${change.toFixed(2)}%)`;
    return `Strong downward (${change.toFixed(2)}%)`;
  }

  private buildReversionReasoning(market: MarketData): string {
    const price = market.price;
    const vol = market.volatility;
    if (price > 10000 + vol * 1000) return 'Overbought (likely to revert down)';
    if (price < 10000 - vol * 1000) return 'Oversold (likely to revert up)';
    return 'In normal range';
  }

  // ── Score Calculators ────────────────────────────────────────────

  private calculateVolatilityScore(market: MarketData): number {
    const maxSigma = 0.002;
    const minSigma = 0.0002;
    const normalized = (market.volatility - minSigma) / (maxSigma - minSigma);
    return Math.min(100, Math.max(0, normalized * 100));
  }

  private calculateTrendScore(market: MarketData): number {
    const changePct = market.changePct || 0;
    const normalized = (changePct / 10) * 50 + 50;
    return Math.min(100, Math.max(0, normalized));
  }

  private calculateReversionScore(market: MarketData): number {
    const volatilityScore = this.calculateVolatilityScore(market);
    return 100 - volatilityScore * 0.5;
  }

  private calculateWinRateScore(symbol: VolatilityId, option: ContractOption): number {
    // Use detailed historical data for this exact combination
    const history = this.getDetailedPerformance(symbol, option.contract, option.direction, option.barrier);
    
    if (history.trades === 0) {
      // No data — use theoretical win rate as baseline (50%)
      return 50;
    }
    
    const observedWinRate = (history.wins / history.trades) * 100;
    
    // Confidence adjustment for small sample sizes
    const confidenceFactor = Math.min(1, history.trades / 50);
    const theoretical = this.theoreticalWinRate(option.contract, option.direction, option.barrier) * 100;
    
    // Blend observed with theoretical based on sample size
    return theoretical * (1 - confidenceFactor) + observedWinRate * confidenceFactor;
  }

  private calculateRiskScore(market: MarketData): number {
    const volatilityScore = this.calculateVolatilityScore(market);
    return 100 - volatilityScore * 0.7;
  }

  // ── Suggested Values ─────────────────────────────────────────────

  /**
   * ✅ CHANGED: stake now comes from the risk tier's configured dollar range
   * (STAKE_RANGES in store.ts) — conservative $2-5, moderate $10-25,
   * aggressive $50-100 by default — scaled within that range by confidence
   * and win rate, rather than a pure percent-of-balance formula. This is
   * only the AI's *suggested* stake; the person can always override it
   * manually before a trade is placed.
   */
  private calculateSuggestedStake(balance: number, confidence: number, winRate: number, riskTolerance: RiskTolerance): number {
    const [min, max] = STAKE_RANGES[riskTolerance];

    // Blend confidence and win rate into a single 0-1 scale factor so
    // stronger signals land closer to the top of the tier's range.
    const confidenceFactor = confidence / 100;
    const winRateFactor = Math.max(0, Math.min(1, (winRate - 0.5) / 0.5));
    const scale = Math.max(0, Math.min(1, confidenceFactor * 0.6 + winRateFactor * 0.4));

    let stake = min + (max - min) * scale;

    // Safety net: never suggest more than 10% of balance, regardless of tier.
    stake = Math.min(stake, balance * 0.10);

    stake = Math.round(stake * 2) / 2;
    // Clamp to the tier's range, but never force a stake the balance can't
    // support — if the 10% balance cap above pulled it below the tier
    // minimum, respect that lower number instead (floor of $0.5).
    return Math.max(0.5, Math.min(max, stake));
  }

  private calculateSuggestedStopLoss(balance: number, confidence: number): number {
    const base = balance * 0.05;
    const adjusted = base * (1 + (100 - confidence) / 100);
    return Math.round(Math.min(200, Math.max(10, adjusted)));
  }

  private calculateSuggestedTakeProfit(balance: number, confidence: number): number {
    const base = balance * 0.05;
    const adjusted = base * (1 + confidence / 100);
    return Math.round(Math.min(200, Math.max(10, adjusted)));
  }

  // ── Performance Tracking ────────────────────────────────────────

  public recordTradeOutcome(
    symbol: VolatilityId,
    contract: ContractType,
    direction: Direction,
    barrier: number | undefined,
    outcome: 'win' | 'loss',
    pnl: number
  ) {
    // ✅ NEW: Deduplicate by checking if this trade already exists
    const exists = this.tradeHistory.some(t => 
      t.symbol === symbol && 
      t.contract === contract && 
      t.direction === direction && 
      t.barrier === barrier &&
      t.outcome === outcome &&
      t.pnl === pnl
    );
    
    if (exists) {
      console.log('[AI] Trade already recorded, skipping duplicate');
      return;
    }
    
    this.tradeHistory.push({ 
      symbol, 
      contract, 
      direction, 
      barrier, 
      outcome, 
      pnl,
      timestamp: Date.now()
    });
    
    if (this.tradeHistory.length > this.maxHistorySize) {
      this.tradeHistory.shift();
    }
    this.updatePerformanceFromHistory();
  }

  private updatePerformanceFromHistory() {
    const performance: AIPerformance = {
      totalDecisions: this.tradeHistory.length,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      symbolPerformance: {
        v100_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        v50_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        v25_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
      },
      contractPerformance: {
        rise_fall: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        over_under: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        match_differ: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        even_odd: { wins: 0, losses: 0, pnl: 0, trades: 0 },
      },
      detailedPerformance: new Map(),
    };

    // ✅ NEW: Track detailed performance per combination
    const detailMap = new Map<string, { wins: number; losses: number; trades: number }>();

    for (const trade of this.tradeHistory) {
      performance.totalDecisions++;
      if (trade.outcome === 'win') {
        performance.wins++;
        performance.symbolPerformance[trade.symbol].wins++;
        performance.contractPerformance[trade.contract].wins++;
      } else {
        performance.losses++;
        performance.symbolPerformance[trade.symbol].losses++;
        performance.contractPerformance[trade.contract].losses++;
      }
      performance.totalPnl += trade.pnl;
      performance.symbolPerformance[trade.symbol].pnl += trade.pnl;
      performance.symbolPerformance[trade.symbol].trades++;
      performance.contractPerformance[trade.contract].pnl += trade.pnl;
      performance.contractPerformance[trade.contract].trades++;

      // ✅ NEW: Update detailed performance
      const key = this.getPerformanceKey(trade.symbol, trade.contract, trade.direction, trade.barrier);
      const existing = detailMap.get(key) || { wins: 0, losses: 0, trades: 0 };
      if (trade.outcome === 'win') {
        existing.wins++;
      } else {
        existing.losses++;
      }
      existing.trades++;
      detailMap.set(key, existing);
    }

    performance.detailedPerformance = detailMap;
    this.performance = performance;
  }

  // ── Getters ──────────────────────────────────────────────────────

  public getPerformance(): AIPerformance {
    return { 
      ...this.performance,
      detailedPerformance: new Map(this.performance.detailedPerformance)
    };
  }

  public getLastDecision(): AIDecision | null {
    return this.lastDecision;
  }

  public getDecisionHistory(count = 20): AIDecision[] {
    return this.decisions.slice(-count);
  }

  /**
   * ✅ NEW: Get win rate for a specific combination
   */
  public getWinRateForCombination(
    symbol: VolatilityId,
    contract: ContractType,
    direction: Direction,
    barrier?: number
  ): number | null {
    const history = this.getDetailedPerformance(symbol, contract, direction, barrier);
    if (history.trades === 0) return null;
    return history.wins / history.trades;
  }

  /**
   * ✅ NEW: Get all trade history for analysis
   */
  public getTradeHistory(): TradeHistory[] {
    return [...this.tradeHistory];
  }

  public reset() {
    this.tradeHistory = [];
    this.decisions = [];
    this.lastDecision = null;
    this.performance = {
      totalDecisions: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      symbolPerformance: {
        v100_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        v50_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        v25_1s: { wins: 0, losses: 0, pnl: 0, trades: 0 },
      },
      contractPerformance: {
        rise_fall: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        over_under: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        match_differ: { wins: 0, losses: 0, pnl: 0, trades: 0 },
        even_odd: { wins: 0, losses: 0, pnl: 0, trades: 0 },
      },
      detailedPerformance: new Map(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────

let aiEngineInstance: AIEngine | null = null;

export function getAIEngine(initialHistory?: TradeHistory[]): AIEngine {
  if (!aiEngineInstance) {
    aiEngineInstance = new AIEngine(initialHistory);
  }
  return aiEngineInstance;
}

export function resetAIEngine() {
  aiEngineInstance = null;
}