// src/components/trade/Chart.tsx
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
  LineStyle,
  LineType,
  CrosshairMode,
} from "lightweight-charts";
import { useApp } from "@/lib/store";
import { useChartMode, type ChartMode } from "@/lib/chartMode";

export interface ChartHandle {
  zoomIn: () => void;
  zoomOut: () => void;
}

/** Empty bars kept to the right of the latest tick (the "breathing room"). */
const RIGHT_OFFSET = 12;
/** Smooth mode: how long the newest point takes to glide to its new value. */
const SMOOTH_MS = 380;

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

/**
 * Draws a dot on the latest tick plus a horizontal line from that dot to the
 * right edge of the pane (where the price-axis label sits). The built-in price
 * line spans the full width, so we replace it with this primitive.
 */
class LastTickPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Area"> | null = null;
  private point: { time: number; value: number } | null = null;
  private x: number | null = null;
  private y: number | null = null;
  private color = "#ffffff";

  private view: IPrimitivePaneView = {
    zOrder: () => "top",
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target: any) => {
        target.useBitmapCoordinateSpace((scope: any) => {
          if (this.x === null || this.y === null) return;
          const { context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope;
          const x = Math.round(this.x * hr);
          const y = Math.round(this.y * vr);
          if (x > bitmapSize.width) return;

          ctx.save();
          ctx.strokeStyle = this.color;
          ctx.fillStyle = this.color;
          ctx.lineWidth = Math.max(1, Math.round(hr));
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(bitmapSize.width, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 4 * hr, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      },
    }),
  };

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<"Area">;
  }
  detached() {
    this.chart = null;
    this.series = null;
  }
  setPoint(time: number, value: number) {
    this.point = { time, value };
  }
  setColor(c: string) {
    this.color = c;
  }
  updateAllViews() {
    if (!this.chart || !this.series || !this.point) {
      this.x = this.y = null;
      return;
    }
    this.x = this.chart.timeScale().timeToCoordinate(this.point.time as UTCTimestamp);
    this.y = this.series.priceToCoordinate(this.point.value);
  }
  paneViews() {
    return [this.view];
  }
}

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const primitiveRef = useRef<LastTickPrimitive | null>(null);
  const lastTimeRef = useRef<number>(0);
  const lastValueRef = useRef<number | null>(null);
  const dataLenRef = useRef<number>(0);
  const animRef = useRef<number | null>(null);
  const entryLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const hasReceivedHistoryRef = useRef<boolean>(false);
  const [isReady, setIsReady] = useState(false);

  const price = useApp((s) => s.price);
  const crosshairEnabled = useApp((s) => s.crosshairEnabled);
  const theme = useApp((s) => s.theme);
  const trades = useApp((s) => s.trades);
  const ws = useApp((s) => s.ws);
  const volatility = useApp((s) => s.volatility);
  const mode = useChartMode();

  // Mode is read inside effects that must not re-run when it changes.
  const modeRef = useRef<ChartMode>(mode);
  modeRef.current = mode;

  // ── Helpers ──────────────────────────────────────────────────────
  const cancelAnim = () => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  };

  /** Single place that writes the newest point to series + overlay. */
  const pushPoint = (time: number, value: number) => {
    lastValueRef.current = value;
    primitiveRef.current?.setPoint(time, value);
    seriesRef.current?.update({ time: time as UTCTimestamp, value });
  };

  /** Records a full dataset (seed/history) so overlay + fit stay in sync. */
  const afterSetData = (data: { time: UTCTimestamp; value: number }[]) => {
    cancelAnim();
    dataLenRef.current = data.length;
    const last = data[data.length - 1];
    if (last) {
      lastValueRef.current = last.value;
      primitiveRef.current?.setPoint(last.time as number, last.value);
    }
  };

  /**
   * First tick at the left edge, latest tick with RIGHT_OFFSET bars of space on
   * the right. (fitContent() ignores rightOffset, so we set the range ourselves.)
   */
  const fitToData = () => {
    const ts = chartRef.current?.timeScale();
    const n = dataLenRef.current;
    if (!ts || n < 1) return;
    ts.setVisibleLogicalRange({ from: 0, to: n - 1 + RIGHT_OFFSET });
  };

  // ── Setup chart (ONCE) ───────────────────────────────────────────
  // Colours are applied in place by the theme effect below, so the
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
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: p.grid,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: RIGHT_OFFSET,
        shiftVisibleRangeOnNewBar: true,
        fixRightEdge: true, // can't scroll past the live edge (+ rightOffset)
        fixLeftEdge: true, // can't scroll past the first loaded history tick
        tickMarkFormatter: (time: number) => {
          const d = new Date((time as number) * 1000);
          return d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
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
      lineType: modeRef.current === "smooth" ? LineType.Curved : LineType.Simple,
      // Built-in price line spans the full width; our primitive draws the
      // dot + line from the latest tick instead. The axis label stays.
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    });

    chart.priceScale("right").applyOptions({ visible: true });

    const primitive = new LastTickPrimitive();
    primitive.setColor(p.line);
    series.attachPrimitive(primitive);
    primitiveRef.current = primitive;

    chartRef.current = chart;
    seriesRef.current = series;

    // Generate seed data as fallback
    const now = Math.floor(Date.now() / 1000);
    const seed: { time: UTCTimestamp; value: number }[] = [];
    let price0 = state.price;
    for (let i = 120; i > 0; i--) {
      price0 += (Math.random() - 0.5) * 0.4;
      seed.push({ time: (now - i) as UTCTimestamp, value: Number(price0.toFixed(3)) });
    }
    series.setData(seed);
    afterSetData(seed);

    lastTimeRef.current = now - 1;
    hasReceivedHistoryRef.current = false;
    setIsReady(true);

    fitToData();

    // Right-anchored wheel zoom (left end is clamped by fixLeftEdge)
    const el = containerRef.current;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const span = range.to - range.from;
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      const newSpan = Math.max(10, span * factor);
      ts.setVisibleLogicalRange({ from: Math.max(0, range.to - newSpan), to: range.to });
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnim();
      el.removeEventListener("wheel", onWheel);
      entryLinesRef.current.clear();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      });
      primitiveRef.current?.setColor(p.line);
    };
    apply();

    // "system" follows the OS live (ThemeManager does the same for <html>).
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, isReady]);

  // ── Tick / smooth mode: curve type ──────────────────────────────
  useEffect(() => {
    if (!isReady) return;
    if (mode === "tick") cancelAnim();
    seriesRef.current?.applyOptions({
      lineType: mode === "smooth" ? LineType.Curved : LineType.Simple,
    });
  }, [mode, isReady]);

  // ── Crosshair toggle ─────────────────────────────────────────────
  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: {
        mode: crosshairEnabled ? CrosshairMode.Normal : CrosshairMode.Hidden,
      },
    });
  }, [crosshairEnabled]);

  // ── Reset chart state on volatility change ──────────────────────
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    console.log("[Chart] Volatility changed to:", volatility, "- Resetting chart");

    cancelAnim();
    seriesRef.current.setData([]);
    hasReceivedHistoryRef.current = false;
    lastTimeRef.current = Math.floor(Date.now() / 1000) - 1;

    for (const [, line] of entryLinesRef.current) {
      try {
        seriesRef.current.removePriceLine(line);
      } catch {
        // ignore
      }
    }
    entryLinesRef.current.clear();

    const now = Math.floor(Date.now() / 1000);
    const seed: { time: UTCTimestamp; value: number }[] = [];
    let p = useApp.getState().price;
    for (let i = 120; i > 0; i--) {
      p += (Math.random() - 0.5) * 0.4;
      seed.push({ time: (now - i) as UTCTimestamp, value: Number(p.toFixed(3)) });
    }
    seriesRef.current.setData(seed);
    afterSetData(seed);
    fitToData();

    console.log("[Chart] Chart reset complete for", volatility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volatility]);

  // ── Listen for WebSocket history data ────────────────────────────
  useEffect(() => {
    if (!ws || !seriesRef.current || !isReady) return;

    const handleHistory = (data: any) => {
      if (data.symbol !== volatility) {
        console.log("[Chart] Ignoring history for", data.symbol, "(current:", volatility, ")");
        return;
      }

      console.log("[Chart] Received history data:", data.ticks?.length || 0, "ticks for", data.symbol);

      if (data.ticks && data.ticks.length > 0) {
        const chartData = data.ticks.map((tick: any) => ({
          time: Math.floor(tick.timestamp / 1000) as UTCTimestamp,
          value: tick.price,
        }));

        seriesRef.current?.setData(chartData);
        afterSetData(chartData);
        lastTimeRef.current = chartData[chartData.length - 1].time as number;
        // First history tick is now index 0 -> fixLeftEdge stops dragging there.
        fitToData();
        hasReceivedHistoryRef.current = true;
        console.log("[Chart] Loaded history data:", chartData.length, "points for", data.symbol);
      }
    };

    ws.on("history", handleHistory);

    // Force a fresh history push now that our listener is guaranteed to be
    // attached (subscribe is idempotent server-side; closes the startup race).
    ws.subscribe(volatility);

    return () => {
      ws.off("history", handleHistory);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, volatility, isReady]);

  // ── Forward live price changes to chart ─────────────────────────
  useEffect(() => {
    if (!seriesRef.current || !isReady) return;

    const t = Math.floor(Date.now() / 1000) as UTCTimestamp;
    const nextTime = Math.max(lastTimeRef.current + 1, t) as number;
    lastTimeRef.current = nextTime;
    dataLenRef.current += 1;

    cancelAnim();

    const from = lastValueRef.current ?? price;

    // Tick mode (or nothing to animate): write the raw tick straight away.
    if (modeRef.current === "tick" || from === price) {
      pushPoint(nextTime, price);
      return;
    }

    // Smooth mode: the new point starts at the previous value and glides to
    // the new price, so the line "grows" into each tick instead of snapping.
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / SMOOTH_MS);
      const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
      pushPoint(nextTime, from + (price - from) * eased);
      animRef.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    step(start);

    return cancelAnim;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (detail === "fit") return fitToData();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const span = range.to - range.from;
      const factor = detail === "in" ? 0.7 : 1.4;
      const newSpan = span * factor;
      ts.setVisibleLogicalRange({ from: Math.max(0, range.to - newSpan), to: range.to });
    };
    window.addEventListener("gwave:zoom", onZoom as EventListener);
    return () => window.removeEventListener("gwave:zoom", onZoom as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
