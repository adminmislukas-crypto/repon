import { Inject, Injectable } from '@nestjs/common';
import { ACTOR_PORT, type ActorPort } from '../../../shared/auth/ports/actor.port';
import { AuthProviderNoDisponibleError, SesionExpiradaError } from '../domain/identidad.errors';
import { assertSesionPermitida } from '../domain/sesion-elegibilidad';
import {
  AUTH_PROVIDER,
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
  type AuthSession,
} from '../ports-out/auth-provider.port';
import { PROFILE_REPOSITORY, type ProfileRepository } from '../ports-out/profile-repository.port';
import type { SesionResult } from './iniciar-sesion.use-case';

/**
 * mobile-auth-login design.md D-2: refresh re-resolves identity from
 * scratch — `ActorPort.findActorById` + `assertSesionPermitida` run again,
 * exactly as at login — so a suspension applied AFTER the original login
 * lands at the next refresh instead of only being caught by a fresh
 * sign-in. Same revoke-on-refusal discipline as `IniciarSesionUseCase`.
 *
 * Deliberately no `expectedRole` here (unlike `IniciarSesionUseCase`): the
 * client already proved its role match at the original login; refresh only
 * needs to catch a status/company change since then, not re-litigate the
 * app/role pairing. `assertSesionPermitida`'s `expectedRole` stays
 * `undefined`, which skips that third check entirely (`domain/sesion-elegibilidad.ts`).
 */
@Injectable()
export class RefrescarSesionUseCase {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    @Inject(ACTOR_PORT) private readonly actorPort: ActorPort,
    @Inject(PROFILE_REPOSITORY) private readonly profileRepository: ProfileRepository,
  ) {}

  async execute(refreshToken: string): Promise<SesionResult> {
    const session = await this.grantSession(refreshToken);

    const actor = await this.actorPort.findActorById(session.userId);
    if (!actor) {
      await this.revokeQuietly(session.accessToken);
      console.warn('refrescarSesion: refresh succeeded but no profile is provisioned', {
        userId: session.userId,
      });
      throw new SesionExpiradaError();
    }

    try {
      assertSesionPermitida({
        role: actor.role,
        status: actor.status,
        companyStatus: actor.companyStatus,
      });
    } catch (error) {
      await this.revokeQuietly(session.accessToken);
      throw error;
    }

    const perfil = await this.profileRepository.findById(actor.profileId);
    if (!perfil) {
      throw new Error(
        'RefrescarSesionUseCase: ActorPort resolved a profile that ProfileRepository could not find.',
      );
    }

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      perfil,
      companyStatus: actor.companyStatus,
    };
  }

  /** Deterministic (expired/reused/rotated-away token) -> `SesionExpiradaError`, not `CredencialesInvalidasError` — this is a refresh, not a fresh login. */
  private async grantSession(refreshToken: string): Promise<AuthSession> {
    try {
      return await this.authProvider.refreshSession(refreshToken);
    } catch (error) {
      if (error instanceof AuthProviderDeterministicError) {
        throw new SesionExpiradaError(undefined, { cause: error });
      }
      if (error instanceof AuthProviderAmbiguousError) {
        throw new AuthProviderNoDisponibleError(undefined, { cause: error });
      }
      throw error;
    }
  }

  private async revokeQuietly(accessToken: string): Promise<void> {
    try {
      await this.authProvider.revokeSession(accessToken);
    } catch (error) {
      console.warn('refrescarSesion: best-effort revoke failed after a refusal', { error });
    }
  }
}
