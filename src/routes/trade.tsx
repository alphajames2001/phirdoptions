// src/routes/trade.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGuard } from "@/components/layout/AuthGuard";
import { PriceChart } from "@/components/trade/Chart";
import { DigitStats } from "@/components/trade/DigitStats";
import { ContractSelector } from "@/components/trade/ContractSelector";
import { VolatilityIndicator } from "@/components/trade/VolatilityIndicator";
import { TradeControls } from "@/components/trade/TradeControls";
import { AutoTradeControls } from "@/components/trade/AutoTradeControls";
import { Positions } from "@/components/trade/Positions";
import { AutoTradeResultModal } from "@/components/trade/AutoTradeResultModal";
import { useApp, formatMoney } from "@/lib/store";
import { useTickEngine } from "@/lib/tick-engine";
import { Plus, Minus, Eye, EyeOff, ChevronDown, Spline, Activity } from "lucide-react";
import { useChartMode, toggleChartMode } from "@/lib/chartMode";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/trade")({
  head: () => ({
    meta: [{ title: "Phird Options — Trade" }, { name: "description", content: "Trade synthetic indices." }],
  }),
  component: TradePage,
});

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

type MobilePanel = "none" | "trade";

function TradePage() {
  useTickEngine();
  const now = useClock();
  const crosshair = useApp((s) => s.crosshairEnabled);
  const toggleCrosshair = useApp((s) => s.toggleCrosshair);
  const chartMode = useChartMode();
  const trades = useApp((s) => s.trades);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const totalPnl = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const autoTrade = useApp((s) => s.autoTrade);

  const autoTradeResult = useApp((s) => s.autoTradeResult);
  const hideAutoTradeResult = useApp((s) => s.hideAutoTradeResult);
  const [tradeTab, setTradeTab] = useState("auto");

  // Mobile only: which drawer is open. Only one at a time. While one is open
  // the chart and last-digit rings are hidden so the controls get the screen.
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("none");
  const panelOpen = mobilePanel !== "none";
  const wasOpen = useRef(false);

  // When the chart comes back from display:none, nudge it to re-measure itself.
  useEffect(() => {
    if (wasOpen.current && !panelOpen) {
      const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
      wasOpen.current = panelOpen;
      return () => window.clearTimeout(id);
    }
    wasOpen.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    const handler = () => setTradeTab("auto");
    window.addEventListener("gwave:focus-auto-tab", handler);
    return () => window.removeEventListener("gwave:focus-auto-tab", handler);
  }, []);

  // Rolling real-tick history for the last-digit stats (see store.ts).
  const tickHistory = useApp((s) => s.tickHistory);

  const zoom = (dir: "in" | "out" | "fit") =>
    window.dispatchEvent(new CustomEvent("gwave:zoom", { detail: dir }));

  const tradeTabs = (
    <Tabs value={tradeTab} onValueChange={setTradeTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="auto">
          Auto
          {autoTrade.isRunning && (
            <span className="ml-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          )}
        </TabsTrigger>
        <TabsTrigger value="manual">Manual</TabsTrigger>
      </TabsList>
      <TabsContent value="auto" className="pt-3">
        <AutoTradeControls />
      </TabsContent>
      <TabsContent value="manual" className="pt-3">
        <TradeControls />
      </TabsContent>
    </Tabs>
  );

  return (
    <AuthGuard>
      <AppShell>
        {/* On mobile the page scrolls normally; on desktop it is a fixed 3-column layout */}
        <div className="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* Left positions sidebar (desktop) */}
          <aside className="hidden md:flex w-[240px] shrink-0 flex-col overflow-hidden border-r border-border bg-background">
            <div className="border-b border-border px-3 py-2 text-sm font-semibold">Positions</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <Positions />
            </div>
          </aside>

          {/* Chart area */}
          <div className="flex shrink-0 flex-col md:min-h-0 md:flex-1 md:shrink">
            {/* Top selectors */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background p-2">
              <div className="min-w-[200px] max-w-xs flex-1">
                <VolatilityIndicator />
              </div>
              <ContractSelector />
            </div>

            {/* Chart: short fixed height on mobile, fills the space on desktop.
                Hidden on mobile while a drawer is open. */}
            <div
              className={`relative h-[220px] shrink-0 md:h-auto md:min-h-0 md:flex-1 md:shrink ${
                panelOpen ? "hidden md:block" : ""
              }`}
            >
              <PriceChart />
              {/* Zoom + crosshair controls */}
              <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex flex-col gap-1 rounded-md bg-card/80 p-1 backdrop-blur">
                <button onClick={() => zoom("in")} className="grid h-7 w-7 place-items-center rounded hover:bg-accent" aria-label="Zoom in">
                  <Plus className="h-4 w-4" />
                </button>
                <button onClick={toggleCrosshair} className="grid h-7 w-7 place-items-center rounded hover:bg-accent" aria-label="Toggle crosshair">
                  {crosshair ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button onClick={() => zoom("out")} className="grid h-7 w-7 place-items-center rounded hover:bg-accent" aria-label="Zoom out">
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={toggleChartMode}
                  className="grid h-7 w-7 place-items-center rounded hover:bg-accent"
                  aria-label="Toggle smooth chart"
                  title={chartMode === "smooth" ? "Smooth (click for tick speed)" : "Tick speed (click for smooth)"}
                >
                  {chartMode === "smooth" ? <Spline className="h-4 w-4" /> : <Activity className="h-4 w-4 text-muted-foreground" />}
                </button>
              </div>
            </div>

            {/* Last-digit frequency rings: hidden on mobile while a drawer is open */}
            <div className={panelOpen ? "hidden md:block" : ""}>
              <DigitStats prices={tickHistory} />
            </div>

            {/* Footer total P/L + clock */}
            <div className="flex items-center justify-between border-t border-border bg-background px-3 py-1.5 text-xs">
              <div>
                Total P/L:{" "}
                <span className={totalPnl >= 0 ? "text-primary font-semibold" : "text-destructive font-semibold"}>
                  {totalPnl >= 0 ? "+" : ""}
                  {formatMoney(totalPnl, currency, fxRate)}
                </span>
              </div>
              <div className="font-mono">
                {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
              </div>
            </div>
          </div>

          {/* Right side panel */}
          <aside className="flex w-full flex-1 flex-col border-t border-border bg-background md:w-[260px] md:flex-none md:shrink-0 md:overflow-y-auto md:border-l md:border-t-0 md:p-3">
            {/* Mobile: Trade is a toggle, Positions fills the remaining space */}
            <div className="flex flex-1 flex-col md:hidden">
              <Collapsible
                open={mobilePanel === "trade"}
                onOpenChange={(o) => setMobilePanel(o ? "trade" : "none")}
              >
                <CollapsibleTrigger className="group flex w-full items-center justify-between border-b border-border px-3 py-2 text-sm font-semibold">
                  <span className="flex items-center">
                    Trade
                    {autoTrade.isRunning && (
                      <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 transition group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="p-3">{tradeTabs}</CollapsibleContent>
              </Collapsible>

              <div className={`min-h-[260px] flex-1 flex-col ${panelOpen ? "hidden" : "flex"}`}>
                <div className="border-b border-border px-3 py-2 text-sm font-semibold">Positions</div>
                <div className="flex-1 p-3">
                  <Positions />
                </div>
              </div>
            </div>

            {/* Desktop layout */}
            <div className="hidden md:block">{tradeTabs}</div>
          </aside>
        </div>

        {/* Auto Trade Result Modal */}
        {autoTradeResult.result && (
          <AutoTradeResultModal
            open={autoTradeResult.show}
            onOpenChange={hideAutoTradeResult}
            result={{
              ...autoTradeResult.result,
              currency,
              fxRate,
            }}
          />
        )}
      </AppShell>
    </AuthGuard>
  );
}
