import type { Profile } from '@repon/types';
import { InvalidProfileError } from './identidad.errors';

export type { Profile };

export interface CreateProfileInput {
  id: string;
  role: Profile['role'];
  nombre: string;
  email: string;
  telefono?: string;
  companyId?: string;
}

/**
 * core-api-identidad's one domain invariant (tasks.md 4a.1): `role ===
 * 'provider' ⇒ companyId != null`. Exported separately (not only inlined in
 * `createProfile`) so `RegistrarUsuarioUseCase` (Phase 4b) can validate a
 * command BEFORE calling `AuthProvider.createAccount` — validating only
 * inside `createProfile` would mean an invalid request creates an orphaned
 * Auth account with nothing to compensate it (`createProfile` runs after
 * Auth succeeds in the saga).
 */
export function assertProviderHasCompany(role: Profile['role'], companyId?: string): void {
  if (role === 'provider' && !companyId) {
    throw new InvalidProfileError("role 'provider' requires a non-null companyId");
  }
}

/**
 * `status` is never accepted as input — a new profile always starts
 * `'activo'` (@repon/types doc comment); only `suspenderUsuario` (Phase 4b)
 * transitions it.
 */
export function createProfile(input: CreateProfileInput): Profile {
  assertProviderHasCompany(input.role, input.companyId);
  return {
    id: input.id,
    role: input.role,
    status: 'activo',
    nombre: input.nombre,
    email: input.email,
    telefono: input.telefono,
    companyId: input.companyId,
  };
}
