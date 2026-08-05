import { Inject, Injectable } from '@nestjs/common';
import type { Profile, Role } from '@repon/types';
import {
  AuthProviderError,
  EmailYaRegistradoError,
  RegistroFallidoError,
} from '../domain/identidad.errors';
import { assertProviderHasCompany, createProfile } from '../domain/profile.entity';
import { UsuarioRegistrado } from '../events/usuario-registrado.event';
import {
  AUTH_PROVIDER,
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
} from '../ports-out/auth-provider.port';
import { PROFILE_REPOSITORY, type ProfileRepository } from '../ports-out/profile-repository.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';

export interface RegistrarUsuarioCommand {
  email: string;
  password: string;
  nombre: string;
  telefono?: string;
  role: Role;
  /** Required iff `role === 'provider'` (`assertProviderHasCompany`). */
  companyId?: string;
}

/**
 * `auth-provisioning` spec + `core-api-identidad` spec's "registrarUsuario
 * owns the Auth-to-profiles compensation saga" requirement: this use
 * case — never the `AuthProvider` adapter — orchestrates all 3 steps and
 * every compensation decision (design.md D-B). See the sequence diagram in
 * design.md D-B for the 3 branches (RAMA A/B/C) this class implements.
 */
@Injectable()
export class RegistrarUsuarioUseCase {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    @Inject(PROFILE_REPOSITORY) private readonly profileRepository: ProfileRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(command: RegistrarUsuarioCommand): Promise<Profile> {
    // Validate before touching Auth: `createProfile` re-checks this same
    // invariant below, but validating it here first means an invalid
    // `provider` request never creates an Auth account it would then have
    // no clean way to compensate (the (2) step's compensation only exists
    // for failures AFTER a successful `createAccount`).
    assertProviderHasCompany(command.role, command.companyId);

    const uid = await this.createAccount(command.email, command.password);
    const profile = createProfile({
      id: uid,
      role: command.role,
      nombre: command.nombre,
      email: command.email,
      telefono: command.telefono,
      companyId: command.companyId,
    });

    await this.persistProfile(profile, uid);
    await this.eventPublisher.publish(new UsuarioRegistrado(profile));
    return profile;
  }

  /**
   * RAMA C (deterministic) and dispatch into RAMA B (ambiguous). A
   * deterministic failure means no account was ever created — nothing to
   * compensate.
   */
  private async createAccount(email: string, password: string): Promise<string> {
    try {
      return await this.authProvider.createAccount(email, password);
    } catch (error) {
      if (error instanceof AuthProviderDeterministicError) {
        if (error.reason === 'email_taken') throw new EmailYaRegistradoError(email);
        throw new AuthProviderError('El proveedor de autenticación rechazó la solicitud.', {
          cause: error,
        });
      }
      if (error instanceof AuthProviderAmbiguousError) {
        return this.recoverForward(email);
      }
      throw error;
    }
  }

  /**
   * RAMA B: never deletes. `null` is a clean, retryable failure; a found
   * account means Auth's write may well have succeeded, so the saga
   * re-attempts step (2) with that account's id instead.
   */
  private async recoverForward(email: string): Promise<string> {
    const existing = await this.authProvider.findAccountByEmail(email);
    if (!existing) {
      throw new RegistroFallidoError('No fue posible confirmar el registro. Intenta nuevamente.');
    }
    return existing.id;
  }

  /**
   * RAMA A: ANY `insertIfAbsent` failure compensates unconditionally —
   * `profiles.id -> auth.users.id ON DELETE RESTRICT` makes this safe by
   * construction even when the row actually was written (design.md D-B's
   * "insight that must not be lost").
   */
  private async persistProfile(profile: Profile, uid: string): Promise<void> {
    try {
      await this.profileRepository.insertIfAbsent(profile);
    } catch (cause) {
      await this.compensate(uid, cause);
    }
  }

  private async compensate(uid: string, cause: unknown): Promise<never> {
    try {
      await this.authProvider.deleteAccount(uid);
    } catch (deleteError) {
      // Compensation itself failed: `uid` is now orphaned (no `profiles`
      // row exists for it). Never retried here — `public.v_auth_orphans`
      // (identidad/SPEC.md) detects this within a 15-minute grace window.
      // No logger port exists at this layer and ports-in stays
      // framework-import-free (core-api-hexagonal-layout) — `console.error`
      // is the deliberate, minimal escape hatch, not `@nestjs/common`'s
      // `Logger`.
      console.error('registrarUsuario: orphaned auth account after failed compensation', {
        uid,
        deleteError,
      });
    }
    throw new RegistroFallidoError('No fue posible completar el registro.', { cause });
  }
}
