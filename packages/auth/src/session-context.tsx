import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createAuthClient, type AuthClient } from './api-client';
import type { AuthConfig } from './config';
import { SesionApiError, cerrarSesion, iniciarSesion } from './session-client';
import { clearSession, loadSession, saveSession } from './session-storage';
import type { Sesion } from './session.types';

/**
 * mobile-auth-login design.md D-6. `'loading'` is what makes "survives app
 * restart" true: the root layout holds its splash screen until this leaves
 * `'loading'`, so a stored session is applied before the first real screen
 * ever renders.
 */
export type SessionState = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionContextValue {
  state: SessionState;
  sesion: Sesion | null;
  /** The role this `SessionProvider` was configured with — `RequireSession` reads it from here, not a second prop. */
  expectedRole: 'user' | 'provider';
  authFetch: AuthClient['authFetch'];
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export interface SessionProviderProps {
  config: AuthConfig;
  children: ReactNode;
}

export function SessionProvider({ config, children }: SessionProviderProps): ReactNode {
  const [state, setState] = useState<SessionState>('loading');
  const [sesion, setSesion] = useState<Sesion | null>(null);

  const authClient = useMemo(
    () =>
      createAuthClient(config, {
        onSessionChange: (updated) => {
          setSesion(updated);
          setState(updated ? 'authenticated' : 'unauthenticated');
        },
      }),
    // `config` is expected to be a stable reference for the lifetime of the
    // app (each app constructs it once) — re-created only if it changes.
    [config],
  );

  useEffect(() => {
    let cancelled = false;
    void loadSession().then((stored) => {
      if (cancelled) return;
      setSesion(stored);
      setState(stored ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(email: string, password: string): Promise<void> {
    const next = await iniciarSesion(config, email, password);
    // mobile-session-client spec, "the client enforces its own expected
    // role and discards mismatched sessions": defense-in-depth alongside
    // core-api's own `expectedRole` check (design.md D-5/D-4a) — a session
    // whose role doesn't match this app is never persisted, even though
    // the server should already have refused it.
    if (next.perfil.role !== config.expectedRole) {
      throw new SesionApiError(
        403,
        'ROL_NO_PERMITIDO',
        'Esta cuenta no tiene el rol esperado para esta aplicación.',
      );
    }
    await saveSession(next);
    setSesion(next);
    setState('authenticated');
  }

  async function signOut(): Promise<void> {
    if (sesion) {
      // Best-effort — logout is client-authoritative (design.md D-2): local
      // state clears regardless of whether the network call succeeds.
      await cerrarSesion(config, sesion.accessToken).catch(() => undefined);
    }
    await clearSession();
    setSesion(null);
    setState('unauthenticated');
  }

  const value: SessionContextValue = {
    state,
    sesion,
    expectedRole: config.expectedRole,
    authFetch: authClient.authFetch,
    signIn,
    signOut,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
