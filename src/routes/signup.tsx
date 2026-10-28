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

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign up — Phird Options" },
      { name: "description", content: "Create your free Phird Options account in seconds." },
    ],
  }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const setAuthenticated = useApp((s) => s.setAuthenticated);
  const fetchUserData = useApp((s) => s.fetchUserData);
  const syncAll = useApp((s) => s.syncAll);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: name,
          },
        },
      });

      if (error) throw error;

      if (data.session && data.user) {
        const userId = data.user.id
        const userEmail = data.user.email ?? email
        const userName = data.user.user_metadata?.display_name ?? name
        
        setToken(data.session.access_token);
        setAuthenticated(true, {
          id: userId,
          email: userEmail,
          name: userName,
        });
        
        await fetchUserData();
        await syncAll();
        
        toast.success("Account created — welcome to Phird Options!");
        navigate({ to: "/trade" });
      } else if (data.user) {
        toast.info("Check your email for confirmation link!");
        navigate({ to: "/login" });
      } else {
        toast.error("Signup failed. Please try again.");
      }
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start with a $10,000 demo balance."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSignup}>
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input 
            id="name" 
            required 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="Alex Morgan" 
          />
        </div>
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
          <Label htmlFor="password">Password</Label>
          <Input 
            id="password" 
            type="password" 
            required 
            minLength={8} 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            placeholder="At least 8 characters" 
          />
        </div>
        <p className="text-xs text-muted-foreground">
          By signing up, you agree to the Terms of Service and acknowledge our Risk Disclosure.
        </p>
        <Button
          type="submit"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={loading}
        >
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
