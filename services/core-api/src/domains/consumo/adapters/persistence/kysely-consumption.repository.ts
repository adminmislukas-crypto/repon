import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
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
 * `ConsumptionRepository`'s Kysely-backed implementation (design.md "Wiring
 * de módulos y tokens"). Built incrementally across the chained PR sequence,
 * same as design.md's own §"Secuencia de implementación" table plans it:
 * this PR (2b) lands `findById` — the read path `CalcularDiasRestantesUseCase`
 * needs for the D7 ownership check. The other 5 methods are declared here
 * (the interface requires all 6) but throw a named, loud error until their
 * own PR implements them — a silent no-op stub would be worse than a
 * missing provider (same principle `catalogo`'s `KyselyCatalogRepository`
 * established for its own `save`/`saveMany` in its equivalent PR).
 */
@Injectable()
export class KyselyConsumptionRepository implements ConsumptionRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  async save(item: UserConsumption, tx?: TransactionContext): Promise<void> {
    throw new Error(
      `KyselyConsumptionRepository.save(id=${item.id}, tx=${tx ? 'given' : 'none'}) is ` +
        'implemented in PR 3 (backend-core-api-consumo, configurarConsumo) — not yet available.',
    );
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

  async descontarStock(
    consumptionId: string,
    cantidad: number,
    tx?: TransactionContext,
  ): Promise<number> {
    throw new Error(
      `KyselyConsumptionRepository.descontarStock(id=${consumptionId}, cantidad=${cantidad}, ` +
        `tx=${tx ? 'given' : 'none'}) is implemented in PR 4 (backend-core-api-consumo, design.md ` +
        'D-H.2) — not yet available.',
    );
  }
}
