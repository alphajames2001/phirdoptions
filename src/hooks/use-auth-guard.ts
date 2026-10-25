import { useNavigate } from '@tanstack/react-router';
import { useApp } from '@/lib/store';
import { toast } from 'sonner';

export function useAuthGuard() {
  const navigate = useNavigate();
  const isAuthenticated = useApp((s) => s.isAuthenticated);
  const account = useApp((s) => s.account);

  const requireAuth = (action: string = 'perform this action') => {
    if (!isAuthenticated) {
      toast.error(`Please sign up or log in to ${action}`);
      navigate({ to: '/signup' });
      return false;
    }
    return true;
  };

  const requireRealAccount = (action: string = 'switch to real account') => {
    if (!isAuthenticated) {
      toast.info(`Sign up to ${action}`);
      navigate({ to: '/signup' });
      return false;
    }
    if (account !== 'real') {
      toast.info(`Switch to real account to ${action}`);
      return false;
    }
    return true;
  };

  return { requireAuth, requireRealAccount, isAuthenticated };
}