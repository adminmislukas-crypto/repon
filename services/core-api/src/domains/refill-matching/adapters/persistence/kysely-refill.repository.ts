import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type {
  RefillEstadoActivo,
  RefillItem,
  RefillItemBorrador,
  RefillRequest,
  RefillRequestActiva,
  RefillRequestBorrador,
} from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, RefillEstadoRow, RefillUrgenciaRow } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { RefillRepository } from '../../ports-out/refill-repository.port';

/**
 * `KyselyRefillRepository`'s Kysely-backed implementation (design.md "Wiring
 * de módulos y tokens", `core-api-refill-matching` "Puertos de salida").
 * Built as one file across the 4 methods `RefillRepository` declares (tasks.md
 * Phase 3, tasks 3.1-3.10) — mirrors `KyselyConsumptionRepository`'s and
 * `KyselyCatalogRepository`'s "one file per domain repository" convention,
 * not one file per method.
 */

type Executor = Kysely<DB> | Transaction<DB>;

// ============================================================
// Row -> domain mappers (design.md's "Number(null) === 0" callout,
// tasks.md 3.5/3.6 — the single highest mechanical-risk item in this
// change). `precio_referencia` is `numeric(12,2)`: node-postgres returns it
// as a STRING, and it is ALSO nullable since batch 15 (design.md D4). A
// naive `Number(row.precio_referencia)` turns `null` into `0` — the exact
// centinela D3 rejects, silently making an incomplete borrador item look
// complete. The conditional form below is the ONLY correct conversion.
// ============================================================

const JOIN_SELECT = [
  'r.id as request_id',
  'r.user_id',
  'r.direccion',
  'r.comuna',
  'r.urgencia',
  'r.estado',
  'r.consumption_id',
  'i.id as item_id',
  'i.catalog_product_id',
  'i.nombre',
  'i.categoria',
  'i.precio_referencia',
] as const;

interface RefillRequestItemJoinRow {
  request_id: string;
  user_id: string;
  direccion: string | null;
  comuna: string | null;
  urgencia: RefillUrgenciaRow;
  estado: RefillEstadoRow;
  consumption_id: string | null;
  item_id: string;
  catalog_product_id: string | null;
  nombre: string;
  categoria: string | null;
  precio_referencia: string | null;
}

/**
 * Row -> `RefillItemBorrador`. `categoria`/`precioReferencia` map to
 * `undefined`, NEVER `0`/`''`, when the column is `NULL` — design.md's
 * callout, verbatim.
 */
export function toRefillItemBorrador(row: RefillRequestItemJoinRow): RefillItemBorrador {
  return {
    id: row.item_id,
    nombre: row.nombre,
    categoria: row.categoria ?? undefined,
    precioReferencia: row.precio_referencia === null ? undefined : Number(row.precio_referencia),
    catalogProductId: row.catalog_product_id ?? undefined,
  };
}

/**
 * Row -> `RefillItem` (the COMPLETE item, only reachable for a non-
 * `'borrador'` request). `categoria`/`precioReferencia` are non-nullable in
 * this type (D-B) — the invariant that guarantees a non-`'borrador'` row's
 * item columns are populated is enforced at write time
 * (`crearSolicitudActiva()`'s validation, `completar()`'s completeness
 * check, both Phase 2) and never re-validated by a Postgres CHECK (D4). A
 * `NULL` reaching here means that invariant was violated by a write this
 * mapper does not control — it throws rather than silently lying about the
 * type (e.g. coercing to `precioReferencia: 0`, the exact centinela D3
 * exists to reject).
 */
export function toRefillItem(row: RefillRequestItemJoinRow): RefillItem {
  if (row.categoria === null || row.precio_referencia === null) {
    throw new Error(
      `refill_items row ${row.item_id} belongs to a non-'borrador' request but has a NULL ` +
        'categoria/precio_referencia — completeness invariant violated outside this mapper.',
    );
  }
  return {
    id: row.item_id,
    nombre: row.nombre,
    categoria: row.categoria,
    precioReferencia: Number(row.precio_referencia),
    catalogProductId: row.catalog_product_id ?? undefined,
  };
}

