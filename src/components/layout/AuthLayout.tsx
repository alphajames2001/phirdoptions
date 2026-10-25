import { Link } from "@tanstack/react-router";
import { ReactNode } from "react";
import GLogo from "./GLogo";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, footer, children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-transparent p-10 lg:flex">
        <div className="absolute inset-0">
          <img 
            src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&auto=format&fit=crop&q=80" 
            alt="Trading background"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 z-10 bg-gradient-to-br from-black/70 via-black/50 to-black/70" />
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-primary/20 via-transparent to-transparent" />
        </div>
        
        <Link to="/" className="relative z-20 flex items-center gap-2">
          <GLogo className="h-8 w-8" />
          <span className="text-xl font-heading tracking-[-0.01em] text-white">Phird Options</span>
        </Link>
        
        <div className="relative z-20 max-w-md space-y-4">
          <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg">
            Trade the world's most active markets.
          </h2>
          <p className="text-white/90 drop-shadow-lg">
            Real-time data, deep liquidity, and instant withdrawals — built for the modern trader.
          </p>
          <div className="grid grid-cols-3 gap-4 pt-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
              <div className="text-lg font-bold text-white">$4.2B+</div>
              <div className="text-xs text-white/80">Volume</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
              <div className="text-lg font-bold text-white">1.8M+</div>
              <div className="text-xs text-white/80">Users</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center border border-white/20">
              <div className="text-lg font-bold text-white">180+</div>
              <div className="text-xs text-white/80">Countries</div>
            </div>
          </div>
        </div>
        
        <div className="relative z-20 text-xs text-white/70">© 2026 Phird Options</div>
      </div>

      <div className="flex flex-col bg-background">
        <div className="flex items-center justify-between px-6 py-5 lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <GLogo className="h-7 w-7" />
            <span className="font-heading">Phird Options</span>
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {children}
            <div className="text-center text-sm text-muted-foreground">{footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
