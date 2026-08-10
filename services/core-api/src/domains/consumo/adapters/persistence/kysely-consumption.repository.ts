import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { UserConsumption } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, UserConsumptionTable } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { ConsumptionRepository } from '../../ports-out/consumption-repository.port';

/**
 * `dosis_por_toma`/`stock_actual` round-trip through node-postgres as
 * `string` (design.md's "detalle mecánico de mayor riesgo del cambio" —
 * the same `numeric` gotcha `catalogo`'s D-C already documented for
 * `precio_base`/`precio_maximo`). This mapper is the ONE place that
 * conversion happens; `domain/consumo.calculos.ts` and every use case only
 * ever see `number`. `stock_bajo_notificado_at` is NOT mapped here yet — it
 * has no read path until PR6a's `findDueForCheck`/CAS methods land.
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
 * `ConfigurarConsumoUseCase`'s only write path. This PR (4) lands
 * `descontarStock` — `MarcarDosisTomadaUseCase`'s atomic decrement (D-H.2).
 * The remaining 3 methods (`findDueForCheck`, `intentarMarcarStockBajo`,
 * `limpiarMarcaStockBajo`) still throw a named, loud error until PR 6a
 * implements them — a silent no-op stub would be worse than a missing
 * provider (same principle `catalogo`'s `KyselyCatalogRepository`
 * established for its own `save`/`saveMany` in its equivalent PR).
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

  async findDueForCheck(umbralDias: number, tx?: TransactionContext): Promise<UserConsumption[]> {
    throw new Error(
      `KyselyConsumptionRepository.findDueForCheck(umbralDias=${umbralDias}, tx=${tx ? 'given' : 'none'}) ` +
        'is implemented in PR 6a (backend-core-api-consumo, design.md D-C predicate) — not yet available.',
    );
  }

  async intentarMarcarStockBajo(
    consumptionId: string,
    notificadoAt: Date,
    tx?: TransactionContext,
  ): Promise<boolean> {
    throw new Error(
      `KyselyConsumptionRepository.intentarMarcarStockBajo(id=${consumptionId}, ` +
        `notificadoAt=${notificadoAt.toISOString()}, tx=${tx ? 'given' : 'none'}) is implemented ` +
        'in PR 6a (backend-core-api-consumo, design.md D-A CAS) — not yet available.',
    );
  }

  async limpiarMarcaStockBajo(consumptionId: string, tx?: TransactionContext): Promise<void> {
    throw new Error(
      `KyselyConsumptionRepository.limpiarMarcaStockBajo(id=${consumptionId}, tx=${tx ? 'given' : 'none'}) ` +
        'is implemented in PR 6a (backend-core-api-consumo, design.md D-A) — not yet available.',
    );
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
}
