// src/components/trade/DigitStats.tsx
//
// Last-digit frequency rings (0-9) built from the live tick stream.
// Pure front end: it derives everything from the price array you pass in,
// so if your tick store already holds history, the percentages are
// correct from the first render and identical for every user.
import { memo, useMemo } from "react";

type Props = {
  /** Recent prices, oldest -> newest. Only the last `windowSize` are used. */
  prices: number[];
  /** Decimal places the symbol quotes. If omitted, inferred from the data. */
  decimals?: number;
  /** How many of the latest ticks to count. */
  windowSize?: number;
  /**
   * Which digit to count. Must match how the backend settles digit contracts:
   * - "integer": units digit of the integer part (floor(price) % 10). This is
   *   what resolveOutcome() in market.js uses today.
   * - "decimal": last digit of the quoted price at its decimal precision.
   */
  digitFrom?: "integer" | "decimal";
};

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// A digit at 20% fills the whole ring; 10% (the "fair" share) fills half.
const FULL_RING_AT = 20;

function decimalsOf(n: number): number {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

// "decimal" uses the formatted string, not arithmetic: `price % 10` breaks on
// floating-point error and loses trailing zeros (1234.50 must count as 0).
function lastDigit(price: number, decimals: number, from: "integer" | "decimal"): number {
  if (from === "integer") return Math.floor(price) % 10;
  return Number(price.toFixed(decimals).slice(-1));
}

function DigitStatsInner({ prices, decimals, windowSize = 1000, digitFrom = "integer" }: Props) {
  const { pcts, total, current, max, min } = useMemo(() => {
    const slice = prices.length > windowSize ? prices.slice(-windowSize) : prices;
    const dp =
      decimals ??
      slice.reduce((m, p) => Math.max(m, Math.min(decimalsOf(p), 6)), 0);

    const counts = new Array<number>(10).fill(0);
    for (const p of slice) counts[lastDigit(p, dp, digitFrom)]++;

    const n = slice.length;
    const pcts = counts.map((c) => (n ? (c / n) * 100 : 0));
    const hi = Math.max(...pcts);
    const lo = Math.min(...pcts);

    return {
      pcts,
      total: n,
      current: n ? lastDigit(slice[n - 1], dp, digitFrom) : null,
      // Only highlight once there is enough data to mean something.
      max: n >= 30 ? pcts.indexOf(hi) : -1,
      min: n >= 30 ? pcts.indexOf(lo) : -1,
    };
  }, [prices, decimals, windowSize, digitFrom]);

  return (
    <div className="border-t border-border bg-background px-2 py-2">
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
        <span>Last digit</span>
        <span>{total >= windowSize ? `Last ${windowSize} ticks` : `${total} ticks`}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 md:justify-center">
        {pcts.map((pct, d) => {
          const isMax = d === max;
          const isMin = d === min;
          const arc = Math.min(pct / FULL_RING_AT, 1) * CIRCUMFERENCE;
          const arcClass = isMax
            ? "stroke-primary"
            : isMin
              ? "stroke-destructive"
              : "stroke-muted-foreground/40";
          const pctClass = isMax
            ? "text-primary"
            : isMin
              ? "text-destructive"
              : "text-muted-foreground";

          return (
            <div key={d} className="flex shrink-0 flex-col items-center">
              <div className="relative h-12 w-12">
                <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90">
                  <circle
                    cx="24"
                    cy="24"
                    r={RADIUS}
                    fill="none"
                    strokeWidth="3"
                    className="stroke-border"
                  />
                  <circle
                    cx="24"
                    cy="24"
                    r={RADIUS}
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${arc} ${CIRCUMFERENCE}`}
                    className={`${arcClass} transition-[stroke-dasharray] duration-300`}
                  />
                </svg>
                <div className="absolute inset-0 grid place-items-center leading-none">
                  <span className="text-sm font-bold">{d}</span>
                </div>
              </div>
              <span className={`mt-0.5 text-[10px] tabular-nums ${pctClass}`}>
                {total ? `${pct.toFixed(1)}%` : "--"}
              </span>
              {/* Marker under the digit of the latest tick */}
              <span
                aria-hidden
                className={`mt-0.5 h-0 w-0 border-x-4 border-b-[6px] border-x-transparent ${
                  current === d ? "border-b-primary" : "border-b-transparent"
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const DigitStats = memo(DigitStatsInner);
