import { Inject, Injectable } from '@nestjs/common';
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
import type { GoTrueAuthClient, GoTrueResult } from '../../../../shared/supabase/gotrue-auth.client';
import { GOTRUE_AUTH_CLIENT, SUPABASE_CLIENT } from '../../../../shared/supabase/supabase.module';
import {
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
  type AuthSession,
} from '../../ports-out/auth-provider.port';

// mobile-auth-login design.md D-4: `error_code`/`error` values GoTrue's
// token endpoint has used across versions for "wrong password or unknown
// email" — matching both is cheap and mirrors `EMAIL_TAKEN_CODES` below.
const INVALID_CREDENTIALS_CODES = new Set(['invalid_grant', 'invalid_credentials']);

function extractGrantErrorCode(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const code = record.error_code ?? record.error;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Classifies a GoTrue token-endpoint result per mobile-auth-login
 * design.md D-4 — status-class only, never message text: a response was
 * received with 4xx ⇒ deterministic; 429/5xx ⇒ ambiguous. A malformed 200
 * body (missing a required field) is a GoTrue contract violation, same
 * class as `createAccount`'s "no user and no error" case below —
 * genuinely unknown outcome, not a 500.
 */
function classifyGrantResult(result: GoTrueResult): AuthSession {
  if (result.ok) return toAuthSession(result.body);
  if (result.status >= 400 && result.status < 500 && result.status !== 429) {
    const code = extractGrantErrorCode(result.body);
    if (code && INVALID_CREDENTIALS_CODES.has(code)) {
      throw new AuthProviderDeterministicError('invalid_credentials', result.body);
    }
    throw new AuthProviderDeterministicError('other', result.body);
  }
  throw new AuthProviderAmbiguousError(result.body);
}

function toAuthSession(body: unknown): AuthSession {
  const record = body as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
    user?: { id?: unknown };
  } | null;
  const accessToken = record?.access_token;
  const refreshToken = record?.refresh_token;
  const expiresAt = record?.expires_at;
  const userId = record?.user?.id;
  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresAt !== 'number' ||
    typeof userId !== 'string'
  ) {
    throw new AuthProviderAmbiguousError(new Error('GoTrue grant response missing required fields'));
  }
  return { accessToken, refreshToken, expiresAt, userId };
}

// Deterministic (safe-to-classify, no ambiguity about whether Auth actually
// wrote anything) `AuthError.code` values this adapter recognizes as
// "email already taken". `AuthApiError.code` — see `@supabase/auth-js`'s
// `error-codes.ts` — the GoTrue REST API has used both spellings across
// versions; matching both is cheap and avoids a false "ambiguous"
// classification on a perfectly clear 422/409.
const EMAIL_TAKEN_CODES = new Set(['email_exists', 'user_already_exists']);

/**
 * Classifies an `AuthError` per `auth-provisioning` spec + design.md D-B:
 * `status` in the 4xx range with a `code` GoTrue actually returned is
 * deterministic (the request was clearly rejected, nothing ambiguous about
 * whether a user got created); no `status` (network failure before a
 * response) or a 5xx is ambiguous — the write's outcome is unknown, so the
 * use case must recover forward, never compensate blindly.
 */
function classifyCreateAccountError(error: AuthError): never {
  if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    if (error.code && EMAIL_TAKEN_CODES.has(error.code)) {
      throw new AuthProviderDeterministicError('email_taken', error);
    }
    if (error.code === 'invalid_credentials') {
      throw new AuthProviderDeterministicError('invalid_credentials', error);
    }
    throw new AuthProviderDeterministicError('other', error);
  }
  throw new AuthProviderAmbiguousError(error);
}

/**
 * `AuthProvider` bound to `supabase-js`'s Auth Admin API (D-A: this client
 * is scoped to Auth Admin + Storage only, `shared/supabase/`). Lives under
 * `adapters/persistence/` — `core-api-hexagonal-layout`'s fixed folder
 * shape only enumerates `http|persistence|events`; this is the closest fit
 * for a non-HTTP-inbound, non-domain-event outbound integration adapter,
 * same as the 3 Kysely repositories, just backed by `auth.users` via a REST
 * API instead of directly via Kysely/`pg`. Naming (`supabase-auth.provider`,
 * not `kysely-*`) makes the distinction explicit for a reader.
 *
 * Per design.md D-B, this adapter's ONLY added responsibility beyond the
 * raw Auth Admin calls is classifying `createAccount` failures — it never
 * decides to compensate or retry; `RegistrarUsuarioUseCase` owns all of
 * that (`ports-in/registrar-usuario.use-case.ts`).
 */
@Injectable()
export class SupabaseAuthProvider implements AuthProvider {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(GOTRUE_AUTH_CLIENT) private readonly gotrueAuthClient: GoTrueAuthClient,
  ) {}

  async createAccount(email: string, password: string): Promise<string> {
    const { data, error } = await this.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) classifyCreateAccountError(error);
    if (!data.user) {
      // GoTrue contract violation (no error, no user) — genuinely unknown
      // outcome, same as any other unclassifiable response.
      throw new AuthProviderAmbiguousError(new Error('createUser returned no user and no error'));
    }
    return data.user.id;
  }

  /** Only succeeds if no `profiles` row exists for `id` (`ON DELETE RESTRICT`) — enforced by the DB, not here. */
  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(id);
    if (error) throw error;
  }

  /**
   * Used only by `RegistrarUsuarioUseCase`'s forward-recovery path (RAMA B,
   * low frequency by construction — only reached on an ambiguous
   * `createAccount` failure). `supabase-js`'s Admin API has no
   * get-by-email endpoint, so this scans one page of `listUsers` and
   * matches client-side.
   *
   * Known limitation, deliberately not solved here: this only searches the
   * first `perPage` users (below), so it can miss a match once the total
   * user base exceeds that page size. Acceptable for this change's scope —
   * revisit if/when GoTrue exposes a server-side email filter, or replace
   * with a paginated scan if the orphan-recovery rate in production
   * justifies the extra Admin API calls.
   */
  async findAccountByEmail(email: string): Promise<{ id: string } | null> {
    const { data, error } = await this.supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email === email);
    return match ? { id: match.id } : null;
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const result = await this.grantOrAmbiguous(() => this.gotrueAuthClient.passwordGrant(email, password));
    return classifyGrantResult(result);
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const result = await this.grantOrAmbiguous(() => this.gotrueAuthClient.refreshGrant(refreshToken));
    return classifyGrantResult(result);
  }

  /**
   * `'local'` scope, best-effort at the caller's discretion — this method
   * itself lets a failure propagate unchanged (design.md D-4a/D-5: the use
   * case is what swallows a revoke failure, not this adapter).
   */
  async revokeSession(accessToken: string): Promise<void> {
    await this.gotrueAuthClient.revoke(accessToken);
  }

  /** `GoTrueAuthClient` only rejects on a network failure/timeout — never message text, always ambiguous (design.md D-4). */
  private async grantOrAmbiguous(call: () => Promise<GoTrueResult>): Promise<GoTrueResult> {
    try {
      return await call();
    } catch (error) {
      throw new AuthProviderAmbiguousError(error);
    }
  }
}
