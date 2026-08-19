import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { UserConsumption } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, UserConsumptionTable } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type {
  ConsumptionCandidata,
  ConsumptionRepository,
} from '../../ports-out/consumption-repository.port';

/**
 * `dosis_por_toma`/`stock_actual` round-trip through node-postgres as
 * `string` (design.md's "detalle mecánico de mayor riesgo del cambio" —
 * the same `numeric` gotcha `catalogo`'s D-C already documented for
 * `precio_base`/`precio_maximo`). This mapper is the ONE place that
 * conversion happens; `domain/consumo.calculos.ts` and every use case only
 * ever see `number`. `stock_bajo_notificado_at` is deliberately NOT mapped
 * here (PR6b): this function returns a plain `UserConsumption`, shared by
 * `findById` and `findDueForCheck` alike, and `@repon/types.UserConsumption`
 * never carries the marker (design.md D15: "el resto sin cambios" —
 * consumo-internal bookkeeping, not a client-facing fact). The one caller
 * that needs the marker's current value (`findDueForCheck`) widens this
 * function's output with it directly at the call site, into
 * `ConsumptionCandidata`.
 */
export function mapUserConsumptionRow(row: Selectable<UserConsumptionTable>): UserConsumption {
  return {
    id: row.id,
    userId: row.user_id,
    ownerType: row.owner_type,
    petId: row.pet_id ?? undefined,
    kind: row.kind,
    nombre: row.nombre,
    dosisPorToma: Number(row.dosis_por_toma),
    unidad: row.unidad ?? undefined,
    frecuenciaDias: row.frecuencia_dias,
    horarios: row.horarios as [string, ...string[]],
    stockActual: Number(row.stock_actual),
    autoCrearRefill: row.auto_crear_refill,
  };
}

/**
 * Reverse of `mapUserConsumptionRow` — entity -> `insertInto('user_consumption')`
 * values. `dosisPorToma`/`stockActual` go back through the same
 * `numeric`-as-`string` gotcha: `.toFixed(2)`, never a raw `number` — by the
 * time an item reaches `save()` the domain has already validated it
 * (`user-consumption.entity.ts`'s `crear()`), this is formatting, not
 * re-validating. `stock_bajo_notificado_at` is deliberately absent from both
 * `values` and `update` here — D-A: it is written ONLY by the two narrow CAS
 * methods (`intentarMarcarStockBajo`/`limpiarMarcaStockBajo`, PR 6a),
 * `save()` never touches it, on a fresh insert (`null` — the DB column's
 * default) or an update alike.
 */
function toUserConsumptionValues(item: UserConsumption) {
  return {
    id: item.id,
    user_id: item.userId,
    owner_type: item.ownerType,
    pet_id: item.petId ?? null,
    kind: item.kind,
    nombre: item.nombre,
    dosis_por_toma: item.dosisPorToma.toFixed(2),
    unidad: item.unidad ?? null,
    frecuencia_dias: item.frecuenciaDias,
    horarios: [...item.horarios],
    stock_actual: item.stockActual.toFixed(2),
    auto_crear_refill: item.autoCrearRefill,
  };
}

/**
 * `ConsumptionRepository`'s Kysely-backed implementation (design.md "Wiring
 * de módulos y tokens"). Built incrementally across the chained PR sequence,
 * same as design.md's own §"Secuencia de implementación" table plans it:
 * PR 2b landed `findById` — the read path `CalcularDiasRestantesUseCase`
 * needs for the D7 ownership check. PR 3 landed `save` —
 * `ConfigurarConsumoUseCase`'s only write path. PR 4 landed `descontarStock`
 * — `MarcarDosisTomadaUseCase`'s atomic decrement (D-H.2). This PR (6a)
 * lands the last 3 methods that the future `ProcesarConsumosVencidosUseCase`
 * (PR 6b) needs: `findDueForCheck` (D-C's union/multiplicative candidate
 * predicate) and the debounce CAS pair `intentarMarcarStockBajo`/
 * `limpiarMarcaStockBajo` (D-A) — closing out `ConsumptionRepository`'s
 * full interface. No use case calls these 3 methods yet; that wiring is
 * PR 6b's scope, not this one's.
 */