/** Rows (already filtered to one request's items) -> `RefillRequestBorrador`. */
export function toRefillRequestBorrador(rows: RefillRequestItemJoinRow[]): RefillRequestBorrador {
  const first = rows[0]!;
  return {
    id: first.request_id,
    userId: first.user_id,
    urgencia: first.urgencia,
    consumptionId: first.consumption_id ?? undefined,
    estado: 'borrador',
    items: rows.map(toRefillItemBorrador),
    direccion: first.direccion ?? undefined,
    comuna: first.comuna ?? undefined,
  };
}

/** Rows (already filtered to one request's items) -> `RefillRequestActiva`. */
export function toRefillRequestActiva(
  rows: RefillRequestItemJoinRow[],
  estado: RefillEstadoActivo,
): RefillRequestActiva {
  const first = rows[0]!;
  if (first.direccion === null || first.comuna === null) {
    throw new Error(
      `refill_requests row ${first.request_id} is in state '${estado}' but has a NULL ` +
        'direccion/comuna — completeness invariant violated outside this mapper.',
    );
  }
  return {
    id: first.request_id,
    userId: first.user_id,
    urgencia: first.urgencia,
    consumptionId: first.consumption_id ?? undefined,
    estado,
    items: rows.map(toRefillItem),
    direccion: first.direccion,
    comuna: first.comuna,
  };
}

/** Rows -> `RefillRequest`, discriminating on `estado` (D-B). */
function mapJoinRows(rows: RefillRequestItemJoinRow[]): RefillRequest {
  const first = rows[0]!;
  return first.estado === 'borrador'
    ? toRefillRequestBorrador(rows)
    : toRefillRequestActiva(rows, first.estado);
}

// ============================================================
// Domain -> row mappers (the write side of the same gotcha). `undefined`
// MUST land in Postgres as `NULL`, never `0`/`''` — the reverse direction of
// the same centinela design.md's callout warns about.
// ============================================================

function toRequestRowValues(request: RefillRequest) {
  return {
    id: request.id,
    user_id: request.userId,
    direccion: request.direccion ?? null,
    comuna: request.comuna ?? null,
    urgencia: request.urgencia,
    // SIEMPRE explícito (design.md D-G.4): `estado` nunca se omite del
    // insert/update, nunca se apoya en el default `'abierta'` de la
    // columna — ese default es fail-open bajo D3.
    estado: request.estado,
    consumption_id: request.consumptionId ?? null,
  };
}

function toItemRowValues(refillRequestId: string, item: RefillItem | RefillItemBorrador) {
  return {
    id: item.id,
    refill_request_id: refillRequestId,
    catalog_product_id: item.catalogProductId ?? null,
    nombre: item.nombre,
    categoria: item.categoria ?? null,
    precio_referencia:
      item.precioReferencia === undefined ? null : item.precioReferencia.toFixed(2),
  };
}

