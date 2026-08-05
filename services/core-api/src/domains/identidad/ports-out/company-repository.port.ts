import type { Company } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

// core-api-identidad spec: `save` remains a single method here — no
// compensation-retry requirement exists for `companies` (unlike Profile).
export interface CompanyRepository {
  save(company: Company, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Company | null>;
}

export const COMPANY_REPOSITORY = Symbol('COMPANY_REPOSITORY');
