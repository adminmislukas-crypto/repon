import type { AuthConfig } from './config';
import type { PerfilSesion, Sesion } from './session.types';
import type { CompanyStatus } from '@repon/types';

/** `{ statusCode, code, message }` — the exact envelope every core-api error response carries. */
export class SesionApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SesionApiError';
  }
}

interface SesionResponseBody {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  expiresAt: number;
  perfil: PerfilSesion;
  companyStatus?: CompanyStatus;
}

function toSesion(body: SesionResponseBody): Sesion {
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresAt,
    perfil: body.perfil,
    companyStatus: body.companyStatus,
  };
}

async function parseErrorBody(response: Response): Promise<SesionApiError> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new SesionApiError(
    response.status,
    body?.code ?? 'UNKNOWN_ERROR',
    body?.message ?? 'Unexpected error',
  );
}

async function postJson(url: string, body: unknown): Promise<Sesion> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseErrorBody(response);
  return toSesion((await response.json()) as SesionResponseBody);
}

/**
 * mobile-auth-login design.md D-6: plain `fetch`, no `react-native` import —
 * this file (and `api-client.ts`) is the "logic unit-tests under plain
 * Jest `testEnvironment: node`" half of the package; only `session-context.tsx`
 * and `role-gate.tsx` touch React.
 */
export async function iniciarSesion(
  config: AuthConfig,
  email: string,
  password: string,
): Promise<Sesion> {
  return postJson(`${config.apiBaseUrl}/identidad/sesion`, {
    email,
    password,
    expectedRole: config.expectedRole,
  });
}

export async function refrescarSesion(config: AuthConfig, refreshToken: string): Promise<Sesion> {
  return postJson(`${config.apiBaseUrl}/identidad/sesion/refresco`, { refreshToken });
}

/**
 * Makes the network call and lets its outcome propagate — does NOT swallow
 * a failure itself. "Logout is client-authoritative, server best-effort"
 * (design.md D-2) is `session-context.tsx`'s job (it clears local storage
 * regardless of this call's outcome), not this thin API layer's.
 */
export async function cerrarSesion(config: AuthConfig, accessToken: string): Promise<void> {
  const response = await fetch(`${config.apiBaseUrl}/identidad/sesion`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw await parseErrorBody(response);
}