@Injectable()
export class KyselyRefillRepository implements RefillRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext): Executor {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * Upsert keyed by `id` (port doc comment, D-G.2). The port's fixed
   * signature carries no "is this new?" flag, so this method decides via a
   * cheap existence check on `id` — the only read `save()` itself performs.
   * Two disjoint write paths follow, never mixed:
   *
   * - NEW (`crearSolicitud`/`crearBorradorRefill`, tasks.md 3.1/3.2): one
   *   INSERT into `refill_requests` + one bulk multi-row INSERT into
   *   `refill_items` — never N roundtrips.
   * - EXISTING (`completarBorrador`'s `'borrador' -> 'abierta'` transition,
   *   tasks.md 3.3/3.4): one UPDATE on `refill_requests` + items updated IN
   *   PLACE, keyed by `id` — never a DELETE, never a fresh INSERT of a row
   *   that already exists (criterio de éxito: "ningún DELETE físico
   *   introducido").
   */
  async save(request: RefillRequest, tx?: TransactionContext): Promise<void> {
    const executor = this.executor(tx);
    const existing = await executor
      .selectFrom('refill_requests')
      .select('id')
      .where('id', '=', request.id)
      .executeTakeFirst();

    if (existing) {
      await this.updateExistingRequest(executor, request);
    } else {
      await this.insertNewRequest(executor, request);
    }
  }

  private async insertNewRequest(executor: Executor, request: RefillRequest): Promise<void> {
    await executor.insertInto('refill_requests').values(toRequestRowValues(request)).execute();

    const itemRows = request.items.map((item) => toItemRowValues(request.id, item));
    if (itemRows.length > 0) {
      // Un solo statement multi-row — nunca N roundtrips (tasks.md 3.1).
      await executor.insertInto('refill_items').values(itemRows).execute();
    }
  }

  private async updateExistingRequest(executor: Executor, request: RefillRequest): Promise<void> {
    const { id: _id, ...requestUpdate } = toRequestRowValues(request);
    await executor
      .updateTable('refill_requests')
      .set(requestUpdate)
      .where('id', '=', request.id)
      .execute();

    // Cada ítem se actualiza EN SU LUGAR, keyeado por su propio id — nunca
    // un DELETE, nunca un INSERT de una fila que ya existe (tasks.md 3.3,
    // "ningún DELETE físico introducido").
    for (const item of request.items) {
      const {
        id: itemId,
        refill_request_id: _refillRequestId,
        ...itemUpdate
      } = toItemRowValues(request.id, item);
      await executor.updateTable('refill_items').set(itemUpdate).where('id', '=', itemId).execute();
    }
  }

  /**
   * Trae la solicitud con sus ítems en 1 select con join (port doc
   * comment). Poder de dueño lo verifica el caller (D13) — este método no
   * filtra por dueño, solo trae la fila.
   */
  async findById(id: string, tx?: TransactionContext): Promise<RefillRequest | null> {
    const rows = await this.executor(tx)
      .selectFrom('refill_requests as r')
      .innerJoin('refill_items as i', 'i.refill_request_id', 'r.id')
      .select(JOIN_SELECT)
      .where('r.id', '=', id)
      .execute();

    return rows.length === 0 ? null : mapJoinRows(rows);
  }

  /**
   * D-D.3 — dedup del listener de `RefillAutoSolicitado`. El predicado
   * filtra `estado = 'borrador'` EXPLÍCITAMENTE (tasks.md 3.7): un match de
   * `(user_id, consumption_id)` cuya fila ya transicionó fuera de
   * `'borrador'` no cuenta — devuelve `null`, no la fila.
   */
  async findBorradorByConsumption(
    userId: string,
    consumptionId: string,
    tx?: TransactionContext,
  ): Promise<RefillRequestBorrador | null> {
    const rows = await this.executor(tx)
      .selectFrom('refill_requests as r')
      .innerJoin('refill_items as i', 'i.refill_request_id', 'r.id')
      .select(JOIN_SELECT)
      .where('r.user_id', '=', userId)
      .where('r.consumption_id', '=', consumptionId)
      .where('r.estado', '=', 'borrador')
      .execute();

    return rows.length === 0 ? null : toRefillRequestBorrador(rows);
  }

  /**
   * D6/D-G.2 — transición pura de estado. Una sola sentencia angosta que
   * NUNCA toca `refill_items`: ni join, ni escritura en cascada, ni una
   * segunda query contra esa tabla — la razón de ser de este método en vez
   * de rutear `marcarComoOfertada`/`marcarComoConfirmada` por `save()`.
   */
  async actualizarEstado(
    id: string,
    estado: RefillEstadoActivo,
    tx?: TransactionContext,
  ): Promise<void> {
    await this.executor(tx)
      .updateTable('refill_requests')
      .set({ estado })
      .where('id', '=', id)
      .execute();
  }
}
