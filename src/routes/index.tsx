// index.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import GLogo from "@/components/layout/GLogo";
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  Globe2,
  TrendingUp,
  Wallet,
  LineChart,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Phird Options — Trade options" },
      {
        name: "description",
        content:
          "Phird Options is the fast, secure way to trade options. Live markets, instant deposits, withdrawals 24/7.",
      },
      { property: "og:title", content: "Phird Options — Trade options" },
      {
        property: "og:description",
        content:
          "Trade options with real-time charts, instant settlement, and 24/7 withdrawals.",
      },
    ],
  }),
  component: Landing,
});

// ✅ Kenyan names only (realistic M-Pesa users)
const KENYAN_NAMES = [
  "Daniel Kiprop",
  "Amina Mohamed",
  "Brian Ochieng",
  "Lerato Mwangi",
  "Carlos Otieno",
  "Wei Z. (M-Pesa)",
  "Aisha B. (M-Pesa)",
  "Tom L. (M-Pesa)",
  "Priya N. (M-Pesa)",
  "Diego F. (M-Pesa)",
  "Hassan Ali",
  "Maya Kipchoge",
  "Jonas H. (M-Pesa)",
  "Sofia P. (M-Pesa)",
  "Ravi T. (M-Pesa)",
  "Naledi M. (M-Pesa)",
  "Yuki S. (M-Pesa)",
  "Leo G. (M-Pesa)",
  "Zanele D. (M-Pesa)",
  "Omar R. (M-Pesa)",
  "Grace Wanjiru",
  "Peter Mwangi",
  "Sarah Muthoni",
  "James Kariuki",
  "Faith Atieno",
  "Simon Kamau",
  "Mary Akinyi",
  "John Odhiambo",
  "Esther Waithira",
  "Joseph Njoroge",
];

// ✅ Kenya only
const KENYAN_FLAG = "🇰🇪";

function genWithdrawal(id: number) {
  const name = KENYAN_NAMES[Math.floor(Math.random() * KENYAN_NAMES.length)];
  const amountKES = Math.floor(50 + Math.random() * 9950);
  // Convert KES to USD for display (approx 130 KES = 1 USD)
  const amountUSD = (amountKES / 130).toFixed(2);
  return {
    id,
    name,
    flag: KENYAN_FLAG,
    method: "M-Pesa",
    amountUSD: parseFloat(amountUSD),
    amountKES,
  };
}

