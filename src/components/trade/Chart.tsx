// src/components/trade/Chart.tsx
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  LineStyle,
  CrosshairMode,
} from "lightweight-charts";
import { useApp } from "@/lib/store";

export interface ChartHandle {
  zoomIn: () => void;
  zoomOut: () => void;
}

/** Theme-dependent colours, shared by chart creation and live theme switches. */
function getPalette(theme: string) {
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  return {
    fg: isDark ? "#ffffff" : "#000000",
    grid: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    line: isDark ? "#ffffff" : "#000000",
    top: isDark ? "rgba(255, 255, 255, 0.18)" : "rgba(0, 0, 0, 0.10)",
    bottom: isDark ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.01)",
  };
}

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastTimeRef = useRef<number>(0);
  const entryLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const hasReceivedHistoryRef = useRef<boolean>(false);
  const [isReady, setIsReady] = useState(false);

  const price = useApp((s) => s.price);
  const crosshairEnabled = useApp((s) => s.crosshairEnabled);
  const theme = useApp((s) => s.theme);
  const trades = useApp((s) => s.trades);
  const ws = useApp((s) => s.ws);
  const volatility = useApp((s) => s.volatility);

  // ── Setup chart (ONCE) ───────────────────────────────────────────
  // This used to depend on [theme], so toggling light/dark destroyed the
  // chart and rebuilt it with random seed data. isReady flipped
  // true→false→true inside one commit (net: unchanged), so the history
  // and entry-line effects never re-ran. The chart was left showing fake
  // random data (the "spike") until a volatility change forced a reset.
  // Colours are now applied in place by the theme effect below, so the
  // chart, its data and its entry lines survive a theme switch.
  useEffect(() => {
    if (!containerRef.current) return;

    const state = useApp.getState();
    const p = getPalette(state.theme);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: p.fg,
        attributionLogo: false,
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { 
        borderColor: p.grid, 
        scaleMargins: { top: 0.1, bottom: 0.1 } 
      },
      timeScale: {
        borderColor: p.grid,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 8,
        shiftVisibleRangeOnNewBar: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: number) => {
          const d = new Date((time as number) * 1000);
          return d.toLocaleTimeString([], { 
            hour: "2-digit", 
            minute: "2-digit", 
            second: "2-digit", 
            hour12: false 
          });
        },
      },
      localization: {
        timeFormatter: (time: number) =>
          new Date((time as number) * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }),
      },
      crosshair: {
        mode: state.crosshairEnabled ? CrosshairMode.Normal : CrosshairMode.Hidden,
      },
      handleScale: {
        mouseWheel: false,
        axisPressedMouseMove: { time: false, price: true },
        pinch: false,
      },
      autoSize: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: p.line,
      topColor: p.top,
      bottomColor: p.bottom,
      lineWidth: 1,
      priceLineVisible: true,
      priceLineColor: p.line,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    chart.priceScale("right").applyOptions({ visible: true });

    // Generate seed data as fallback
    const now = Math.floor(Date.now() / 1000);
    const seed: { time: UTCTimestamp; value: number }[] = [];
    let price0 = state.price;
    for (let i = 120; i > 0; i--) {
      price0 += (Math.random() - 0.5) * 0.4;
      seed.push({ time: (now - i) as UTCTimestamp, value: Number(price0.toFixed(3)) });
    }
    series.setData(seed);

    chartRef.current = chart;
    seriesRef.current = series;
    lastTimeRef.current = now - 1;
    hasReceivedHistoryRef.current = false;
    setIsReady(true);

    chart.timeScale().fitContent();

    // Right-anchored wheel zoom
    const el = containerRef.current;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const span = range.to - range.from;
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      const newSpan = Math.max(10, span * factor);
      ts.setVisibleLogicalRange({ from: range.to - newSpan, to: range.to });
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      entryLinesRef.current.clear();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setIsReady(false);
    };
  }, []);

  // ── Theme switch: recolour in place, keep data ──────────────────
  useEffect(() => {
    const apply = () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;
      const p = getPalette(theme);
      chart.applyOptions({
        layout: { textColor: p.fg },
        grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
        rightPriceScale: { borderColor: p.grid },
        timeScale: { borderColor: p.grid },
      });
      series.applyOptions({
        lineColor: p.line,
        topColor: p.top,
        bottomColor: p.bottom,
        priceLineColor: p.line,
      });
    };
    apply();

    // "system" follows the OS live (ThemeManager does the same for <html>).
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, isReady]);

  // ── Crosshair toggle ─────────────────────────────────────────────
  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: { 
        mode: crosshairEnabled ? CrosshairMode.Normal : CrosshairMode.Hidden 
      },
    });
  }, [crosshairEnabled]);

  // ── Reset chart state on volatility change ──────────────────────
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    
    console.log('[Chart] Volatility changed to:', volatility, '- Resetting chart');
    
    seriesRef.current.setData([]);
    hasReceivedHistoryRef.current = false;
    lastTimeRef.current = Math.floor(Date.now() / 1000) - 1;
    
    for (const [id, line] of entryLinesRef.current) {
      try {
        seriesRef.current.removePriceLine(line);
      } catch {
        // ignore
      }
    }
    entryLinesRef.current.clear();
    
    chartRef.current.timeScale().fitContent();
    
    const now = Math.floor(Date.now() / 1000);
    const seed: { time: UTCTimestamp; value: number }[] = [];
    let p = useApp.getState().price;
    for (let i = 120; i > 0; i--) {
      p += (Math.random() - 0.5) * 0.4;
      seed.push({ time: (now - i) as UTCTimestamp, value: Number(p.toFixed(3)) });
    }
    seriesRef.current.setData(seed);
    chartRef.current.timeScale().fitContent();
    
    console.log('[Chart] Chart reset complete for', volatility);
  }, [volatility]);

  // ── Listen for WebSocket history data ────────────────────────────
  useEffect(() => {
    if (!ws || !seriesRef.current || !isReady) return;

    const handleHistory = (data: any) => {
      if (data.symbol !== volatility) {
        console.log('[Chart] Ignoring history for', data.symbol, '(current:', volatility, ')');
        return;
      }
      
      console.log('[Chart] Received history data:', data.ticks?.length || 0, 'ticks for', data.symbol);
      
      if (data.ticks && data.ticks.length > 0) {
        const chartData = data.ticks.map((tick: any) => ({
          time: Math.floor(tick.timestamp / 1000) as UTCTimestamp,
          value: tick.price,
        }));
        
        seriesRef.current?.setData(chartData);
        lastTimeRef.current = chartData[chartData.length - 1].time as number;
        chartRef.current?.timeScale().fitContent();
        hasReceivedHistoryRef.current = true;
        console.log('[Chart] Loaded history data:', chartData.length, 'points for', data.symbol);
      }
    };

    ws.on('history', handleHistory);

    // ✅ NEW: force a fresh history push now that our listener is guaranteed to
    // be attached. `ws.subscribe()` is idempotent server-side (the backend just
    // re-adds this socket to a Set and re-sends history + latest tick), so this
    // is safe to call even if the store's own `connected` handler already
    // subscribed earlier. This closes the startup race where that earlier
    // subscribe's `history` response could arrive before this effect ever ran.
    ws.subscribe(volatility);

    return () => {
      ws.off('history', handleHistory);
    };
  }, [ws, volatility, isReady]);

  // ── Always forward live price changes to chart ──────────────────
  useEffect(() => {
    if (!seriesRef.current || !isReady) return;
    
    const t = Math.floor(Date.now() / 1000) as UTCTimestamp;
    const nextTime = Math.max(lastTimeRef.current + 1, t) as UTCTimestamp;
    lastTimeRef.current = nextTime;
    seriesRef.current.update({ time: nextTime, value: price });
    
  }, [price, isReady]);

  // ── Entry markers - filter by volatility ─────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const lines = entryLinesRef.current;
    const openIds = new Set<string>();

    for (const t of trades) {
      if (t.status === "open" && t.volatility === volatility) {
        openIds.add(t.id);
        if (!lines.has(t.id)) {
          const isNeg = ["fall", "under", "differ", "odd"].includes(t.direction);
          const color = isNeg ? "#000000" : "#ffffff";
          const line = series.createPriceLine({
            price: t.entryPrice,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${t.direction.toUpperCase()} entry @ ${t.entryPrice.toFixed(3)}`,
          });
          lines.set(t.id, line);
        }
      }
    }

    for (const [id, line] of lines) {
      if (!openIds.has(id)) {
        try {
          series.removePriceLine(line);
        } catch {
          /* noop */
        }
        lines.delete(id);
      }
    }
  }, [trades, volatility]);

  // ── Zoom controls via window event ──────────────────────────────
  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent).detail as "in" | "out" | "fit";
      const ts = chartRef.current?.timeScale();
      if (!ts) return;
      if (detail === "fit") return ts.fitContent();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const span = range.to - range.from;
      const factor = detail === "in" ? 0.7 : 1.4;
      const newSpan = span * factor;
      ts.setVisibleLogicalRange({ from: range.to - newSpan, to: range.to });
    };
    window.addEventListener("gwave:zoom", onZoom as EventListener);
    return () => window.removeEventListener("gwave:zoom", onZoom as EventListener);
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
