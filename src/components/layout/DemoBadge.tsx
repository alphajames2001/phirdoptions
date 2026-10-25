import { useApp } from '@/lib/store';
import { useRouterState } from '@tanstack/react-router';

export function DemoBadge() {
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const path = useRouterState({ select: (s) => s.location.pathname });
  
  const isAppPage = ['/dashboard', '/trade', '/wallet', '/account', '/settings'].some(p => path.startsWith(p));
  
  if (isAuthenticated || !isAppPage) return null;
  
  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-full bg-yellow-500/20 border border-yellow-500/30 px-3 py-1.5 text-xs text-yellow-500 backdrop-blur-sm">
      ⚡ Demo Mode • <button 
        onClick={() => window.location.href = '/signup'}
        className="underline hover:no-underline"
      >
        Sign up for real account
      </button>
    </div>
  );
}