import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { ProviderCatalogItem } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, ProviderCatalogTable } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { CatalogRepository } from '../../ports-out/catalog-repository.port';

/**
 * `precio_base`/`precio_maximo` round-trip through node-postgres as
 * `string` (design.md D-C's `numeric` gotcha) — this mapper is the ONE
 * place that conversion happens; `domain/provider-catalog-item.entity.ts`
 * only ever sees `number`. Exported so `KyselyCatalogQueryAdapter` (same
 * domain, `adapters/persistence/`) reuses it instead of re-declaring the
 * same row shape twice.
 */
export function mapProviderCatalogRow(row: Selectable<ProviderCatalogTable>): ProviderCatalogItem {
  return {
    id: row.id,
    companyId: row.company_id,
    catalogProductId: row.catalog_product_id ?? undefined,
    nombre: row.nombre,
    categoria: row.categoria,
    precioBase: Number(row.precio_base),
    precioMaximo: Number(row.precio_maximo),
    stock: row.stock,
    disponible: row.disponible,
    imagenUrl: row.imagen_url ?? undefined,
  };
}

/**
 * `CatalogRepository`'s Kysely-backed implementation (design.md "Wiring de
 * módulos y tokens"). Built incrementally across the chained PR sequence,
 * same as design.md's own §"Secuencia de implementación" table plans it:
 * Phase 3b lands the 4 read methods below; `save` (PR 4a) and `saveMany`
 * (PR 6) are declared here (the interface requires all 6) but throw a
 * named, loud error until their own PR implements them — a silent no-op
 * stub would be worse than a missing provider (same principle
 * `catalogo.module.ts`'s original placeholder doc comment already states
 * for this domain).
 */
@Injectable()
export class KyselyCatalogRepository implements CatalogRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  async save(item: ProviderCatalogItem, tx?: TransactionContext): Promise<void> {
    throw new Error(
      `KyselyCatalogRepository.save(itemId=${item.id}, tx=${tx ? 'given' : 'none'}) is ` +
        'implemented in PR 4a (backend-core-api-catalogo, design.md D-C upsert bifurcation) ' +
        '— not yet available.',
    );
  }

  async saveMany(items: ProviderCatalogItem[], tx?: TransactionContext): Promise<void> {
    throw new Error(
      `KyselyCatalogRepository.saveMany(count=${items.length}, tx=${tx ? 'given' : 'none'}) ` +
        'is implemented in PR 6 (backend-core-api-catalogo, ajustarPreciosPorCategoria) ' +
        '— not yet available.',
    );
  }

  async findById(itemId: string, tx?: TransactionContext): Promise<ProviderCatalogItem | null> {
    const row = await this.executor(tx)
      .selectFrom('provider_catalog')
      .selectAll()
      .where('id', '=', itemId)
      .executeTakeFirst();
    return row ? mapProviderCatalogRow(row) : null;
  }

  /**
   * design.md D-A: the provider's own read of their own catalog.
   * Deliberately UNFILTERED — a suspended company's own actor still reads
   * their own inventory (core-api-catalogo, "A suspended company's own
   * provider still reads their own catalog").
   */
  async findByCompany(companyId: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]> {
    const rows = await this.executor(tx)
      .selectFrom('provider_catalog')
      .selectAll()
      .where('company_id', '=', companyId)
      .execute();
    return rows.map(mapProviderCatalogRow);
  }

  /**
   * Same owner-scoped read as `findByCompany`, narrowed to one `categoria`
   * (powers `ajustarPreciosPorCategoria`, PR 6) — also unfiltered by
   * design, for the same reason.
   */
  async findByCompanyAndCategoria(
    companyId: string,
    categoria: string,
    tx?: TransactionContext,
  ): Promise<ProviderCatalogItem[]> {
    const rows = await this.executor(tx)
      .selectFrom('provider_catalog')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('categoria', '=', categoria)
      .execute();
    return rows.map(mapProviderCatalogRow);
  }

  /**
   * design.md D-A: the cross-tenant marketplace surface — "misma
   * superficie marketplace" as `CatalogQueryPort.buscarCoincidencias`. The
   * ONLY `CatalogRepository` read that applies the visibility anti-join
   * (verbatim predicate from design.md D-A):
   *
   * ```sql
   * and not exists (
   *   select 1 from public.catalog_hidden_companies h
   *   where h.company_id = pc.company_id and h.oculto
   * )
   * ```
   *
   * `catalog_hidden_companies` is empty until PR 8a's listener writes to
   * it — with zero rows, `NOT EXISTS` is trivially true for every
   * candidate row, so this predicate is a provable no-op today (see this
   * file's `.spec.ts`).
   */
  async findMatching(
    categoria: string,
    nombre: string,
    tx?: TransactionContext,
  ): Promise<ProviderCatalogItem[]> {
    const rows = await this.executor(tx)
      .selectFrom('provider_catalog as pc')
      .selectAll('pc')
      .where('pc.categoria', '=', categoria)
      .where('pc.nombre', 'ilike', `%${nombre}%`)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('catalog_hidden_companies as h')
              .select('h.company_id')
              .whereRef('h.company_id', '=', 'pc.company_id')
              .where('h.oculto', '=', true),
          ),
        ),
      )
      .execute();
    return rows.map(mapProviderCatalogRow);
  }
}
