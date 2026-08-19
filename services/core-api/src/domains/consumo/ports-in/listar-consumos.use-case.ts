import { Inject, Injectable } from '@nestjs/common';
import type { UserConsumptionListItem } from '@repon/types';
import { consumoDiario, diasRestantes } from '../domain/consumo.calculos';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';

/**
 * usuario-mobile-consumo design.md D-1/D-5/D7, `GET /consumo/mis-consumos`.
 * `userId` is explicit, actor-derived (D8/D-4) — the ONLY scoping
 * mechanism. Attaches `diasRestantes` to every row IN PROCESS, reusing the
 * same pure `consumoDiario`/`diasRestantes` functions
 * `CalcularDiasRestantesUseCase` already uses — the formula is never
 * re-derived, and this is exactly ONE repository call regardless of how
 * many rows come back (D7: the same N+1 rejected for the point-read stays
 * rejected here). A degenerate row (e.g. `horarios: []` predating that
 * constraint) can make this raw calculation `Infinity`/`NaN` — sanitized at
 * the DTO boundary (`consumo.mapper.ts`'s `Number.isFinite` guard), never
 * silently `JSON.stringify`'d as `null` here.
 */
@Injectable()
export class ListarConsumosUseCase {
  constructor(
    @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
  ) {}

  async execute(userId: string): Promise<UserConsumptionListItem[]> {
    const consumptions = await this.consumptionRepository.findByUserId(userId);
    return consumptions.map((consumption) => {
      const consumoDiarioValor = consumoDiario({
        dosisPorToma: consumption.dosisPorToma,
        horarios: consumption.horarios,
        frecuenciaDias: consumption.frecuenciaDias,
      });
      return {
        ...consumption,
        diasRestantes: diasRestantes(consumption.stockActual, consumoDiarioValor),
      };
    });
  }
}
