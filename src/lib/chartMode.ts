// src/lib/chartMode.ts
// Tiny shared store for the chart rendering mode, persisted in localStorage.
// "tick"   = raw ticks, straight segments, no animation (original behaviour)
// "smooth" = curved line + animated tick movement (Deriv-style)
import { useSyncExternalStore } from "react";

export type ChartMode = "tick" | "smooth";

const KEY = "gwave:chartMode";
const DEFAULT_MODE: ChartMode = "tick";
const listeners = new Set<() => void>();

let current: ChartMode = DEFAULT_MODE;
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "tick" || v === "smooth") current = v;
  } catch {
    /* storage unavailable */
  }
}

export function getChartMode(): ChartMode {
  load();
  return current;
}

export function setChartMode(mode: ChartMode) {
  load();
  if (mode === current) return;
  current = mode;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function toggleChartMode() {
  setChartMode(getChartMode() === "smooth" ? "tick" : "smooth");
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useChartMode(): ChartMode {
  return useSyncExternalStore(subscribe, getChartMode, () => DEFAULT_MODE);
}
