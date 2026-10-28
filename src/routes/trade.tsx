// src/routes/trade.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Plus, Minus, Eye, EyeOff, ChevronDown } from "lucide-react";
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

function TradePage() {
  useTickEngine();
  const now = useClock();
  const crosshair = useApp((s) => s.crosshairEnabled);
  const toggleCrosshair = useApp((s) => s.toggleCrosshair);
  const trades = useApp((s) => s.trades);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const totalPnl = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const autoTrade = useApp((s) => s.autoTrade);
  
  const autoTradeResult = useApp((s) => s.autoTradeResult);
  const hideAutoTradeResult = useApp((s) => s.hideAutoTradeResult);

  // Rolling real-tick history for the last-digit stats (see store.ts).
  const tickHistory = useApp((s) => s.tickHistory);

  const zoom = (dir: "in" | "out" | "fit") =>
    window.dispatchEvent(new CustomEvent("gwave:zoom", { detail: dir }));

  return (
    <AuthGuard>
      <AppShell>
        <div className="flex h-full flex-col md:flex-row">
          {/* Left positions sidebar */}
          <aside className="hidden md:flex w-[320px] shrink-0 flex-col overflow-hidden border-r border-border bg-background">
            <div className="border-b border-border px-3 py-2 text-sm font-semibold">Positions</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <Positions />
            </div>
          </aside>

          {/* Chart area */}
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Top selectors */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background p-2">
              <div className="min-w-[200px] max-w-xs flex-1">
                <VolatilityIndicator />
              </div>
              <ContractSelector />
            </div>

            <div className="relative min-h-0 flex-1">
              <PriceChart />
              {/* Zoom + crosshair controls */}
              <div className="absolute bottom-3 left-3 flex flex-col gap-1 rounded-md bg-card/80 p-1 backdrop-blur">
                <button onClick={() => zoom("in")} className="grid h-7 w-7 place-items-center rounded hover:bg-accent" aria-label="Zoom in">
                  <Plus className="h-4 w-4" />
                </button>
                <button onClick={toggleCrosshair} className="grid h-7 w-7 place-items-center rounded hover:bg-accent" aria-label="Toggle crosshair">
                  {crosshair ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button onClick={() => zoom("out")} className="grid h-7 w-7 place-items-center rounded hover:bg-accent" aria-label="Zoom out">
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Last-digit frequency rings */}
            <DigitStats prices={tickHistory} />

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
          <aside className="w-full md:w-[340px] shrink-0 overflow-y-auto border-t md:border-t-0 md:border-l border-border bg-background md:p-3">
            {/* Mobile collapsibles */}
            <div className="md:hidden">
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-sm font-semibold">
                  Trade
                  <ChevronDown className="h-4 w-4 transition data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="p-3">
                  <Tabs defaultValue="auto" className="w-full">
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
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Desktop layout */}
            <div className="hidden md:block">
              <Tabs defaultValue="auto" className="w-full">
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
            </div>
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
