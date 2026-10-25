import { useEffect, useState } from "react";
import { ChevronDown, User } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
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

export function TopBar() {
  const navigate = useNavigate();
  const [depositOpen, setDepositOpen] = useState(false);
  
  const account = useApp((s) => s.account);
  const setAccount = useApp((s) => s.setAccount);
  const demoBalance = useApp((s) => s.demoBalance);
  const realBalance = useApp((s) => s.realBalance);
  const currency = useApp((s) => s.currency);
  const fxRate = useApp((s) => s.fxRate);
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const logout = useApp((s) => s.logout);

  const balance = account === "demo" ? demoBalance : realBalance;

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

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden md:flex h-9 w-9 items-center justify-center border border-border text-muted-foreground">
          <User className="h-4 w-4" />
        </div>

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