import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { setToken } from "@/lib/api";
import { AuthLayout } from "@/components/layout/AuthLayout";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Phird Options" },
      { name: "description", content: "Log in to your Phird Options account." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const setAuthenticated = useApp((s) => s.setAuthenticated);
  const fetchUserData = useApp((s) => s.fetchUserData);
  const syncAll = useApp((s) => s.syncAll);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.session && data.user) {
        const userId = data.user.id
        const userEmail = data.user.email ?? email
        const userName = data.user.user_metadata?.display_name ?? userEmail
        
        setToken(data.session.access_token);
        setAuthenticated(true, {
          id: userId,
          email: userEmail,
          name: userName,
        });
        
        await fetchUserData();
        await syncAll();
        
        toast.success("Welcome back!");
        navigate({ to: "/trade" });
      } else {
        toast.error("Login failed: No user data returned");
      }
    } catch (err: any) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to keep trading."
      footer={
        <>
          New to Phird Options?{" "}
          <Link to="/signup" className="text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleLogin}>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <a href="#" className="text-xs text-primary hover:underline">Forgot?</a>
          </div>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          type="submit"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Log in"}
        </Button>
      </form>

      <div className="relative my-2 flex items-center">
        <div className="flex-1 border-t border-border" />
        <span className="px-3 text-xs uppercase tracking-wider text-muted-foreground">or</span>
        <div className="flex-1 border-t border-border" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => toast("Google sign-in coming soon")}>Google</Button>
        <Button variant="outline" onClick={() => toast("Apple sign-in coming soon")}>Apple</Button>
      </div>
    </AuthLayout>
  );
}
