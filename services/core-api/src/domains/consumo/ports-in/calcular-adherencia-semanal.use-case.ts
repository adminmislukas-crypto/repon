import { Inject, Injectable } from '@nestjs/common';
import type { AdherenciaDia, AdherenciaItem, AdherenciaSemanal } from '@repon/types';
import {
  dosisEsperadasPorDia,
  estadoAdherenciaDia,
  rachaDias,
  ventanaAdherencia,
} from '../domain/consumo.calculos';
import { ZONA_HORARIA_ADHERENCIA } from '../domain/consumo.constants';
import {
  CONSUMPTION_LOG_REPOSITORY,
  type ConsumptionLogRepository,
} from '../ports-out/consumption-log-repository.port';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';

function clampPorcentaje(valor: number): number {
  return Math.max(0, Math.min(100, Math.round(valor)));
}

/**
 * usuario-mobile-consumo design.md D-1/D-2/D-4/D-5, `GET /consumo/mi-adherencia`.
 * `userId` is explicit, actor-derived (D8/D-4). Never accepts a
 * `consumptionId` from the client at all (D-4) — the id set this use case
 * queries logs for comes ONLY from `ConsumptionRepository.findByUserId`, so
 * a foreign id is structurally unreachable, not merely rejected. `ahora` is
 * an injectable parameter (default `new Date()`) purely so the 7-day window
 * is testable without fake timers on the system clock.
 *
 * Aggregation happens entirely here, in the domain-facing use case, never
 * in `consumo.mapper.ts` (that stays a thin scalar<->DTO conversion, same
 * convention as every other mapper function in this domain) and never on
 * the client (D6: adherence math never crosses the wire as raw logs).
 */
@Injectable()
export class CalcularAdherenciaSemanalUseCase {
  constructor(
    @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
    @Inject(CONSUMPTION_LOG_REPOSITORY)
    private readonly consumptionLogRepository: ConsumptionLogRepository,
  ) {}

  async execute(userId: string, ahora: Date = new Date()): Promise<AdherenciaSemanal> {
    const { fechas, desdeUtc, hastaUtc } = ventanaAdherencia(ahora, ZONA_HORARIA_ADHERENCIA);

    const consumptions = await this.consumptionRepository.findByUserId(userId);
    const ids = consumptions.map((consumption) => consumption.id);
    const conteos = await this.consumptionLogRepository.contarTomasPorDia(
      ids,
      desdeUtc,
      hastaUtc,
      ZONA_HORARIA_ADHERENCIA,
    );

    const tomadasPorItemYFecha = new Map<string, Map<string, number>>();
    for (const conteo of conteos) {
      const porFecha = tomadasPorItemYFecha.get(conteo.consumptionId) ?? new Map<string, number>();
      porFecha.set(conteo.fecha, conteo.tomadas);
      tomadasPorItemYFecha.set(conteo.consumptionId, porFecha);
    }

    const items: AdherenciaItem[] = consumptions.map((consumption) => {
      const esperadasPorDia = dosisEsperadasPorDia({
        horarios: consumption.horarios,
        frecuenciaDias: consumption.frecuenciaDias,
      });
      const porFecha = tomadasPorItemYFecha.get(consumption.id);
      const dias: AdherenciaDia[] = fechas.map((fecha) => {
        const tomadas = porFecha?.get(fecha) ?? 0;
        return {
          fecha,
          esperadas: esperadasPorDia,
          tomadas,
          estado: estadoAdherenciaDia(esperadasPorDia, tomadas),
        };
      });
      const esperadasTotal = esperadasPorDia * fechas.length;
      const tomadasTotal = dias.reduce((suma, dia) => suma + dia.tomadas, 0);
      return {
        consumptionId: consumption.id,
        nombre: consumption.nombre,
        ownerType: consumption.ownerType,
        petId: consumption.petId,
        kind: consumption.kind,
        esperadas: esperadasTotal,
        tomadas: tomadasTotal,
        porcentaje:
          esperadasTotal > 0 ? clampPorcentaje((tomadasTotal / esperadasTotal) * 100) : 0,
        dias,
      };
    });

    const diasAgregados: AdherenciaDia[] = fechas.map((fecha, indice) => {
      const esperadas = items.reduce((suma, item) => suma + item.dias[indice]!.esperadas, 0);
      const tomadas = items.reduce((suma, item) => suma + item.dias[indice]!.tomadas, 0);
      return { fecha, esperadas, tomadas, estado: estadoAdherenciaDia(esperadas, tomadas) };
    });

    const esperadasAgregado = items.reduce((suma, item) => suma + item.esperadas, 0);
    const tomadasAgregado = items.reduce((suma, item) => suma + item.tomadas, 0);

    return {
      desde: fechas[0]!,
      hasta: fechas[fechas.length - 1]!,
      porcentaje:
        esperadasAgregado > 0 ? clampPorcentaje((tomadasAgregado / esperadasAgregado) * 100) : 0,
      rachaDias: rachaDias(diasAgregados.map((dia) => dia.estado)),
      dias: diasAgregados,
      items,
    };
  }
}
