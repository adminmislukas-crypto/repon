import { Inject, Injectable } from '@nestjs/common';
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../../../shared/supabase/supabase.module';
import {
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
} from '../../ports-out/auth-provider.port';

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
  constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

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
}
