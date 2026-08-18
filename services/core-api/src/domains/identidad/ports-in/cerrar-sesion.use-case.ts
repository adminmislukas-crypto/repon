import { Inject, Injectable } from '@nestjs/common';
import { AUTH_PROVIDER, type AuthProvider } from '../ports-out/auth-provider.port';

/**
 * mobile-auth-login design.md D-2: "logout is client-authoritative, server
 * best-effort" — `execute` always resolves, even when `revokeSession`
 * rejects. A GoTrue outage must never trap a caller in a signed-in state;
 * the client discards its stored tokens regardless of this call's outcome.
 * `'local'` scope only lives in `SupabaseAuthProvider`/`GoTrueAuthClient` —
 * this use case just forwards the token.
 */
@Injectable()
export class CerrarSesionUseCase {
  constructor(@Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider) {}

  async execute(accessToken: string): Promise<void> {
    try {
      await this.authProvider.revokeSession(accessToken);
    } catch (error) {
      console.warn('cerrarSesion: revoke failed — logout still succeeds client-side', { error });
    }
  }
}
