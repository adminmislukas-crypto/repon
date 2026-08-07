import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { CatalogVisibilityProjection } from '../../ports-out/catalog-visibility-projection.port';

/**
 * design.md D-A: the write side of the `catalog_hidden_companies`
 * deny-list — the ONLY writer of this table is `CompanyVisibilityListener`
 * (via `OcultarCatalogoEmpresaUseCase`/`RestaurarCatalogoEmpresaUseCase`,
 * both in `ports-in/`). No `DELETE` exists anywhere in this schema, so both
 * methods are upsert/update, idempotent by construction (the port's own
 * doc comment).
 */
@Injectable()
export class KyselyCatalogVisibilityProjection implements CatalogVisibilityProjection {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * `ON CONFLICT (company_id) DO UPDATE SET oculto = true, motivo =
   * excluded.motivo` — `company_id` is this table's PK, so it is the only
   * possible conflict target. Setting `motivo` to the literal argument
   * value on the `DO UPDATE SET` branch is equivalent to referencing
   * `excluded.motivo`: both resolve to the value this call was invoked
   * with.
   */
  async ocultarEmpresa(
    companyId: string,
    motivo: string | null,
    tx?: TransactionContext,
  ): Promise<void> {
    await this.executor(tx)
      .insertInto('catalog_hidden_companies')
      .values({ company_id: companyId, oculto: true, motivo })
      .onConflict((oc) => oc.column('company_id').doUpdateSet({ oculto: true, motivo }))
      .execute();
  }

  /**
   * A plain `UPDATE`, never an upsert — a row missing entirely means the
   * company was never hidden, and a 0-rows-affected result is exactly that
   * case: success, not an error (the port's own doc comment). This method
   * deliberately does not inspect `numUpdatedRows`.
   */
  async mostrarEmpresa(companyId: string, tx?: TransactionContext): Promise<void> {
    await this.executor(tx)
      .updateTable('catalog_hidden_companies')
      .set({ oculto: false })
      .where('company_id', '=', companyId)
      .execute();
  }
}
