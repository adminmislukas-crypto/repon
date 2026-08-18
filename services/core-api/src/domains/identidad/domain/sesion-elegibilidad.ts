import type { CompanyStatus, ProfileStatus, Role } from '@repon/types';
import { EmpresaSuspendidaError, PerfilSuspendidoError, RolNoPermitidoError } from './identidad.errors';

export interface SesionElegibilidadInput {
  readonly role: Role;
  readonly status: ProfileStatus;
  /** `null` for every role except `'provider'`. */
  readonly companyStatus: CompanyStatus | null;
  /** Client-supplied, optional (design.md D-5) — the weakest of the three checks below. */
  readonly expectedRole?: 'user' | 'provider';
}

/**
 * mobile-auth-login design.md D-4a/D-5: the one shared eligibility check
 * `IniciarSesionUseCase` and `RefrescarSesionUseCase` both run immediately
 * after resolving the actor, before any session material is returned. Pure,
 * zero framework imports — same pattern as `assertProviderHasCompany`
 * (`domain/profile.entity.ts`).
 *
 * Order is load-bearing:
 * 1. `status` first — an account-level state, the most actionable message;
 *    the optional, client-supplied `expectedRole` must never be able to
 *    mask it.
 * 2. `companyStatus` second, and only for `role === 'provider'` (it is
 *    `null` for every other role). `'pendiente'` is NOT refused — a
 *    pending provider must be able to sign in to see its own approval
 *    state (spec: "A pending company is allowed to log in").
 * 3. `expectedRole` last (D-5) — the weakest of the three, since the
 *    client may simply omit the field.
 */
export function assertSesionPermitida(input: SesionElegibilidadInput): void {
  if (input.status === 'suspendido') {
    throw new PerfilSuspendidoError();
  }
  if (input.role === 'provider' && input.companyStatus === 'suspendido') {
    throw new EmpresaSuspendidaError();
  }
  if (input.expectedRole !== undefined && input.role !== input.expectedRole) {
    throw new RolNoPermitidoError();
  }
}