@Injectable()
export class KyselyConsumptionRepository implements ConsumptionRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * `configurarConsumo`'s only write path (D-H): insert-or-update on `id`
   * (mirrors `KyselyPetRepository.save`/`KyselyCompanyRepository.save`'s
   * single-column conflict target — `UserConsumption` has no bifurcated
   * conflict the way `ProviderCatalogItem` does). `user_id` is excluded from
   * `DO UPDATE SET` (D7: the owner never changes via `save()`), and
   * `stock_bajo_notificado_at` is excluded too (D-A: only the CAS methods
   * write that column — see `toUserConsumptionValues`'s doc comment).
   */
  async save(item: UserConsumption, tx?: TransactionContext): Promise<void> {
    const values = toUserConsumptionValues(item);
    const { id: _id, user_id: _userId, ...update } = values;
    await this.executor(tx)
      .insertInto('user_consumption')
      .values(values)
      .onConflict((oc) => oc.column('id').doUpdateSet(update))
      .execute();
  }

  /**
   * Powers the D7 cross-tenant ownership check on `marcarDosisTomada`/
   * `calcularDiasRestantes`: look up by id, compare `entity.userId` against
   * `actor.profileId` in the use case — `null` and "found but foreign" both
   * resolve to the same `ConsumptionNotFoundError` (byte-identical 404).
   * Never throws on a miss; returning `null` and letting the use case decide
   * is what keeps that byte-identical guarantee possible.
   */
  async findById(consumptionId: string, tx?: TransactionContext): Promise<UserConsumption | null> {
    const row = await this.executor(tx)
      .selectFrom('user_consumption')
      .selectAll()
      .where('id', '=', consumptionId)
      .executeTakeFirst();
    return row ? mapUserConsumptionRow(row) : null;
  }

  /**
   * design.md D-C, exact predicate — a UNION, never a bare "below
   * threshold" filter: branch (A) `stock_actual * frecuencia_dias < (U+1) *
   * dosis_por_toma * n_horarios` is "may need to fire"; branch (B)
   * `stock_bajo_notificado_at IS NOT NULL` is "may need to clear" — it is
   * what makes the D-A debounce marker self-healing instead of permanent
   * (the cron is the only cleaner of that column, so a row that climbed
   * back above threshold while still marked MUST stay in the result set).
   *
   * MULTIPLICATIVE, never division: `horarios` has no non-empty CHECK and
   * `dosis_por_toma` has no positivity CHECK, so a division would abort the
   * ENTIRE query on one degenerate row. The multiplicative form makes a
   * degenerate row's right-hand side `= 0`, and `stock * freq < 0` is
   * always false (both are non-negative) — the row silently self-excludes.
   *
   * Returns CANDIDATES, not confirmed under-threshold items: the `+1`
   * margin is a strict superset guard, not a tight equivalence — it exists
   * because Postgres `numeric` division and JS `float64` division are not
   * guaranteed to agree bit-for-bit at the exact boundary. The caller MUST
   * re-run `domain/consumo.calculos.ts`'s `diasRestantes` over every
   * returned entity and MAY skip false positives; it MUST NOT treat a row
   * in this result set as an already-confirmed alert.
   *
   * Returns `ConsumptionCandidata[]` (PR6b), not `UserConsumption[]`: each
   * row also carries `stock_bajo_notificado_at`'s CURRENT value — unlike
   * `mapUserConsumptionRow` (shared by `findById`), which deliberately does
   * NOT map that column, this is the one read path where the caller needs
   * it, to pick between the cleanup branch (2b) and the no-op branch (2c).
   */
  async findDueForCheck(
    umbralDias: number,
    tx?: TransactionContext,
  ): Promise<ConsumptionCandidata[]> {
    const rows = await this.executor(tx)
      .selectFrom('user_consumption')
      .selectAll()
      .where(
        sql<boolean>`stock_bajo_notificado_at is not null
           or stock_actual * frecuencia_dias
                < (${umbralDias}::numeric + 1) * dosis_por_toma * coalesce(array_length(horarios, 1), 0)`,
      )
      .execute();
    return rows.map((row) => ({
      ...mapUserConsumptionRow(row),
      stockBajoNotificadoAt: row.stock_bajo_notificado_at,
    }));
  }

  /**
   * design.md D-A's compare-and-set, verbatim: `UPDATE ... SET
   * stock_bajo_notificado_at = $2 WHERE id = $1 AND
   * stock_bajo_notificado_at IS NULL RETURNING id`. ONE statement — never a
   * prior read — so the row-lock Postgres already takes on the `UPDATE` is
   * the entire concurrency mechanism (no advisory lock needed, D-E). `true`
   * (1 row) = this caller won the claim and MUST emit. `false` (0 rows) =
   * already claimed — by yesterday's run (D5), another replica, or an
   * overlapping run (D-E) — and the caller MUST NOT emit.
   *
   * `executeTakeFirst`, deliberately never `executeTakeFirstOrThrow`: a
   * 0-row result is an expected, valid outcome here (the losing side of a
   * race), not an error condition.
   */
  async intentarMarcarStockBajo(
    consumptionId: string,
    notificadoAt: Date,
    tx?: TransactionContext,
  ): Promise<boolean> {
    const row = await this.executor(tx)
      .updateTable('user_consumption')
      .set({ stock_bajo_notificado_at: notificadoAt.toISOString() })
      .where('id', '=', consumptionId)
      .where('stock_bajo_notificado_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * design.md D-A: idempotent by construction — a plain `UPDATE ... SET
   * stock_bajo_notificado_at = NULL WHERE id = $1` affects 0 rows when the
   * marker is already clear, and that is success, not an error; no
   * special-casing needed. Called by the cron (stock replenished above
   * threshold). NOT called by `configurarConsumo`: that use case is
   * create-only (`NuevoConsumoInput`, no `consumptionId` param), so there is
   * no "reconfigure an existing item" path in this change for it to clear
   * the marker from (`consumo/SPEC.md`'s declared delta, "el marcador de
   * debounce y `configurarConsumo`"). Never called by `marcarDosisTomada`
   * either, which can only lower stock and can never resolve the alert
   * condition.
   */
  async limpiarMarcaStockBajo(consumptionId: string, tx?: TransactionContext): Promise<void> {
    await this.executor(tx)
      .updateTable('user_consumption')
      .set({ stock_bajo_notificado_at: null })
      .where('id', '=', consumptionId)
      .execute();
  }

  /**
   * `marcarDosisTomada`'s atomic decrement (D-H.2): a single
   * `UPDATE ... SET stock_actual = greatest(stock_actual - $2, 0) ...
   * RETURNING stock_actual` — never a prior `findById` read. The clamp
   * lives in the SQL itself (Postgres's `greatest()`), not in application
   * code: a JS-level `Math.max(0, ...)` computed from a stale in-memory read
   * would NOT be immune to two concurrent doses both reading the same
   * `stockActual` before either writes — this single statement is what
   * makes the decrement immune to that lost update (double-tap, two
   * devices). Returns the new stock so `DosisRegistrada` gets its
   * `stockRestante` without a second read.
   */
  async descontarStock(
    consumptionId: string,
    cantidad: number,
    tx?: TransactionContext,
  ): Promise<number> {
    const row = await this.executor(tx)
      .updateTable('user_consumption')
      .set({ stock_actual: sql<string>`greatest(stock_actual - ${cantidad.toFixed(2)}, 0)` })
      .where('id', '=', consumptionId)
      .returning('stock_actual')
      .executeTakeFirstOrThrow();
    return Number(row.stock_actual);
  }

  /**
   * usuario-mobile-consumo design.md D-3/D-4: `user_id = $1` inside the SQL
   * itself, never a post-`filter()` in JS. Powers both `GET
   * /consumo/mis-consumos` and, indirectly, `GET /consumo/mi-adherencia`
   * (`CalcularAdherenciaSemanalUseCase` calls this FIRST to derive its own
   * actor-scoped id set before ever touching `ConsumptionLogRepository`).
   * Reuses `mapUserConsumptionRow`, same as `findById` above.
   */
  async findByUserId(userId: string, tx?: TransactionContext): Promise<UserConsumption[]> {
    const rows = await this.executor(tx)
      .selectFrom('user_consumption')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(mapUserConsumptionRow);
  }
}
