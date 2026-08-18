import { useEffect, type ReactNode } from 'react';
import { useSession } from './session-context';

export interface RequireSessionProps {
  /** Rendered while `state === 'authenticated'` and the role matches. */
  children: ReactNode;
  /** Rendered while `state === 'unauthenticated'` (typically a redirect to the login screen). */
  fallback: ReactNode;
}

/**
 * mobile-auth-login design.md D-5/D-6: a UX-only role gate — the real
 * security boundary is core-api's `AuthGuard`/`RolesGuard`, unaffected by
 * this component. Defense-in-depth against a role mismatch that somehow
 * reached storage despite `SessionProvider.signIn`'s own check (e.g. a
 * future direct-storage-write bug): discards the session outright rather
 * than rendering `children` with a token that belongs to the other app.
 *
 * Renders nothing while `state === 'loading'` — the app's root layout is
 * expected to hold its own splash screen for that state (`SessionProvider`
 * doc comment); this component only ever governs the authenticated vs.
 * unauthenticated split.
 */
export function RequireSession({ children, fallback }: RequireSessionProps): ReactNode {
  const { state, sesion, expectedRole, signOut } = useSession();

  const mismatched = state === 'authenticated' && sesion !== null && sesion.perfil.role !== expectedRole;

  useEffect(() => {
    if (mismatched) {
      void signOut();
    }
  }, [mismatched, signOut]);

  if (state === 'loading' || mismatched) {
    return null;
  }

  if (state !== 'authenticated') {
    return fallback;
  }

  return children;
}
