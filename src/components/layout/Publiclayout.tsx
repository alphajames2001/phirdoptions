// src/components/layout/PublicLayout.tsx
import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import GLogo from "./GLogo";

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 py-4 md:px-6">
          <Link to="/" className="flex items-center gap-2">
            <GLogo className="h-8 w-8" />
            <span className="text-xl font-heading tracking-[-0.01em]">Phird Options</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/login" className="text-muted-foreground hover:text-foreground">Log in</Link>
            <Link to="/signup">
              <span className="inline-flex items-center justify-center px-4 py-2 text-sm font-heading bg-foreground text-background [clip-path:polygon(10px_0,100%_0,100%_calc(100%-10px),calc(100%-10px)_100%,0_100%,0_10px)] hover:invert">
                Sign up
              </span>
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8 md:px-6">
        {children}
      </main>
      <footer className="border-t border-border mt-12">
        <div className="mx-auto max-w-7xl flex flex-wrap justify-center gap-6 px-4 py-6 text-sm text-muted-foreground">
          <a href="/terms" className="hover:text-foreground">Terms</a>
          <a href="/privacy" className="hover:text-foreground">Privacy</a>
          <a href="/risk" className="hover:text-foreground">Risk Disclosure</a>
          <a href="/cookies" className="hover:text-foreground">Cookies</a>
        </div>
        <div className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">
          © 2026 Phird Options. Trading involves risk. Not suitable for everyone.
        </div>
      </footer>
    </div>
  );
}
