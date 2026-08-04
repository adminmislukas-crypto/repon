/**
 * Identidad domain — user profiles, companies, and admin role assignments.
 *
 * Source of truth for shapes: this file. `packages/types/SPEC.md` documents
 * it, it does not define it. DB row types (`snake_case`,
 * `services/core-api/src/shared/database/schema.ts`) MUST NOT be exported
 * from this package (D-A boundary — `shared-types-package` spec,
 * Requirement "DB row types never enter @repon/types").
 */

export type Role = 'user' | 'provider' | 'admin';

/**
 * A new company always starts `'pendiente'`. This is a creation-time
 * invariant, not a structural constraint on `Company` itself — an existing
 * company fetched from storage can legitimately be in any status. Enforced
 * by the `identidad` domain's `Company` factory
 * (`services/core-api/src/domains/identidad/domain/`, Phase 4a of
 * `backend-core-api-foundation`), not by this type.
 */
export type CompanyStatus = 'pendiente' | 'activo' | 'suspendido';

/**
 * A new profile always starts `'activo'` and transitions to `'suspendido'`
 * via `suspenderUsuario`/`suspenderEmpresa` — the record is never deleted.
 * Same caveat as `CompanyStatus`: a creation/transition invariant enforced
 * by the `identidad` domain's use cases (Phase 4a/4b), not a structural
 * constraint expressible on `Profile` itself.
 */
export type ProfileStatus = 'activo' | 'suspendido';

export type AdminRole = 'super_admin' | 'soporte' | 'finanzas';

export interface Company {
  id: string;
  razonSocial: string;
  rut: string;
  giro: string;
  status: CompanyStatus;
}

export interface CompanyDispatchZone {
  id: string;
  companyId: string;
  comuna: string;
  region: string;
}

export interface Profile {
  id: string;
  role: Role;
  status: ProfileStatus;
  nombre: string;
  email: string;
  telefono?: string;
  /** Only present when `role === 'provider'`. */
  companyId?: string;
}
