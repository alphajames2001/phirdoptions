// src/routes/__root.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { ThemeManager } from "../components/layout/ThemeManager";
import { Toaster } from "@/components/ui/sonner";
import { DemoBadge } from "@/components/layout/DemoBadge";
import { useApp } from "@/lib/store";
import { getToken } from "@/lib/api";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Phird Options" },
      { name: "description", content: "Trade synthetic indices, 24/7" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const fetchUserData = useApp((s) => s.fetchUserData);
  const syncAll = useApp((s) => s.syncAll);
  const connectWebSocket = useApp((s) => s.connectWebSocket);
  const disconnectWebSocket = useApp((s) => s.disconnectWebSocket);

  // NOTE: useTickEngine() is intentionally NOT called here. trade.tsx
  // already calls it. Calling it in both places ran two settlement
  // watchdogs and two synthetic-price loops at once, fighting over the
  // same price/trade state.

  // 1) Restore the session from a saved token. Only fetches data; it no
  //    longer opens the WebSocket itself.
  useEffect(() => {
    const initApp = async () => {
      if (!getToken()) return;
      try {
        await fetchUserData();
        await syncAll();
      } catch (err) {
        console.error('Failed to initialize app:', err);
      }
    };
    initApp();
  }, []);

  // 2) Single owner of the WebSocket lifecycle. It used to be opened from
  //    initApp AND from an effect that re-ran on every volatility change,
  //    so connections were constantly torn down and raced each other.
  //    Symbol switches are handled by the store's setVolatility()
  //    (unsubscribe/subscribe on the live socket), so no reconnect needed.
  useEffect(() => {
    if (!isAuthenticated) return;
    connectWebSocket();
    return () => {
      disconnectWebSocket();
    };
  }, [isAuthenticated]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager />
      <Outlet />
      <Toaster richColors position="bottom-right" />
      <DemoBadge />
    </QueryClientProvider>
  );
}