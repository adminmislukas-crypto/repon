/**
 * design.md D-B: `AuthProvider`'s only responsibility beyond the raw
 * Supabase Auth calls is classifying step-1 failures —
 * `RegistrarUsuarioUseCase` (Phase 4b) owns all compensation, never this
 * adapter. No `tx?` parameter on this port: Auth is a separate system,
 * outside the SQL transaction (core-api-identidad spec).
 */
export class AuthProviderDeterministicError extends Error {
  constructor(
    readonly reason: 'email_taken' | 'invalid_credentials' | 'other',
    cause?: unknown,
  ) {
    super(`Auth provider deterministic failure: ${reason}`, { cause });
    this.name = 'AuthProviderDeterministicError';
  }
}

/** Timeout/5xx on `createAccount` — unknown whether the account was actually created. */
export class AuthProviderAmbiguousError extends Error {
  constructor(cause?: unknown) {
    super('Auth provider failure of unknown outcome', { cause });
    this.name = 'AuthProviderAmbiguousError';
  }
}

/**
 * mobile-auth-login design.md D-4: the identity a successful GoTrue grant
 * resolves to. `expiresAt` is unix seconds, straight from GoTrue — no
 * locally-minted token, no reinterpretation.
 */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly userId: string;
}

export interface AuthProvider {
  createAccount(email: string, password: string): Promise<string>;
  /** Only succeeds if no `profiles` row exists for `id` (`ON DELETE RESTRICT`). */
  deleteAccount(id: string): Promise<void>;
  findAccountByEmail(email: string): Promise<{ id: string } | null>;
  /**
   * mobile-auth-login design.md D-1/D-4. No `tx?` here either — same rule
   * as the three methods above, Auth stays outside the SQL transaction.
   * Rejects with `AuthProviderDeterministicError('invalid_credentials')` on
   * a 400/401 (wrong password or unknown email — indistinguishable by
   * design), `AuthProviderDeterministicError('other')` on any other 4xx, or
   * `AuthProviderAmbiguousError` on a 429/5xx/network failure/timeout. The
   * post-grant `profiles`/`companies` status check (D-4a) is the calling
   * use case's job, not this port's.
   */
  signIn(email: string, password: string): Promise<AuthSession>;
  /**
   * Same classification as `signIn`, except a 400/401 here means the
   * refresh token itself is expired/reused/rotated-away — the calling use
   * case (not this port) decides that maps to a different domain error
   * (`SesionExpiradaError`, not `CredencialesInvalidasError`).
   */
  refreshSession(refreshToken: string): Promise<AuthSession>;
  /**
   * `'local'` scope only, delegated straight through to
   * `GoTrueAuthClient.revoke`. Best-effort swallowing of a failure is the
   * caller's job (design.md D-4a/D-5) — this method lets a rejection
   * propagate unchanged.
   */
  revokeSession(accessToken: string): Promise<void>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
