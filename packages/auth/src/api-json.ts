import type { AuthClient } from './api-client';

/** `{ statusCode, code, message }` — the exact envelope every core-api error response carries. Sibling of `session-client.ts`'s `SesionApiError`, same shape, different package boundary (usuario-mobile-consumo design.md D-10). */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The request never reached core-api (offline, DNS, TLS) — Q6's visible-
 * failure case needs its own class, distinguishable from a 4xx `ApiError`.
 * `code` is always `'RED_NO_DISPONIBLE'`, matching `mensajes-error.ts`'s
 * key for this case.
 */
export class NetworkError extends Error {
  readonly code = 'RED_NO_DISPONIBLE';

  constructor() {
    super('Network request failed');
    this.name = 'NetworkError';
  }
}

export type AuthFetch = AuthClient['authFetch'];

/**
 * `authFetch`'s own `'authFetch called with no active session'`
 * (`api-client.ts:56`) is a programming error — calling this outside a
 * `RequireSession`-guarded tree — never a user-facing network state.
 * Propagates untouched (design.md D-10's pinned behaviour); every other
 * rejection from `authFetch` (the underlying `fetch()` itself failing:
 * offline, DNS, TLS) becomes `NetworkError`.
 */
async function callAuthFetch(authFetch: AuthFetch, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await authFetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.message === 'authFetch called with no active session') {
      throw error;
    }
    throw new NetworkError();
  }
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(response.status, body?.code ?? 'UNKNOWN_ERROR', body?.message ?? 'Unexpected error');
}

/** GET — no body, no `Content-Type`. `!response.ok` throws `ApiError`. */
export async function getJson<T>(authFetch: AuthFetch, path: string): Promise<T> {
  const response = await callAuthFetch(authFetch, path);
  if (!response.ok) throw await parseErrorBody(response);
  return (await response.json()) as T;
}

/**
 * POST with a JSON body — sets `Content-Type: application/json` and
 * `JSON.stringify`s, the two things `authFetch` explicitly leaves to the
 * caller (`api-client.ts:71`'s own doc comment). `!response.ok` throws
 * `ApiError`.
 */
export async function postJson<T>(authFetch: AuthFetch, path: string, body: unknown): Promise<T> {
  const response = await callAuthFetch(authFetch, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseErrorBody(response);
  return (await response.json()) as T;
}

/**
 * POST expecting `204 No Content` (e.g. `.../dosis`) — never calls
 * `.json()` on success; parsing an empty body throws.
 */
export async function postNoContent(authFetch: AuthFetch, path: string, body: unknown = {}): Promise<void> {
  const response = await callAuthFetch(authFetch, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseErrorBody(response);
}
