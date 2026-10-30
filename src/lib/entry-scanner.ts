// src/lib/entry-scanner.ts
import {
  VOLATILITIES,
  PAYOUT_MULTIPLIER,
  OVER_UNDER_EDGE_MULTIPLIER,
  MATCH_DIFFER_DIFFER_MULTIPLIER,
  CONTRACTS,
  type ContractType,
  type Direction,
  type VolatilityId,
} from "./store";

const HISTORY_LENGTH = 600;
const MAX_OVER_UNDER_DIGIT = 8;
const RISE_FALL_HORIZON = 2;

const PRICE_OFFSET: Record<VolatilityId, number> = {
  v100_1s: 0,
  v50_1s: -40,
  v25_1s: -80,
};

export interface IndexHistory {
  id: VolatilityId;
  name: string;
  prices: number[];
}

export interface EntryScanResult {
  symbol: VolatilityId;
  marketName: string;
  contract: ContractType;
  tradeType: string;
  direction: Direction;
  barrier?: number;
  prediction: string;
  quality: number;
  winRate: number;
  expectedValue: number;
  sampleSize: number;
}

interface Candidate {
  direction: Direction;
  barrier?: number;
  winRate: number;
  expectedValue: number;
  sampleSize: number;
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function digitOf(price: number): number {
  return Math.floor(Math.abs(price)) % 10;
}

function payoutMultiplier(contract: ContractType, direction: Direction, barrier?: number): number {
  if (contract === "over_under") {
    const isEdge =
      (barrier === 0 && direction === "over") || (barrier === 9 && direction === "under");
    return isEdge ? OVER_UNDER_EDGE_MULTIPLIER : PAYOUT_MULTIPLIER.over_under;
  }
  if (contract === "match_differ") {
    return direction === "differ"
      ? MATCH_DIFFER_DIFFER_MULTIPLIER
      : PAYOUT_MULTIPLIER.match_differ;
  }
  return PAYOUT_MULTIPLIER[contract] ?? 1.88;
}

function predictionLabel(direction: Direction, barrier?: number): string {
  const name = direction.charAt(0).toUpperCase() + direction.slice(1);
  return barrier === undefined ? name : `${name} ${barrier}`;
}

/**
 * Builds a tick history for every available volatility index. The currently
 * selected index uses its real tick history when enough samples exist; the
 * remaining indices get a synthetic history anchored to their own volatility.
 */
export function buildIndexHistories(
  basePrice: number,
  currentVolatility: VolatilityId,
  currentHistory: number[],
): IndexHistory[] {
  const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 100;

  return VOLATILITIES.map((v) => {
    if (v.id === currentVolatility && currentHistory.length >= 60) {
      return {
        id: v.id,
        name: v.name,
        prices: currentHistory.slice(-HISTORY_LENGTH),
      };
    }

    const prices: number[] = [];
    let price = Math.max(1, safeBase + (PRICE_OFFSET[v.id] ?? 0));
    const step = Math.max(0.05, v.vol) * 0.9;

    for (let i = 0; i < HISTORY_LENGTH; i++) {
      price = Math.max(1, price + gaussian() * step);
      prices.push(Number(price.toFixed(3)));
    }

    return { id: v.id, name: v.name, prices };
  });
}

/**
 * Scores every direction/barrier combination for one index and returns the
 * one with the highest empirical win rate. Quality is that win rate.
 */
export function evaluateIndex(history: IndexHistory, contract: ContractType): EntryScanResult {
  const prices = history.prices;
  const digits = prices.map(digitOf);
  let best: Candidate | null = null;

  const consider = (
    direction: Direction,
    barrier: number | undefined,
    winRate: number,
    sampleSize: number,
  ) => {
    if (!Number.isFinite(winRate) || sampleSize <= 0) return;
    const multiplier = payoutMultiplier(contract, direction, barrier);
    const expectedValue = winRate * multiplier - 1;

    if (
      !best ||
      winRate > best.winRate ||
      (winRate === best.winRate && expectedValue > best.expectedValue)
    ) {
      best = { direction, barrier, winRate, expectedValue, sampleSize };
    }
  };

  if (contract === "rise_fall") {
    let rise = 0;
    let fall = 0;
    const total = Math.max(0, prices.length - RISE_FALL_HORIZON);

    for (let i = 0; i + RISE_FALL_HORIZON < prices.length; i++) {
      if (prices[i + RISE_FALL_HORIZON] > prices[i]) rise++;
      else if (prices[i + RISE_FALL_HORIZON] < prices[i]) fall++;
    }

    consider("rise", undefined, total ? rise / total : 0, total);
    consider("fall", undefined, total ? fall / total : 0, total);
  } else if (contract === "over_under") {
    for (let barrier = 0; barrier <= MAX_OVER_UNDER_DIGIT; barrier++) {
      const over = digits.filter((d) => d > barrier).length / digits.length;
      const under = digits.filter((d) => d < barrier).length / digits.length;
      consider("over", barrier, over, digits.length);
      consider("under", barrier, under, digits.length);
    }
  } else if (contract === "match_differ") {
    for (let barrier = 0; barrier <= 9; barrier++) {
      const match = digits.filter((d) => d === barrier).length / digits.length;
      const differ = 1 - match;
      consider("match", barrier, match, digits.length);
      consider("differ", barrier, differ, digits.length);
    }
  } else if (contract === "even_odd") {
    const even = digits.filter((d) => d % 2 === 0).length / digits.length;
    consider("even", undefined, even, digits.length);
    consider("odd", undefined, 1 - even, digits.length);
  }

  const winner = best ?? {
    direction: "rise" as Direction,
    barrier: undefined,
    winRate: 0,
    expectedValue: -1,
    sampleSize: 0,
  };

  const tradeType =
    CONTRACTS.find((c) => c.id === contract)?.label.replace("/", " / ") ?? contract;

  return {
    symbol: history.id,
    marketName: history.name,
    contract,
    tradeType,
    direction: winner.direction,
    barrier: winner.barrier,
    prediction: predictionLabel(winner.direction, winner.barrier),
    quality: winner.winRate * 100,
    winRate: winner.winRate,
    expectedValue: winner.expectedValue,
    sampleSize: winner.sampleSize,
  };
}
