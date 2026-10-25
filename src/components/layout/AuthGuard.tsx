// src/components/layout/AuthGuard.tsx
import { ReactNode, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useApp } from "@/lib/store";

export function AuthGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const isLoading = useApp((s) => s.isLoading);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate({ to: "/login" });
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}