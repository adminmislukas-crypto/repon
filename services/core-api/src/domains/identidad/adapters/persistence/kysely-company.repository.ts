import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { Company } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { CompaniesTable, DB } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { CompanyRepository } from '../../ports-out/company-repository.port';

function toDomain(row: Selectable<CompaniesTable>): Company {
  return {
    id: row.id,
    razonSocial: row.razon_social,
    rut: row.rut,
    giro: row.giro,
    status: row.status,
  };
}

/**
 * `save` upserts (insert-or-update on `id`) — unlike `ProfileRepository`,
 * `CompanyRepository` has no compensation-retry requirement, so one method
 * covers both `registrarEmpresa` (create) and `aprobarEmpresa`/
 * `suspenderEmpresa` (status mutation, Phase 4b).
 */
@Injectable()
export class KyselyCompanyRepository implements CompanyRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  async save(company: Company, tx?: TransactionContext): Promise<void> {
    const update = {
      razon_social: company.razonSocial,
      rut: company.rut,
      giro: company.giro,
      status: company.status,
    };
    await this.executor(tx)
      .insertInto('companies')
      .values({ id: company.id, ...update })
      .onConflict((oc) => oc.column('id').doUpdateSet(update))
      .execute();
  }

  async findById(id: string, tx?: TransactionContext): Promise<Company | null> {
    const row = await this.executor(tx)
      .selectFrom('companies')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  }
}
