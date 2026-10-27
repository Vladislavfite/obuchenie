import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CurrentUser } from '@tbedu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

/* Состояние текущего пользователя.

   Список разделов и права приходят с сервера: интерфейс не решает сам,
   что показывать. Скрытая в меню кнопка всё равно защищена на бэкенде,
   но и показывать недоступное не нужно. */

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login(login: string, password: string, cabinet: 'admin' | 'manager' | 'employee'): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  can(permission: string): boolean;
  hasModule(code: string): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      setUser(await api.get<CurrentUser>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else if (!(e instanceof ApiError)) setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const value: AuthState = {
    user,
    loading,
    async login(loginName, password, cabinet) {
      const current = await api.post<CurrentUser>('/api/auth/login', { login: loginName, password, cabinet });
      queryClient.clear();
      setUser(current);
    },
    async logout() {
      await api.post('/api/auth/logout');
      queryClient.clear();
      setUser(null);
    },
    refresh,
    can: (permission) => !!user?.permissions.includes(permission),
    hasModule: (code) => !!user?.uiModules.some((m) => m.code === code),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return ctx;
}
