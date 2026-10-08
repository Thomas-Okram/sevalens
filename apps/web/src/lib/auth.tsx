import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@sevalens/shared';
import { api, ApiError } from './api';

interface AuthCtx {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get<{ user: SessionUser }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const onUnauth = () => qc.setQueryData(['me'], null);
    window.addEventListener('sevalens:unauthorized', onUnauth);
    return () => window.removeEventListener('sevalens:unauthorized', onUnauth);
  }, [qc]);

  const value: AuthCtx = {
    user: me.data ?? null,
    loading: me.isLoading,
    login: async (email, password) => {
      const { user } = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], user);
    },
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
