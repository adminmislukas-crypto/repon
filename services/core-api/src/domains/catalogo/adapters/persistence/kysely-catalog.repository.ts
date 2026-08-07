import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { sql } from 'kysely';
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
 * Reverse of `mapProviderCatalogRow` — entity -> `insertInto('provider_
 * catalog')` values. `precioBase`/`precioMaximo` go back through the same
 * `numeric`-as-`string` gotcha (D-C): `.toFixed(2)`, never a raw `number`,
 * because by the time an item reaches `save()` the domain has already
 * rounded and validated it (`provider-catalog-item.entity.ts`) — this is
 * formatting, not re-rounding.
 */
function toProviderCatalogValues(item: ProviderCatalogItem) {
  return {
    id: item.id,
    company_id: item.companyId,
    catalog_product_id: item.catalogProductId ?? null,
    nombre: item.nombre,
    categoria: item.categoria,
    precio_base: item.precioBase.toFixed(2),
    precio_maximo: item.precioMaximo.toFixed(2),
    stock: item.stock,
    disponible: item.disponible,
    imagen_url: item.imagenUrl ?? null,
  };
}

/**
 * `CatalogRepository`'s Kysely-backed implementation (design.md "Wiring de
 * módulos y tokens"). Built incrementally across the chained PR sequence,
 * same as design.md's own §"Secuencia de implementación" table plans it:
 * Phase 3b landed the 4 read methods below; `save` (PR 4a) and `saveMany`
 * (PR 6, a loop over `save()`) complete the interface — every method not
 * yet implemented threw a named, loud error until its own PR landed, never
 * a silent no-op stub (same principle `catalogo.module.ts`'s original
 * placeholder doc comment already states for this domain).
 */
@Injectable()
export class KyselyCatalogRepository implements CatalogRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * design.md D-C: bifurcates on `item.catalogProductId` presence, matching
   * PR 1's two mutually-exclusive partial unique indexes — one is a plain
   * column list, the other an expression index (`lower(btrim(...))`), so
   * each branch declares its `ON CONFLICT` target differently (Kysely's
   * `.columns([...])` vs `.expression(...)`).
   *
   * Two hard rules for `DO UPDATE SET`, true in BOTH branches: never
   * `catalog_product_id` (branch 1's conflict key; setting it in branch 2
   * would silently move the row from one index to the other — re-linking a
   * loose item to a reference product is a deliberate operation, never a
   * side effect of re-uploading a file) and never `company_id` (part of
   * both keys, always forced upstream by D8's actor-derived `companyId`,
   * never mutated by an upsert).
   */
  async save(item: ProviderCatalogItem, tx?: TransactionContext): Promise<void> {
    const values = toProviderCatalogValues(item);
    const update = {
      nombre: values.nombre,
      categoria: values.categoria,
      precio_base: values.precio_base,
      precio_maximo: values.precio_maximo,
      stock: values.stock,
      disponible: values.disponible,
      imagen_url: values.imagen_url,
    };
    const insert = this.executor(tx).insertInto('provider_catalog').values(values);

    if (item.catalogProductId) {
      // provider_catalog_company_catalog_product_uidx (plain columns).
      await insert
        .onConflict((oc) =>
          oc
            .columns(['company_id', 'catalog_product_id'])
            .where('catalog_product_id', 'is not', null)
            .doUpdateSet(update),
        )
        .execute();
    } else {
      // provider_catalog_company_nombre_categoria_uidx — an EXPRESSION
      // index, so the conflict target is declared via `.expression(...)`,
      // not `.columns([...])` (Kysely: "Specify an expression as the
      // conflict target. This can be used if the unique index is an
      // expression index.").
      await insert
        .onConflict((oc) =>
          oc
            .expression(sql`company_id, lower(btrim(nombre)), lower(btrim(categoria))`)
            .where('catalog_product_id', 'is', null)
            .doUpdateSet(update),
        )
        .execute();
    }
  }

  /**
   * design.md D4 / "Mapa de transacciones": the port was born batch-shaped
   * so the FIRST adapter can be a loop over the already-tested `save()`
   * bifurcation — migrating this loop to a single
   * `UPDATE ... FROM (VALUES ...)` later never touches `save()`'s own
   * conflict-target logic, `ajustarPreciosPorCategoria`, or either's tests.
   * `tx` is forwarded unchanged to every `save()` call, same as every other
   * method's `executor(tx)` convention — `ajustarPreciosPorCategoria`
   * (PR 6) is the first caller, and it always passes the transaction's own
   * `tx` here so every write lands inside the SAME transaction as the
   * `findByCompanyAndCategoria` read that produced these items.
   */
  async saveMany(items: ProviderCatalogItem[], tx?: TransactionContext): Promise<void> {
    for (const item of items) {
      await this.save(item, tx);
    }
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
