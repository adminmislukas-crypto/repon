import type { CompanyStatus, ProfileStatus, Role } from '@repon/types';

/** The subset of `Profile` the session response carries (mirrors core-api's `ProfileResponseDto`). */
export interface PerfilSesion {
  id: string;
  role: Role;
  status: ProfileStatus;
  nombre: string;
  email: string;
  telefono?: string;
  companyId?: string;
}

/**
 * mobile-auth-login design.md D-6/D-2. `expiresAt` is unix seconds, straight
 * from GoTrue via core-api — never reinterpreted client-side. `companyStatus`
 * is non-null iff `perfil.role === 'provider'`; `'pendiente'` is a valid,
 * successful value (spec: a pending company is allowed to log in).
 */
export interface Sesion {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  perfil: PerfilSesion;
  companyStatus?: CompanyStatus;
}
