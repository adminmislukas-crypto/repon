import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ProviderCatalogItem, RefillItem } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB } from '../../../../shared/database/schema';
import {
  CatalogQueryUnavailableError,
  MAX_COINCIDENCIAS_POR_ITEM,
  type CatalogQueryPort,
} from '../../contracts/catalog-query.port';
import { mapProviderCatalogRow } from './kysely-catalog.repository';

/**
 * design.md D-B: `CatalogQueryPort`'s concrete implementation. Lives in
 * `adapters/persistence/`, never re-exported from `contracts/` (D1) — the
 * only importable-from-outside artifact is the interface + token in
 * `contracts/catalog-query.port.ts`.
 *
 * C1/C2: deliberately no `tx?` parameter anywhere on this class — it always
 * takes its own connection from the pool (never call this from inside a
 * `runInTransaction`).
 */
@Injectable()
export class KyselyCatalogQueryAdapter implements CatalogQueryPort {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async buscarCoincidencias(
    itemsSolicitados: RefillItem[],
    companyId?: string,
  ): Promise<ProviderCatalogItem[]> {
    // C6: zero items requested -> zero round trips. Not a degraded result
    // (D-B): "no items requested" is a real answer, not an infra failure.
    if (itemsSolicitados.length === 0) return [];

    try {
      let query = this.db
        .selectFrom('provider_catalog as pc')
        .selectAll('pc')
        // C5: filters `disponible`; NEVER filters by `stock`.
        .where('pc.disponible', '=', true)
        // C7: per item, exact catalogProductId match OR categoria exacta +
        // nombre por trigram — OR'd into ONE WHERE clause (not a UNION), so
        // "deduplicada por provider_catalog.id" falls out for free: a
        // single SELECT can never return the same row twice just because it
        // satisfies more than one item's branch.
        .where((eb) =>
          eb.or(
            itemsSolicitados.map((item) =>
              item.catalogProductId
                ? eb('pc.catalog_product_id', '=', item.catalogProductId)
                : eb.and([
                    eb('pc.categoria', '=', item.categoria),
                    eb('pc.nombre', 'ilike', `%${item.nombre}%`),
                  ]),
            ),
          ),
        )
        // C4/D-A: same anti-join predicate as
        // `KyselyCatalogRepository.findMatching` — "misma superficie
        // marketplace".
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
        );

      if (companyId !== undefined) {
        query = query.where('pc.company_id', '=', companyId);
      }

      // C7's "tope defensivo ... por ítem" is enforced here as an aggregate
      // ceiling (MAX_COINCIDENCIAS_POR_ITEM * item count), not as N
      // independent per-item SQL LIMITs. A strict per-item cap needs a
      // UNION ALL of N separately-LIMIT'd subqueries; this single-query OR
      // form is what makes C6's "one round trip" and the free dedup above
      // possible in one query plan. design.md names this cap "defensivo",
      // not a per-item hard invariant with its own spec.md scenario —
      // documented trade-off, not a silent gap.
      const rows = await query
        .limit(MAX_COINCIDENCIAS_POR_ITEM * itemsSolicitados.length)
        .execute();
      return rows.map(mapProviderCatalogRow);
    } catch (error) {
      // C8/D-B: never a degraded `[]` — always throw, `cause` preserved.
      throw new CatalogQueryUnavailableError(undefined, { cause: error });
    }
  }
}
