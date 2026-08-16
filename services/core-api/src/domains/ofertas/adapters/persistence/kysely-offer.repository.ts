import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { DatabaseError } from 'pg';
import type { Offer, OfferItemProactiva, OfferItemReactiva } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, OfferKindRow, OfferStatusRow } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import { OfertaYaAceptadaError } from '../../domain/oferta.errors';
import type { OfferRepository } from '../../ports-out/offer-repository.port';

/**
 * `KyselyOfferRepository`'s Kysely-backed implementation (design.md
 * "Wiring de módulos y estructura de archivos", `core-api-ofertas` "Puertos
 * de salida", tasks.md Phase 3a). One file across all 6 `OfferRepository`
 * methods — mirrors `KyselyRefillRepository`'s "one file per domain
 * repository" convention, not one file per method.
 */

type Executor = Kysely<DB> | Transaction<DB>;

// ============================================================
// Row -> domain mappers (design.md's "El gotcha de numeric sigue vigente"
// callout). `costo_despacho`/`total`/`precio` are `numeric(12,2)` -> STRING
// from the driver, always safe to `Number(...)` directly (never nullable).
// `alt_size`/`alt_qty` ARE nullable — `Number(null) === 0` would silently
// reintroduce the exact centinela `refill-matching`'s D3 rejected, so the
// conditional form below is the ONLY correct conversion (tasks.md 3a.1's
// explicit scenario: NULL survives as `undefined`, never `0`).
// ============================================================

const JOIN_SELECT = [
  'o.id as offer_id',
  'o.user_id',
  'o.refill_request_id',
  'o.company_id',
  'o.kind',
  'o.status',
  'o.tiempo_entrega_horas',
  'o.costo_despacho',
  'o.total',
  'o.mensaje',
  'i.id as item_id',
  'i.nombre',
  'i.refill_item_id',
  'i.provider_catalog_item_id',
  'i.is_alt',
  'i.alt_size',
  'i.alt_qty',
  'i.alt_note',
  'i.precio',
] as const;

interface OfferItemJoinRow {
  offer_id: string;
  user_id: string;
  refill_request_id: string | null;
  company_id: string;
  kind: OfferKindRow;
  status: OfferStatusRow;
  tiempo_entrega_horas: number;
  costo_despacho: string;
  total: string;
  mensaje: string | null;
  item_id: string;
  nombre: string;
  refill_item_id: string | null;
  provider_catalog_item_id: string | null;
  is_alt: boolean;
  alt_size: string | null;
  alt_qty: string | null;
  alt_note: string | null;
  precio: string;
}

/**
 * Row -> `OfferItemReactiva | OfferItemProactiva`, discriminated on which of
 * `refill_item_id`/`provider_catalog_item_id` is non-NULL (the migration
 * `05` CHECK guarantees exactly one). `alt_size`/`alt_qty` NULL -> `undefined`
 * explicitly — tasks.md 3a.1/3a.3's own scenario, never a naive `Number()`.
 * `id`/`nombre` (`backend-core-api-pedidos-pagos` design.md D-B.4, PR4):
 * `row.item_id` ya NO se descarta — antes de este cambio el `JOIN_SELECT`
 * ya lo traía pero `toOfferItem` lo tiraba, un hueco que ninguna Q había
 * nombrado hasta que el diseño de `pedidos-pagos` lo encontró.
 */
function toOfferItem(row: OfferItemJoinRow): OfferItemReactiva | OfferItemProactiva {
  const base = {
    id: row.item_id,
    nombre: row.nombre,
    precio: Number(row.precio),
    isAlt: row.is_alt,
    altNote: row.alt_note ?? undefined,
    altSize: row.alt_size === null ? undefined : Number(row.alt_size),
    altQty: row.alt_qty === null ? undefined : Number(row.alt_qty),
  };

  if (row.refill_item_id !== null) {
    return { ...base, refillItemId: row.refill_item_id } as OfferItemReactiva;
  }
  return {
    ...base,
    providerCatalogItemId: row.provider_catalog_item_id!,
  } as OfferItemProactiva;
}

