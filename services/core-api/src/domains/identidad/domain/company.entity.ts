import type { Company } from '@repon/types';

export type { Company };

export interface CreateCompanyInput {
  id: string;
  razonSocial: string;
  rut: string;
  giro: string;
}

/**
 * A new company always starts `'pendiente'` (@repon/types doc comment) —
 * `aprobarEmpresa` (Phase 4b) is the only transition to `'activo'`.
 */
export function createCompany(input: CreateCompanyInput): Company {
  return { ...input, status: 'pendiente' };
}
