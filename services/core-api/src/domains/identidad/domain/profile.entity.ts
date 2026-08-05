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
 * 'provider' ⇒ companyId != null`. `status` is never accepted as input — a
 * new profile always starts `'activo'` (@repon/types doc comment); only
 * `suspenderUsuario` (Phase 4b) transitions it.
 */
export function createProfile(input: CreateProfileInput): Profile {
  if (input.role === 'provider' && !input.companyId) {
    throw new InvalidProfileError("role 'provider' requires a non-null companyId");
  }
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