/** Rows already grouped by `offer_id` -> a single `Offer`, discriminated on `kind`. */
function toOffer(rows: readonly OfferItemJoinRow[]): Offer {
  const first = rows[0]!;
  const items = rows.map(toOfferItem);
  const common = {
    id: first.offer_id,
    userId: first.user_id,
    companyId: first.company_id,
    status: first.status,
    tiempoEntregaHoras: first.tiempo_entrega_horas,
    costoDespacho: Number(first.costo_despacho),
    total: Number(first.total),
    mensaje: first.mensaje ?? undefined,
  };

  if (first.kind === 'reactiva') {
    return {
      ...common,
      kind: 'reactiva',
      refillRequestId: first.refill_request_id!,
      items: items as OfferItemReactiva[],
    };
  }
  return {
    ...common,
    kind: 'proactiva',
    items: items as OfferItemProactiva[],
  };
}

/** Groups already-joined rows by `offer_id`, preserving first-seen order. */
function groupRowsByOfferId(rows: readonly OfferItemJoinRow[]): OfferItemJoinRow[][] {
  const groups = new Map<string, OfferItemJoinRow[]>();
  for (const row of rows) {
    const group = groups.get(row.offer_id);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.offer_id, [row]);
    }
  }
  return [...groups.values()];
}

// ============================================================
// Domain -> row mappers (the write side of the same gotcha). `undefined`
// MUST land in Postgres as `NULL`, never a stringified `"0"`.
// ============================================================

function toOfferRowValues(offer: Offer) {
  return {
    id: offer.id,
    user_id: offer.userId,
    refill_request_id: offer.kind === 'reactiva' ? offer.refillRequestId : null,
    company_id: offer.companyId,
    kind: offer.kind,
    // SIEMPRE explícito (misma regla que refill_requests.estado,
    // design.md D-G's own table): nunca se apoya en el default 'pendiente'
    // de la columna.
    status: offer.status,
    tiempo_entrega_horas: offer.tiempoEntregaHoras,
    costo_despacho: offer.costoDespacho.toFixed(2),
    total: offer.total.toFixed(2),
    mensaje: offer.mensaje ?? null,
  };
}

function toOfferItemRowValues(offerId: string, item: OfferItemReactiva | OfferItemProactiva) {
  const refillItemId = 'refillItemId' in item ? (item.refillItemId ?? null) : null;
  const providerCatalogItemId =
    'providerCatalogItemId' in item ? (item.providerCatalogItemId ?? null) : null;

  return {
    // `id`/`nombre` explícitos (design.md D-B.4, PR4): `id` viene de la
    // factory (`randomUUID()`, nunca el default `Generated<string>` de la
    // columna — misma convención "ids desde la app" que `Offer.id`).
    id: item.id,
    offer_id: offerId,
    nombre: item.nombre,
    refill_item_id: refillItemId,
    provider_catalog_item_id: providerCatalogItemId,
    is_alt: item.isAlt,
    alt_size: item.altSize === undefined ? null : item.altSize.toString(),
    alt_qty: item.altQty === undefined ? null : item.altQty.toString(),
    alt_note: item.altNote ?? null,
    precio: item.precio.toFixed(2),
  };
}

@Injectable()
export class KyselyOfferRepository implements OfferRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext): Executor {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * INSERT-only (port doc comment, tasks.md 3a.1/3a.2): `Offer` entities are
   * immutable once persisted — acceptance is `marcarAceptada`'s narrow
   * 1-column UPDATE, never a rewrite of `items` via this method (design.md
   * D-D). One INSERT into `offers` (`status` always explicit) + one bulk
   * multi-row INSERT into `offer_items` — never N round-trips.
   */
  async save(offer: Offer, tx?: TransactionContext): Promise<void> {
    const executor = this.executor(tx);

    await executor.insertInto('offers').values(toOfferRowValues(offer)).execute();

    const itemRows = offer.items.map((item) => toOfferItemRowValues(offer.id, item));
    if (itemRows.length > 0) {
      await executor.insertInto('offer_items').values(itemRows).execute();
    }
  }

  /**
   * D11 — dueño. No filtra por dueño: trae la fila y el caller
   * (`AceptarOfertaUseCase`/`ObtenerBandejaUseCase`'s owner check) compara
   * `entity.userId` contra `actor.profileId` (tasks.md 3a.3/3a.4). 1 query
   * con join, items inline, nunca N+1.
   */
  async findById(offerId: string, tx?: TransactionContext): Promise<Offer | null> {
    const rows = await this.executor(tx)
      .selectFrom('offers as o')
      .innerJoin('offer_items as i', 'i.offer_id', 'o.id')
      .select(JOIN_SELECT)
      .where('o.id', '=', offerId)
      .execute();

    return rows.length === 0 ? null : toOffer(rows);
  }

