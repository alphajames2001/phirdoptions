import { useEffect, useState } from "react";
import { useApp, formatMoney } from "@/lib/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, expiresAt - now);
  const s = Math.floor(remaining / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <span className="font-mono text-xs">{mm}:{ss}</span>;
}

export function Positions() {
  const trades = useApp((s) => s.trades);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const price = useApp((s) => s.price);
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status !== "open");

  return (
    <Tabs defaultValue="open" className="w-full">
      <TabsList className="grid w-full grid-cols-2 bg-transparent p-0">
        <TabsTrigger value="open" className="data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
          Open Positions
        </TabsTrigger>
        <TabsTrigger value="closed" className="data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
          Closed positions
        </TabsTrigger>
      </TabsList>
      <TabsContent value="open" className="space-y-2 pt-2">
        {open.length === 0 && <div className="px-1 py-4 text-center text-xs text-muted-foreground">No open positions</div>}
        {open.map((t) => {
          const livePnl = t.direction === "rise" ? price - t.entryPrice : t.direction === "fall" ? t.entryPrice - price : 0;
          return (
            <div key={t.id} className="rounded-md bg-card p-3 text-sm">
              <div className="flex justify-between">
                <div className="font-semibold capitalize">{t.direction}</div>
                <Countdown expiresAt={t.expiresAt} />
              </div>
              <div className="text-xs text-muted-foreground">Volatility Index</div>
              <div className="mt-1 flex justify-between">
                <span>{formatMoney(t.stake, currency, fxRate)}</span>
                <span className={livePnl >= 0 ? "text-primary" : "text-destructive"}>
                  {livePnl >= 0 ? "+" : ""}
                  {livePnl.toFixed(3)}
                </span>
              </div>
            </div>
          );
        })}
      </TabsContent>
      <TabsContent value="closed" className="space-y-2 pt-2">
        {closed.length === 0 && <div className="px-1 py-4 text-center text-xs text-muted-foreground">No closed positions yet</div>}
        {closed.map((t) => (
          <div key={t.id} className="rounded-md bg-card p-3 text-sm">
            <div className="flex justify-between">
              <div className="font-semibold capitalize">{t.direction}</div>
              <span className={(t.pnl ?? 0) >= 0 ? "text-primary" : "text-destructive"}>
                {(t.pnl ?? 0) >= 0 ? "+" : ""}
                {formatMoney(t.pnl ?? 0, currency, fxRate)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Stake {formatMoney(t.stake, currency, fxRate)} · {t.status}
            </div>
          </div>
        ))}
      </TabsContent>
    </Tabs>
  );
}