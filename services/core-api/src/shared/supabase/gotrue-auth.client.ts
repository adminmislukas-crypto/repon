import type { SupabaseClient } from '@supabase/supabase-js';

export interface GoTrueResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Stateless direct-HTTP client for Supabase GoTrue's password/refresh
 * grants (`design.md` D-1) — deliberately NOT a second `supabase-js`
 * client: `GoTrueClient._callRefreshToken` single-flights refreshes
 * without keying on the refresh token, which is unsafe for a shared
 * server-side singleton (verified in the installed `@supabase/auth-js`
 * source). Revocation is the one deliberate exception —
 * `SupabaseClient.auth.admin.signOut` is a stateless admin-API wrapper,
 * safe to reuse on the existing service-role `SUPABASE_CLIENT`.
 *
 * Never classifies a result — that's `SupabaseAuthProvider`'s job (D-4).
 * Resolves `{ ok, status, body }` for any HTTP response (2xx-5xx); rejects
 * only for a genuine network failure or the request timeout. Plain
 * constructor args, not NestJS-injected — `shared/supabase/supabase.module.ts`
 * wires it via a `useFactory` provider, same pattern as `SUPABASE_CLIENT`.
 */
export class GoTrueAuthClient {
  constructor(
    private readonly supabaseUrl: string,
    private readonly anonKey: string,
    private readonly supabaseClient: SupabaseClient,
  ) {}

  async passwordGrant(email: string, password: string): Promise<GoTrueResult> {
    return this.tokenRequest('password', { email, password });
  }

  async refreshGrant(refreshToken: string): Promise<GoTrueResult> {
    return this.tokenRequest('refresh_token', { refresh_token: refreshToken });
  }

  /** `'local'` scope only — signing out of one device must not kill the user's other devices (`design.md` D-2). */
  async revoke(accessToken: string): Promise<void> {
    await this.supabaseClient.auth.admin.signOut(accessToken, 'local');
  }

  private async tokenRequest(
    grantType: 'password' | 'refresh_token',
    body: Record<string, string>,
  ): Promise<GoTrueResult> {
    const response = await fetch(`${this.supabaseUrl}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseBody: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body: responseBody };
  }
}
