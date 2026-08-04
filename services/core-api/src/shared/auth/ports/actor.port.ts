import type { AdminRole, CompanyStatus, ProfileStatus, Role } from '@repon/types';

/**
 * Resolved once per request by `AuthGuard`, never cached (design.md D-E,
 * "Sin caché" — a cached actor is stale-authorization risk with cross-tenant
 * blast radius). `readonly` and free of raw JWT claims on purpose:
 * `core-api-auth-guard` spec, "AuthenticatedActor never crosses the ports-in
 * boundary" — nothing downstream can re-derive authority from unverified
 * data.
 */
export interface AuthenticatedActor {
  readonly profileId: string;
  readonly role: Role;
  /** Always `'activo'` if `AuthGuard` let the request through. */
  readonly status: ProfileStatus;
  /** Non-null iff `role === 'provider'`. */
  readonly companyId: string | null;
  /**
   * Non-null iff `role === 'provider'`. Loaded but never enforced by
   * `AuthGuard` — a suspended company still authenticates; blocking on it is
   * a business rule owned by each use case (design.md D-E).
   */
  readonly companyStatus: CompanyStatus | null;
  /** Non-null iff `role === 'admin'` and an `admin_roles` row exists. */
  readonly adminRole: AdminRole | null;
}

/**
 * Declared by the kernel, implemented by `identidad`
 * (`domains/identidad/contracts/identidad-actor.adapter.ts`, PR 6) —
 * inversion of dependency (design.md D-E). This file imports zero domain
 * code; `IdentidadModule` provides `ACTOR_PORT` and resolves the actor with
 * one JOIN (`profiles ⋈ admin_roles ⋈ companies`), never a per-field
 * round-trip.
 */
export interface ActorPort {
  findActorById(profileId: string): Promise<AuthenticatedActor | null>;
}

export const ACTOR_PORT = Symbol('ACTOR_PORT');
