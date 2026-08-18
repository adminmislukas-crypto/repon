export const REPON_AUTH_PACKAGE_ID = '@repon/auth';

export function reponAuthReady(): boolean {
  return true;
}

export { AuthWiringProbe } from './wiring-probe';
export type { AuthConfig } from './config';
export type { PerfilSesion, Sesion } from './session.types';
export { SesionApiError } from './session-client';
export type { AuthClient, AuthClientCallbacks } from './api-client';
export { SessionProvider, useSession } from './session-context';
export type { SessionContextValue, SessionProviderProps, SessionState } from './session-context';
export { RequireSession } from './role-gate';
export type { RequireSessionProps } from './role-gate';
