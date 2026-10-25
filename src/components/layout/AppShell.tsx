import { type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutGrid, BarChart3, Wallet, User, Settings, Moon, Sun, Monitor } from "lucide-react";
import { useApp } from "@/lib/store";
import { TopBar } from "./TopBar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { to: "/dashboard", icon: LayoutGrid, label: "Home" },
  { to: "/trade", icon: BarChart3, label: "Trade" },
  { to: "/wallet", icon: Wallet, label: "Wallet" },
];
const navItemsBottom = [
  { to: "/account", icon: User, label: "Account" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-20 shrink-0 flex-col items-center justify-between border-r border-border bg-sidebar py-4">
        <div className="flex flex-col items-center gap-2">
          {navItems.map((n) => {
            const active = path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex w-16 flex-col items-center gap-1 rounded-md py-2 text-xs transition ${
                  active
                    ? "bg-elevated text-primary"
                    : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground"
                }`}
              >
                <n.icon className="h-5 w-5" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="flex flex-col items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-16 flex-col items-center gap-1 py-2 text-xs text-muted-foreground hover:bg-surface hover:text-foreground">
                {theme === "light" ? (
                  <Sun className="h-5 w-5" />
                ) : theme === "system" ? (
                  <Monitor className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
                <span>Theme</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end">
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="mr-2 h-4 w-4" /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="mr-2 h-4 w-4" /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="mr-2 h-4 w-4" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {navItemsBottom.map((n) => {
            const active = path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex w-16 flex-col items-center gap-1 rounded-md py-2 text-xs transition ${
                  active
                    ? "bg-elevated text-primary"
                    : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground"
                }`}
              >
                <n.icon className="h-5 w-5" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        {/* Mobile bottom nav */}
        <nav className="md:hidden grid grid-cols-5 border-t border-border bg-sidebar">
          {[...navItems, ...navItemsBottom].map((n) => {
            const active = path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex flex-col items-center gap-1 py-2 text-[11px] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <n.icon className="h-5 w-5" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}