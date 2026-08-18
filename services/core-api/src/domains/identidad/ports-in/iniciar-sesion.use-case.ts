import { Inject, Injectable } from '@nestjs/common';
import type { CompanyStatus, Profile } from '@repon/types';
import { ACTOR_PORT, type ActorPort } from '../../../shared/auth/ports/actor.port';
import {
  AuthProviderNoDisponibleError,
  CredencialesInvalidasError,
} from '../domain/identidad.errors';
import { assertSesionPermitida } from '../domain/sesion-elegibilidad';
import {
  AUTH_PROVIDER,
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
  type AuthSession,
} from '../ports-out/auth-provider.port';
import { PROFILE_REPOSITORY, type ProfileRepository } from '../ports-out/profile-repository.port';

export interface IniciarSesionCommand {
  email: string;
  password: string;
  /** Client-supplied, optional (design.md D-5). */
  expectedRole?: 'user' | 'provider';
}

export interface SesionResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  perfil: Profile;
  /** `null` for every role except `'provider'`. */
  companyStatus: CompanyStatus | null;
}

/**
 * mobile-auth-login design.md D-2/D-4a/D-5. Sequence: `AuthProvider.signIn`
 * -> `ActorPort.findActorById` -> `assertSesionPermitida` (status +
 * companyStatus + `expectedRole`, one call — see the deviation note below)
 * -> `ProfileRepository.findById` -> session-shaped result. Any refusal
 * after a successful grant revokes the just-minted GoTrue session first
 * (best-effort, swallowed) so no live token survives a 401/403 response —
 * the same "no partial session left behind" discipline design.md states as
 * an explicit success criterion.
 *
 * Deviation from design.md's Data Flow diagram, deliberate: the diagram
 * shows `expectedRole` checked as a step AFTER `ProfileRepository.findById`,
 * but `domain/sesion-elegibilidad.ts`'s `assertSesionPermitida` (built in
 * PR5, per tasks.md 6.2's explicit signature) already accepts `expectedRole`
 * as part of the same pure check. Calling it once, before the profile
 * fetch, avoids either duplicating the role-mismatch logic in a second
 * inline check or invoking the same pure function twice — and produces the
 * identical observable result (refused, revoked, no session data), just
 * without a wasted `ProfileRepository` read on the mismatch path.
 */
@Injectable()
export class IniciarSesionUseCase {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    @Inject(ACTOR_PORT) private readonly actorPort: ActorPort,
    @Inject(PROFILE_REPOSITORY) private readonly profileRepository: ProfileRepository,
  ) {}

  async execute(command: IniciarSesionCommand): Promise<SesionResult> {
    const session = await this.grantSession(command.email, command.password);

    const actor = await this.actorPort.findActorById(session.userId);
    if (!actor) {
      await this.revokeQuietly(session.accessToken);
      // v_auth_orphans case (identidad/SPEC.md): a valid grant with no
      // provisioned profile is never a 500, never a leaky 404 — same
      // refusal shape as any other bad-credentials outcome.
      console.warn('iniciarSesion: GoTrue grant succeeded but no profile is provisioned', {
        userId: session.userId,
      });
      throw new CredencialesInvalidasError();
    }

    try {
      assertSesionPermitida({
        role: actor.role,
        status: actor.status,
        companyStatus: actor.companyStatus,
        expectedRole: command.expectedRole,
      });
    } catch (error) {
      await this.revokeQuietly(session.accessToken);
      throw error;
    }

    const perfil = await this.profileRepository.findById(actor.profileId);
    if (!perfil) {
      // ActorPort already joined against `profiles` to resolve `actor` —
      // a miss here is a data-consistency bug, not a request path.
      throw new Error(
        'IniciarSesionUseCase: ActorPort resolved a profile that ProfileRepository could not find.',
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

  /**
   * Maps the adapter's generic `AuthProvider` failure taxonomy onto this
   * use case's domain errors — `'other'` collapses into
   * `CredencialesInvalidasError` alongside `'invalid_credentials'`,
   * deliberately (design.md D-4: "collapsed on purpose").
   */
  private async grantSession(email: string, password: string): Promise<AuthSession> {
    try {
      return await this.authProvider.signIn(email, password);
    } catch (error) {
      if (error instanceof AuthProviderDeterministicError) {
        throw new CredencialesInvalidasError(undefined, { cause: error });
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
      console.warn('iniciarSesion: best-effort revoke failed after a refusal', { error });
    }
  }
}
