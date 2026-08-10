import { Inject, Injectable } from '@nestjs/common';
import { consumoDiario, diasRestantes } from '../domain/consumo.calculos';
import { ConsumptionNotFoundError } from '../domain/consumo.errors';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';

/**
 * core-api-consumo spec, "calcularDiasRestantes is scoped to the caller's
 * own consumption; cross-tenant access is a 404, never 403" — the R1
 * mitigation (design.md Diagram 3). `userId` is explicit, actor-derived
 * (D8), never re-derived here.
 *
 * `findById(consumptionId)` returning `null` and `findById(consumptionId)`
 * returning an item whose `userId` does not match the caller throw the
 * EXACT SAME `ConsumptionNotFoundError`, constructed the exact same way (no
 * branch-specific message, no branch-specific shape) — a 403 in the
 * cross-tenant branch would confirm the consumption exists and belongs to
 * someone else, letting an actor enumerate `consumptionId` to probe another
 * user's health data by observing a 403-vs-404 split. 404 in both branches
 * closes that channel.
 *
 * Structural CQS guarantee (D2/R4, core-api-consumo spec "calcularDiasRestantes
 * remains a pure query, structurally decoupled from events and
 * notifications"): the constructor injects ONLY `CONSUMPTION_REPOSITORY` —
 * no `EVENT_PUBLISHER`, no `NOTIFICATION_PORT`, no `TRANSACTION_MANAGER`.
 * That absence is the structural guarantee that a GET of "days remaining"
 * can never trigger a push or an auto-refill — verifiable by reading this
 * constructor, not by trusting a convention.
 */
@Injectable()
export class CalcularDiasRestantesUseCase {
  constructor(
    @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
  ) {}

  async execute(userId: string, consumptionId: string): Promise<number> {
    const consumption = await this.consumptionRepository.findById(consumptionId);
    if (!consumption || consumption.userId !== userId) {
      throw new ConsumptionNotFoundError(consumptionId);
    }

    const consumoDiarioValor = consumoDiario({
      dosisPorToma: consumption.dosisPorToma,
      horarios: consumption.horarios,
      frecuenciaDias: consumption.frecuenciaDias,
    });
    return diasRestantes(consumption.stockActual, consumoDiarioValor);
  }
}