  /**
   * `obtenerBandeja`'s read (Phase 7a). 1 query con join, items inline,
   * nunca N+1 — el agrupado por `offer_id` pasa por el mismo
   * `groupRowsByOfferId` que `findByRefillRequest` (tasks.md 3a.5/3a.6).
   */
  async findByUser(userId: string, tx?: TransactionContext): Promise<Offer[]> {
    const rows = await this.executor(tx)
      .selectFrom('offers as o')
      .innerJoin('offer_items as i', 'i.offer_id', 'o.id')
      .select(JOIN_SELECT)
      .where('o.user_id', '=', userId)
      .execute();

    return groupRowsByOfferId(rows).map(toOffer);
  }

  /**
   * D12 — transición angosta de 1 columna, NUNCA un `save()` que reescriba
   * `items` (design.md D-D). `tx` REQUERIDO (D-G.5): la atomicidad es la
   * definición de la operación, no una optimización.
   *
   * La violación del índice único parcial `offers_refill_request_id_
   * aceptada_uidx` se traduce acá, en el adaptador, nunca en el caso de
   * uso (R4) — un `code` de Postgres es vocabulario de infraestructura que
   * `ports-in/` no debe conocer, la misma frontera que
   * `CatalogQueryUnavailableError` ya establece. Cualquier otro error del
   * driver se re-lanza tal cual (mapea a 500).
   */
  async marcarAceptada(offerId: string, tx: TransactionContext): Promise<void> {
    try {
      await toKyselyTransaction(tx)
        .updateTable('offers')
        .set({ status: 'aceptada' })
        .where('id', '=', offerId)
        .execute();
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.code === '23505' &&
        error.constraint === 'offers_refill_request_id_aceptada_uidx'
      ) {
        throw new OfertaYaAceptadaError(offerId);
      }
      throw error;
    }
  }

  /**
   * D12 — una sola sentencia `UPDATE ... RETURNING id`; devuelve
   * exactamente los ids que ESTA sentencia movió a `'rechazada'`, sin
   * `SELECT` previo (design.md D-D: un `SELECT` seguido de un `UPDATE`
   * daría una lista que puede no coincidir con lo efectivamente movido —
   * una hermana nueva insertada entre ambas sentencias). `tx` REQUERIDO
   * (D-G.5).
   */
  async desplazarHermanas(
    refillRequestId: string,
    exceptoOfferId: string,
    tx: TransactionContext,
  ): Promise<readonly string[]> {
    const rows = await toKyselyTransaction(tx)
      .updateTable('offers')
      .set({ status: 'rechazada' })
      .where('refill_request_id', '=', refillRequestId)
      .where('id', '<>', exceptoOfferId)
      .where('status', '=', 'pendiente')
      .returning('id')
      .execute();

    return rows.map((row) => row.id);
  }

  /**
   * Existente, queda **declarado y sin caller** en este cambio (design.md
   * D-G.1, tasks.md 3a.11) — el displacement de `aceptarOferta` (D12) usa
   * `desplazarHermanas`, una sentencia con `RETURNING`, más correcta que
   * leer-y-después-escribir. Implementación real y trivial (misma forma
   * que `findByUser`, filtrada por `refill_request_id` en vez de
   * `user_id`) en vez de un "not implemented": tasks.md 3a.11 permite
   * cualquiera de las dos formas, y una implementación funcional es más
   * barata de mantener que una mina explosiva para quien la llame algún
   * día. Ningún `ports-in/` de este cambio la invoca.
   */
  async findByRefillRequest(refillRequestId: string, tx?: TransactionContext): Promise<Offer[]> {
    const rows = await this.executor(tx)
      .selectFrom('offers as o')
      .innerJoin('offer_items as i', 'i.offer_id', 'o.id')
      .select(JOIN_SELECT)
      .where('o.refill_request_id', '=', refillRequestId)
      .execute();

    return groupRowsByOfferId(rows).map(toOffer);
  }
}