function LiveWithdrawals() {
  const [items, setItems] = useState<ReturnType<typeof genWithdrawal>[]>([]);
  useEffect(() => {
    // ✅ Start with 8 Kenyan M-Pesa withdrawals
    setItems(Array.from({ length: 8 }, (_, i) => genWithdrawal(i)));
    let n = 8;
    const id = window.setInterval(() => {
      n += 1;
      setItems((prev) => [genWithdrawal(n), ...prev].slice(0, 8));
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
            <div className="border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full bg-foreground opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 bg-foreground" />
            </span>
          <h3 className="text-sm font-semibold">Live Withdrawals 🇰🇪</h3>
        </div>
        <span className="text-xs text-muted-foreground">Updated in real time</span>
      </div>
      <ul className="divide-y divide-border min-h-[400px]">
        {items.map((it, idx) => (
          <li
            key={it.id}
            className={`flex items-center justify-between py-2.5 text-sm ${
              idx === 0 ? "animate-in fade-in slide-in-from-top-2 duration-500" : ""
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elevated text-base">
                {it.flag}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{it.name}</div>
                <div className="truncate text-xs text-muted-foreground">M-Pesa</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono font-semibold text-primary">
                ${it.amountUSD.toLocaleString()} 
                <span className="text-[10px] text-muted-foreground font-normal">
                  {" "}(KES {it.amountKES.toLocaleString()})
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                withdrew
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MARKETS = [
  { sym: "VIX 100 (1s)", price: 1234.56, chg: 1.24 },
  { sym: "VIX 75",       price: 987.43,  chg: -0.55 },
  { sym: "VIX 50",       price: 4321.98, chg: 0.81 },
  { sym: "VIX 25",       price: 555.21,  chg: 2.13 },
  { sym: "Crash 1000",   price: 8204.10, chg: -1.07 },
  { sym: "Boom 1000",    price: 6892.55, chg: 0.42 },
];

function Ticker() {
  return (
    <div className="overflow-hidden border-y border-border bg-card/50">
      <div className="flex animate-[wave_40s_linear_infinite] gap-8 whitespace-nowrap py-3 text-sm">
        {[...MARKETS, ...MARKETS, ...MARKETS].map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="font-semibold">{m.sym}</span>
            <span className="font-mono text-muted-foreground">{m.price.toFixed(2)}</span>
            <span className="text-foreground">
              {m.chg >= 0 ? "+" : ""}{m.chg.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      <style>{`@keyframes wave { from {transform:translateX(0)} to {transform:translateX(-33.333%)} }`}</style>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2">
            <GLogo className="h-8 w-8" />
            <span className="text-xl font-heading tracking-[-0.01em]">Phird Options</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#markets" className="hover:text-foreground">Markets</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#withdrawals" className="hover:text-foreground">Live activity</a>
            <a href="#security" className="hover:text-foreground">Security</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden sm:inline-flex">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
              <Link to="/signup">
                <Button size="sm" className="text-background">Sign up</Button>
              </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10" />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 md:grid-cols-2 md:px-6 md:py-24">
          <div className="flex flex-col justify-center">
            <div className="mb-4 inline-flex w-fit items-center gap-2 border border-border bg-surface px-3 py-1 text-xs">
              <span className="h-1.5 w-1.5 bg-foreground" />
              Markets open 24/7 · Withdrawals in seconds
            </div>
            <h1 className="text-4xl font-heading leading-[1.05] tracking-[-0.01em] md:text-6xl">
              Trade options.<br />
              <span>Anytime, anywhere.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
              Phird Options brings institutional-grade options trading to your pocket.
              Real-time charts, low fees, and instant settlement — all in one app.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup">
                <Button size="lg" className="text-background">
                  Get started <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link to="/signup">
                <Button size="lg" variant="outline">Create free account</Button>
              </Link>
            </div>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-6 text-sm">
              <Stat n="$4.2B+" l="Volume traded" />
              <Stat n="1.8M+" l="Active users" />
              <Stat n="180+" l="Countries" />
            </div>
          </div>

          <div id="withdrawals" className="relative">
            <div className="absolute -inset-4 -z-10" />
            <LiveWithdrawals />
          </div>
        </div>
      </section>

      <Ticker />

      <section id="markets" className="mx-auto max-w-7xl px-4 py-20 md:px-6">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Popular markets</h2>
            <p className="mt-2 text-muted-foreground">Real-time, 24/7 — no overnight gaps.</p>
          </div>
          <Link to="/signup" className="text-sm text-primary hover:underline">
            Explore all markets →
          </Link>
        </div>
        <div className="overflow-hidden border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-heading">Market</th>
                <th className="px-4 py-3 text-right font-heading">Last price</th>
                <th className="px-4 py-3 text-right font-heading">24h change</th>
                <th className="hidden px-4 py-3 text-right font-heading md:table-cell">Trade</th>
              </tr>
            </thead>
            <tbody>
              {MARKETS.map((m) => (
                <tr key={m.sym} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-heading">{m.sym}</td>
                  <td className="px-4 py-3 text-right font-mono">${m.price.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    {m.chg >= 0 ? "+" : ""}{m.chg.toFixed(2)}%
                  </td>
                  <td className="hidden px-4 py-3 text-right md:table-cell">
                    <Link to="/signup">
                      <Button size="sm" variant="outline" className="text-foreground">Trade</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="features" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-6">
          <div className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-heading tracking-[-0.01em] md:text-4xl">Built for serious traders</h2>
            <p className="mt-2 text-muted-foreground">
              Powerful tools, transparent fees, and the speed of a modern exchange.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Feature icon={Zap} title="Instant execution" desc="Sub-second order matching, even during peak volatility." />
            <Feature icon={LineChart} title="Pro-grade charts" desc="Live tick data with precise visuals." />
            <Feature icon={Wallet} title="Instant withdrawals" desc="Cash out via M-Pesa, bank, or crypto in seconds." />
            <Feature icon={ShieldCheck} title="Bank-level security" desc="Cold storage, 2FA, and 24/7 monitoring." />
            <Feature icon={Globe2} title="Global access" desc="Trade from 180+ countries — no overnight gaps." />
            <Feature icon={TrendingUp} title="Options markets" desc="Clean, precise options trading." />
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto max-w-7xl px-4 py-20 md:px-6">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-heading tracking-[-0.01em] md:text-4xl">Your assets, protected.</h2>
            <p className="mt-3 text-muted-foreground">
              We hold the majority of customer funds in cold wallets, with multi-sig controls and
              real-time risk monitoring.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Proof of reserves published monthly",
                "Two-factor authentication on every account",
                "End-to-end encrypted payment channels",
                "$300M risk reserve fund",
              ].map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-foreground" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Tile k="99.99%" v="Uptime SLA" />
            <Tile k="< 50ms" v="Avg. order latency" />
            <Tile k="256-bit" v="AES encryption" />
            <Tile k="24/7" v="Customer support" />
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-20 text-center md:px-6">
          <h2 className="text-3xl font-heading tracking-[-0.01em] md:text-5xl">
            Start trading in 60 seconds.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Open an account for free and explore the markets with a $10,000 demo balance.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/signup">
              <Button size="lg">Create account</Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-4 md:px-6">
          <div>
            <div className="flex items-center gap-2">
              <GLogo className="h-6 w-6" />
              <span className="font-heading">Phird Options</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              The fastest way to trade options.
            </p>
          </div>
          <FooterCol title="Product" items={["Markets", "Trade", "Wallet", "Mobile app"]} />
          <FooterCol title="Company" items={["About", "Careers", "Press", "Contact"]} />
          <FooterCol title="Legal" items={["Terms", "Privacy", "Risk disclosure", "Cookies"]} />
        </div>
        <div className="border-t border-border px-4 py-5 text-center text-xs text-muted-foreground md:px-6">
          © 2026 Phird Options. Trading involves risk. Not suitable for everyone.
        </div>
      </footer>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{n}</div>
      <div className="text-xs text-muted-foreground">{l}</div>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }) {
  return (
    <div className="border border-border bg-surface p-6">
      <div className="mb-4 grid h-10 w-10 place-items-center border border-border">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="font-heading">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-border bg-surface p-5">
      <div className="text-2xl font-heading">{k}</div>
      <div className="text-xs text-muted-foreground">{v}</div>
    </div>
  );
}

function FooterCol({ title, items }: { title: string; items: string[] }) {
  const pathMap: Record<string, string> = {
    "Terms": "/terms",
    "Privacy": "/privacy",
    "Risk disclosure": "/risk",
    "Cookies": "/cookies",
  };
  
  return (
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((i) => (
          <li key={i}>
            <Link to={pathMap[i] || "#"} className="hover:text-foreground">
              {i}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}