// src/routes/settings.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGuard } from "@/components/layout/AuthGuard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useApp, type Theme, type Currency } from "@/lib/store";
import { Moon, Sun, Monitor, LogOut } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Phird Options — Settings" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const currency = useApp((s) => s.currency);
  const setCurrency = useApp((s) => s.setCurrency);
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const logout = useApp((s) => s.logout);

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate({ to: '/' });
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
          <h1 className="text-2xl font-bold">Settings</h1>
          
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Appearance</h2>
            <div className="text-xs text-muted-foreground">Theme</div>
            <div className="grid grid-cols-3 gap-2">
              {(["dark", "light", "system"] as Theme[]).map((t) => {
                const Icon = t === "dark" ? Moon : t === "light" ? Sun : Monitor;
                const active = theme === t;
                return (
                  <button 
                    key={t} 
                    onClick={() => setTheme(t)} 
                    className={`flex items-center justify-center gap-2 rounded-md border-2 px-3 py-3 capitalize cursor-pointer transition ${
                      active ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {t}
                  </button>
                );
              })}
            </div>
          </Card>
          
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Currency</h2>
            <div className="text-xs text-muted-foreground">Display all amounts in</div>
            <div className="grid grid-cols-2 gap-2">
              {(["USD", "KES"] as Currency[]).map((c) => {
                const active = currency === c;
                return (
                  <button 
                    key={c} 
                    onClick={() => setCurrency(c)} 
                    className={`rounded-md border-2 px-3 py-3 font-semibold cursor-pointer transition ${
                      active ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </Card>

          {isAuthenticated && (
            <Card className="space-y-3 p-5 border-destructive/20">
              <h2 className="font-semibold text-destructive">Account</h2>
              <div className="text-xs text-muted-foreground">Sign out of your account</div>
              <Button 
                variant="destructive" 
                onClick={handleLogout}
                className="w-full sm:w-auto"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </Card>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
