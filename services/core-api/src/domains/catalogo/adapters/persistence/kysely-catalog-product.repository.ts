import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { CatalogProduct } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { CatalogProductsTable, DB } from '../../../../shared/database/schema';
import type { CatalogProductRepository } from '../../ports-out/catalog-product-repository.port';

function toDomain(row: Selectable<CatalogProductsTable>): CatalogProduct {
  return {
    id: row.id,
    nombre: row.nombre,
    categoria: row.categoria,
    marca: row.marca ?? undefined,
    presentacion: row.presentacion ?? undefined,
    imagenUrl: row.imagen_url ?? undefined,
    status: row.status,
  };
}

/**
 * `CatalogProductRepository`'s Kysely-backed implementation
 * (`ports-out/catalog-product-repository.port.ts`'s own doc comment
 * explains the gap-fill). No `tx?`/visibility-filter concerns — matches
 * `KyselyCompanyRepository`'s simple single-predicate shape (a single
 * `WHERE`, no anti-join, no cross-tenant branching), which is why this
 * file — like `KyselyCompanyRepository` — has no dedicated `.spec.ts`: the
 * repo's own convention reserves unit specs for adapters with real
 * branching/predicate complexity to lock down (see
 * `kysely-catalog.repository.spec.ts`/`kysely-audit-log.adapter.spec.ts`).
 * `buscarProductos`'s delegation is covered by
 * `buscar-productos.use-case.spec.ts` (port mocked) and by
 * `test/catalogo-buscar-productos.e2e-spec.ts` (full stack).
 */
@Injectable()
export class KyselyCatalogProductRepository implements CatalogProductRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async buscar(query: string, categoria?: string): Promise<CatalogProduct[]> {
    let q = this.db
      .selectFrom('catalog_products')
      .selectAll()
      .where('nombre', 'ilike', `%${query}%`);

    if (categoria !== undefined) {
      q = q.where('categoria', '=', categoria);
    }

    const rows = await q.execute();
    return rows.map(toDomain);
  }
}
