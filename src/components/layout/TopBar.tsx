import { useEffect, useState } from "react";
import { ChevronDown, User, LayoutGrid, BarChart3, Wallet, Settings, Moon, Sun } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useApp, formatMoney, type AccountKind, type Currency } from "@/lib/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { DepositModal } from "@/components/trade/DepositModal";
import GLogo from "@/components/layout/GLogo";
import { toast } from "sonner";

const topNavItems = [
  { to: "/dashboard", icon: LayoutGrid, label: "Home" },
  { to: "/trade", icon: BarChart3, label: "Trade" },
  { to: "/wallet", icon: Wallet, label: "Wallet" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function TopBar() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [depositOpen, setDepositOpen] = useState(false);

  useEffect(() => {
    const handler = () => setDepositOpen(true);
    window.addEventListener('open-deposit', handler as EventListener);
    return () => window.removeEventListener('open-deposit', handler as EventListener);
  }, []);
  
  const account = useApp((s) => s.account);
  const setAccount = useApp((s) => s.setAccount);
  const demoBalance = useApp((s) => s.demoBalance);
  const realBalance = useApp((s) => s.realBalance);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const logout = useApp((s) => s.logout);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  const balance = account === "demo" ? demoBalance : realBalance;

  // "system" resolves to the OS preference so the icon always matches
  // what ThemeManager is actually applying to <html>.
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const handleAccountSwitch = (kind: AccountKind) => {
    if (kind === account) return;
    
    if (kind === 'real' && !isAuthenticated) {
      toast.info('Sign up to access real account');
      navigate({ to: '/signup' });
      return;
    }
    
    setAccount(kind);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 md:px-4">
      <div className="flex items-center gap-2 min-w-0">
        <GLogo className="h-7 w-7 shrink-0" />
        <span className="hidden md:inline text-lg font-heading tracking-[-0.01em]">Phird Options</span>
      </div>

      <nav className="hidden md:flex items-center gap-1 ml-4">
        {topNavItems.map((n) => {
          const active = path.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-elevated text-primary"
                  : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground"
              }`}
            >
              <n.icon className="h-4 w-4" />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hidden md:flex h-9 w-9 items-center justify-center border border-border text-muted-foreground hover:bg-surface hover:text-foreground">
              <User className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate({ to: "/account" })}>
              <User className="mr-2 h-4 w-4" /> Account
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
              <Settings className="mr-2 h-4 w-4" /> Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="flex h-9 w-9 items-center justify-center border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 border border-border px-3 py-1.5 text-left hover:bg-surface">
              <div className="text-xs leading-tight">
                <div className="font-heading">
                  {account === "demo" ? "Demo Account" : "Real Account"}
                </div>
                <div className="text-muted-foreground">
                  <span className="uppercase">{currency}</span>{" "}
                  <span className="font-medium">
                    {formatMoney(balance, currency, fxRate).replace(/^[$]|^KSh\s/, "")}
                  </span>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Switch account</DropdownMenuLabel>
            <AccountItem 
              kind="demo" 
              active={account === "demo"} 
              balance={demoBalance} 
              currency={currency} 
              fxRate={fxRate} 
              onClick={() => handleAccountSwitch("demo")} 
            />
            <AccountItem 
              kind="real" 
              active={account === "real"} 
              balance={realBalance} 
              currency={currency} 
              fxRate={fxRate} 
              onClick={() => handleAccountSwitch("real")} 
            />
            {isAuthenticated && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => {
                    logout();
                    toast.success('Logged out');
                    navigate({ to: '/' });
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  Logout
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {isAuthenticated ? (
          <Button onClick={() => setDepositOpen(true)}>
            Deposit
          </Button>
        ) : (
          <Button onClick={() => navigate({ to: '/signup' })}>
            Sign Up
          </Button>
        )}
      </div>
      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} />
    </header>
  );
}

function AccountItem({ kind, active, balance, currency, fxRate, onClick }: { kind: AccountKind; active: boolean; balance: number; currency: Currency; fxRate: number; onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick} className="flex flex-col items-start gap-0.5 cursor-pointer">
      <div className="flex w-full items-center justify-between">
        <span className="font-medium">{kind === "demo" ? "Demo Account" : "Real Account"}</span>
                {active && <span className="text-xs">●</span>}
      </div>
      <span className="text-xs text-muted-foreground">{formatMoney(balance, currency, fxRate)}</span>
    </DropdownMenuItem>
  );
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}