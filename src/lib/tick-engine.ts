// src/lib/tick-engine.ts
import { useEffect } from "react";
import { toast } from "sonner";
import { useApp, VOLATILITIES } from "./store";

// Tracks trade IDs currently being settled, to prevent duplicate
// concurrent settlement calls from the 250ms and 1000ms polling loops.
const settlingIds = new Set<string>();

// ✅ NEW: how long to wait, past expiry, for the backend's own
// WS-pushed settlement before falling back to an explicit REST call.
// Keeps the common case (connected, WS delivers on time) fast and
// single-path, while still guaranteeing settlement if a WS message
// is ever missed.
const GRACE_MS = 3000;

function settleAndNotify(id: string, exitPrice: number) {
  const before = useApp.getState().trades.find((x) => x.id === id);
  if (!before || before.status !== "open") return;

  if (settlingIds.has(id)) return;
  settlingIds.add(id);

  useApp.getState().settleTrade(id, exitPrice).then((updatedTrade) => {
    if (!updatedTrade) return;
    if (updatedTrade.status === "open") return;

    const won = updatedTrade.status === "won";
    const pnl = updatedTrade.pnl ?? 0;
    const sign = pnl >= 0 ? "+" : "";
    const msg = `${updatedTrade.direction.toUpperCase()} ${won ? "won" : "lost"} · ${sign}$${pnl.toFixed(2)}`;
    if (won) toast.success(msg, { description: `Exit @ ${exitPrice.toFixed(3)}` });
    else toast.error(msg, { description: `Exit @ ${exitPrice.toFixed(3)}` });
  }).catch((err) => {
    console.error('[settleAndNotify] Failed to settle trade:', err);
    toast.error('Failed to settle trade. Please refresh.');
  }).finally(() => {
    settlingIds.delete(id);
  });
}

// Box-Muller gaussian
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Global tick engine: emits ticks, settles expired trades. */
export function useTickEngine() {
  const setPrice = useApp((s) => s.setPrice);
  const volatility = useApp((s) => s.volatility);
  const trades = useApp((s) => s.trades);
  const isConnected = useApp((s) => s.isConnected);

  // Price engine: fallback to synthetic if WebSocket is not connected
  useEffect(() => {
    if (isConnected) {
      console.log('[TickEngine] WebSocket connected — using real data');
      return;
    }

    console.log('[TickEngine] WebSocket disconnected — using synthetic price engine');
    
    const vol = VOLATILITIES.find((v) => v.id === volatility)?.vol ?? 1;
    const id = window.setInterval(() => {
      const cur = useApp.getState().price;
      const drift = -0.0001 * (cur - 200);
      const change = gauss() * 0.15 * vol + drift;
      const next = Math.max(50, cur + change);
      setPrice(Number(next.toFixed(3)));

      const now = Date.now();
      for (const t of useApp.getState().trades) {
        if (t.status === "open" && now >= t.expiresAt) {
          // Disconnected → no WS push coming, settle immediately
          settleAndNotify(t.id, useApp.getState().price);
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [volatility, isConnected, setPrice]);

  // Settlement poll — ALWAYS runs as a safety net
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      const connected = useApp.getState().isConnected;
      for (const t of useApp.getState().trades) {
        if (t.status !== "open") continue;
        const overdue = now >= t.expiresAt;
        if (!overdue) continue;

        // ✅ CHANGED: when connected, give the backend's proactive WS push a
        // grace window to arrive before we issue our own REST settle call.
        // When disconnected, there's no WS push coming — settle immediately.
        if (!connected || now >= t.expiresAt + GRACE_MS) {
          settleAndNotify(t.id, useApp.getState().price);
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [trades.length]);
}