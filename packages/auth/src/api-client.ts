import type { AuthConfig } from './config';
import { refrescarSesion } from './session-client';
import { clearSession, loadSession, saveSession } from './session-storage';
import type { Sesion } from './session.types';

const REFRESH_THRESHOLD_SECONDS = 60;

export interface AuthClientCallbacks {
  /** Fired whenever the persisted session changes — a refresh (new value) or a sign-out (`null`). */
  onSessionChange?: (sesion: Sesion | null) => void;
}

export interface AuthClient {
  /** `path` is joined onto `config.apiBaseUrl` — callers never build the full URL themselves. */
  authFetch(path: string, init?: RequestInit): Promise<Response>;
}

/**
 * mobile-auth-login design.md D-6. One `createAuthClient(...)` call = one
 * instance-scoped `inFlight` — correct precisely because a device holds
 * exactly one session (the mirror image of why the backend's D-1 rejects
 * this same single-flight pattern on a *shared, multi-user* server
 * singleton: there, one in-flight slot risks leaking one user's refresh to
 * another; here, there is only ever one user).
 */
export function createAuthClient(config: AuthConfig, callbacks: AuthClientCallbacks = {}): AuthClient {
  let inFlight: Promise<Sesion> | null = null;

  async function refreshAndPersist(refreshToken: string): Promise<Sesion> {
    if (!inFlight) {
      inFlight = refrescarSesion(config, refreshToken).finally(() => {
        inFlight = null;
      });
    }
    const sesion = await inFlight;
    // Persisted before this function returns, so the retried request below
    // (and any concurrent caller awaiting the same `inFlight`) only ever
    // observes the fully-rotated pair — never a half-updated one.
    await saveSession(sesion);
    callbacks.onSessionChange?.(sesion);
    return sesion;
  }

  async function signOut(): Promise<void> {
    await clearSession();
    callbacks.onSessionChange?.(null);
  }

  function withBearer(init: RequestInit, accessToken: string): RequestInit {
    return { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } };
  }

  async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    let sesion = await loadSession();
    if (!sesion) {
      throw new Error('authFetch called with no active session');
    }

    // Proactive refresh: the common path never has to make a doomed
    // request and eat a 401 round-trip for a token about to expire anyway.
    const now = Math.floor(Date.now() / 1000);
    if (sesion.expiresAt - now < REFRESH_THRESHOLD_SECONDS) {
      try {
        sesion = await refreshAndPersist(sesion.refreshToken);
      } catch {
        await signOut();
        throw new Error('Proactive session refresh failed');
      }
    }

    const url = `${config.apiBaseUrl}${path}`;
    const response = await fetch(url, withBearer(init, sesion.accessToken));

    // 403 (PROFILE_SUSPENDED/COMPANY_SUSPENDED/ROL_NO_PERMITIDO) is a
    // correctly-authenticated request core-api rejected on purpose — never
    // a signal to refresh (design.md D-6: "403 is not 401", mirrors
    // AuthGuard's own reasoning for why suspension is 403 server-side, to
    // avoid exactly this client refresh-retry loop).
    if (response.status !== 401) {
      return response;
    }

    try {
      sesion = await refreshAndPersist(sesion.refreshToken);
    } catch {
      await signOut();
      return response;
    }

    // Exactly one retry, never a loop: a second 401 here signs out and the
    // caller sees that second response as-is.
    const retryResponse = await fetch(url, withBearer(init, sesion.accessToken));
    if (retryResponse.status === 401) {
      await signOut();
    }
    return retryResponse;
  }

  return { authFetch };
}
