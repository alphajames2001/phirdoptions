// src/routes/dashboard.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGuard } from "@/components/layout/AuthGuard";
import { useApp, formatMoney } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { getPositionHistory, type Position } from "@/lib/api";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Phird Options — Dashboard" },
      { name: "description", content: "Your trading dashboard at a glance." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [recentTrades, setRecentTrades] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  
  const trades = useApp((s) => s.trades);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const account = useApp((s) => s.account);
  const demoBalance = useApp((s) => s.demoBalance);
  const realBalance = useApp((s) => s.realBalance);
  const fetchBalances = useApp((s) => s.fetchBalances);
  const syncTrades = useApp((s) => s.syncTrades);
  const isAuthenticated = useApp((s) => s.isAuthenticated);

  const balance = account === "demo" ? demoBalance : realBalance;
  const totalPnl = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const wins = trades.filter((t) => t.status === "won").length;
  const losses = trades.filter((t) => t.status === "lost").length;
  const winRate = wins + losses === 0 ? 0 : (wins / (wins + losses)) * 100;

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchBalances(),
        syncTrades(),
        loadRecentTrades(),
      ]);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentTrades = async () => {
    try {
      const response = await getPositionHistory(1, 10, account);
      if (response.success) {
        setRecentTrades(response.data.positions);
      }
    } catch (err) {
      console.error('Failed to load recent trades:', err);
    }
  };

  const getStatusColor = (status: string, outcome?: string) => {
    if (status === 'open') return 'text-yellow-500';
    if (outcome === 'win') return 'text-primary';
    if (outcome === 'loss') return 'text-destructive';
    return 'text-muted-foreground';
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
          <div>
            <h1 className="text-2xl font-bold">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Here's a snapshot of your activity.</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat 
                  label={`${account === "demo" ? "Demo" : "Real"} Balance`} 
                  value={formatMoney(balance, currency, fxRate)} 
                />
                <Stat 
                  label="Total P/L" 
                  value={formatMoney(totalPnl, currency, fxRate)} 
                  pos={totalPnl >= 0} 
                />
                <Stat label="Trades" value={String(trades.length)} />
                <Stat label="Win rate" value={`${winRate.toFixed(1)}%`} />
              </div>

              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold">Recent trades</h2>
                  <Link to="/trade" className="text-xs text-primary hover:underline">Open trading →</Link>
                </div>
                {trades.length === 0 && recentTrades.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No trades yet. Head to the Trade tab to place your first.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {(trades.length > 0 ? trades : recentTrades.map((p: Position) => ({
                      id: p.id,
                      direction: p.direction,
                      stake: parseFloat(p.stake),
                      pnl: p.outcome === 'win' ? parseFloat(p.potential_payout) - parseFloat(p.stake) : p.outcome === 'loss' ? -parseFloat(p.stake) : 0,
                      status: p.status === 'open' ? 'open' : p.outcome === 'win' ? 'won' : 'lost',
                      entryAt: new Date(p.created_at).getTime(),
                      contract: p.contract_type,
                      volatility: p.symbol,
                    }))).slice(0, 10).map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <div className="font-medium capitalize">{t.direction}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(t.entryAt).toLocaleString()}
                            {t.contract && ` · ${t.contract.replace('_', ' ')}`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div>{formatMoney(t.stake, currency, fxRate)}</div>
                          <div className={`text-xs ${getStatusColor(t.status, t.outcome)}`}>
                            {t.status === 'open' ? 'Open' : `${(t.pnl ?? 0) >= 0 ? '+' : ''}${formatMoney(t.pnl ?? 0, currency, fxRate)}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}

function Stat({ label, value, pos }: { label: string; value: string; pos?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${pos === undefined ? "" : pos ? "text-primary" : "text-destructive"}`}>
        {value}
      </div>
    </Card>
  );
}
