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

export interface AuthProvider {
  createAccount(email: string, password: string): Promise<string>;
  /** Only succeeds if no `profiles` row exists for `id` (`ON DELETE RESTRICT`). */
  deleteAccount(id: string): Promise<void>;
  findAccountByEmail(email: string): Promise<{ id: string } | null>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
