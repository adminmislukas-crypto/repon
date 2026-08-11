import { Inject, Injectable, Logger } from '@nestjs/common';
import { consumoDiario, diasRestantes, mensajeStockBajo } from '../domain/consumo.calculos';
import { UMBRAL_STOCK_BAJO_DIAS } from '../domain/consumo.constants';
import type { StockBajoPayload } from '../events/stock-bajo.payload';
import { RefillAutoSolicitado } from '../events/refill-auto-solicitado.event';
import { StockBajoDetectado } from '../events/stock-bajo-detectado.event';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import {
  NOTIFICATION_PORT,
  type NotificationPort,
} from '../../../shared/notifications/notification.port';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionCandidata,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';

/**
 * design.md Diagram 1, "El cron diario de punta a punta" (D1 + D2 + D3 + D4
 * + D-A + D-C + D-E) — the single most scenario-dense use case in this
 * change. Called ONLY by the future `ConsumptionCheckJob`'s thin `@Cron()`
 * adapter (PR6c); `execute()` takes no params, no actor. NEVER exposed via
 * HTTP, NEVER decorated with `@Roles()` — `consumo`'s own controller has no
 * route that reaches this class (core-api-consumo spec, "procesarConsumosVencidos
 * has no HTTP surface").
 *
 * Structural CQS guarantee (D2/D4), inspectable, not just conventional: the
 * constructor injects ONLY `CONSUMPTION_REPOSITORY`, `EVENT_PUBLISHER`, and
 * `NOTIFICATION_PORT` — NEVER `TRANSACTION_MANAGER`. This is deliberate, not
 * an oversight: each `UserConsumption` is processed and reported
 * independently, one at a time, inside its own `try/catch`; a failure on one
 * item is caught, logged, and the loop CONTINUES — it never aborts the
 * remaining items, and there is no enclosing transaction to roll back in
 * the first place (D4). Same shape as `catalogo`'s `CargarCatalogoMasivoUseCase`.
 *
 * D-E's reclaim-before-emit ordering is non-negotiable and structural to
 * this method's control flow, not a comment: `intentarMarcarStockBajo` is
 * awaited and its boolean result branched on BEFORE any
 * `eventPublisher.publish`/`notificationPort.sendPush` call for that item.
 * A crash between the claim and the emit loses an alert — acceptable,
 * contained within `consumo` (the item simply stays marked with no event
 * ever published, until the condition resolves and re-drops, per D5's own
 * debounce contract). The alternative order (emit first, claim second)
 * would risk a DUPLICATE alert crossing into `refill-matching`'s domain (a
 * persisted `RefillRequest` a user actually sees twice) — categorically
 * worse, so it is rejected.
 */
@Injectable()
export class ProcesarConsumosVencidosUseCase {
  private readonly logger = new Logger(ProcesarConsumosVencidosUseCase.name);

  constructor(
    @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(NOTIFICATION_PORT) private readonly notificationPort: NotificationPort,
  ) {}

  async execute(): Promise<void> {
    const startedAt = Date.now();
    // A single `now` for the whole run, reused for every claim — not a
    // fresh `new Date()` per item, which would drift across a large batch
    // without adding any real precision (the marker's exact instant is
    // bookkeeping, not a fact any consumer computes deltas against today).
    const now = new Date();

    // (1) D-B: the domain constant travels as a parameter, never
    // hard-coded into the repository.
    const candidatas = await this.consumptionRepository.findDueForCheck(UMBRAL_STOCK_BAJO_DIAS);

    let emitidos = 0;
    let limpiados = 0;
    let fallidos = 0;

    // (2) NO runInTransaction wrapping this loop (D4) — see the class doc
    // comment. Every branch below lives inside ONE try/catch per item, and
    // a caught error never rethrows: the loop MUST continue.
    for (const candidata of candidatas) {
      try {
        const resultado = await this.procesarCandidata(candidata, now);
        if (resultado === 'emitido') emitidos++;
        if (resultado === 'limpiado') limpiados++;
      } catch (error) {
        fallidos++;
        this.logger.error({
          evento: 'cron.item_fallido',
          consumptionId: candidata.id,
          error,
        });
      }
    }

    // (3) Trip-wire (D-F): duracionMs cerca de 1h señala que el LOTE creció
    // (D-C), nunca un lock a agregar aquí.
    const duracionMs = Date.now() - startedAt;
    this.logger.log({
      evento: 'cron.procesar_consumos_vencidos',
      candidatas: candidatas.length,
      emitidos,
      limpiados,
      fallidos,
      duracionMs,
    });
  }

  /**
   * One candidate, start to finish (design.md Diagram 1, steps 2a-2g).
   * Returns which branch it took, purely for the run-level summary counters
   * — the caller's `try/catch` is what actually enforces D4, this method
   * never swallows an error itself.
   */
  private async procesarCandidata(
    candidata: ConsumptionCandidata,
    now: Date,
  ): Promise<'emitido' | 'limpiado' | 'no-op'> {
    // 2a: the SOLE authority for the formula — `findDueForCheck`'s SQL
    // predicate (D-C) is a strict superset, never the decision.
    const consumoDiarioValor = consumoDiario({
      dosisPorToma: candidata.dosisPorToma,
      horarios: candidata.horarios,
      frecuenciaDias: candidata.frecuenciaDias,
    });
    const diasRestantesValor = diasRestantes(candidata.stockActual, consumoDiarioValor);

    if (diasRestantesValor >= UMBRAL_STOCK_BAJO_DIAS) {
      // 2b: RAMA LIMPIEZA — replenished above threshold, marker still open.
      if (candidata.stockBajoNotificadoAt !== null) {
        await this.consumptionRepository.limpiarMarcaStockBajo(candidata.id);
        return 'limpiado';
      }
      // 2c: marker already null — only reachable via the [U, U+1) band the
      // `+1` margin of D-C's predicate over-fetches. No-op.
      return 'no-op';
    }

    // 2d: RAMA DISPARO. Reclaim BEFORE emit (D-E) — see class doc comment.
    const gano = await this.consumptionRepository.intentarMarcarStockBajo(candidata.id, now);
    if (!gano) {
      // Already claimed — by yesterday's run (D5), another replica, or an
      // overlapping run (D-E). Do NOT emit, do NOT push.
      return 'no-op';
    }

    const payload: StockBajoPayload = {
      consumptionId: candidata.id,
      userId: candidata.userId,
      ownerType: candidata.ownerType,
      petId: candidata.petId ?? null,
      kind: candidata.kind,
      nombre: candidata.nombre,
      unidad: candidata.unidad ?? null,
      stockActual: candidata.stockActual,
      consumoDiario: consumoDiarioValor,
      diasRestantes: diasRestantesValor,
      umbralDias: UMBRAL_STOCK_BAJO_DIAS,
    };

    // 2e: UNO por ítem, nunca un resumen del día (D3).
    await this.eventPublisher.publish(new StockBajoDetectado(payload));

    // 2f: mismo payload, canal distinto — lleva CONSENTIMIENTO (D-D).
    if (candidata.autoCrearRefill) {
      await this.eventPublisher.publish(new RefillAutoSolicitado(payload));
    }

    // 2g: best-effort (D10/D-G). The real NotificationPort binding NEVER
    // throws by its own contract; still inside this item's try/catch as
    // defense in depth. No pet lookup here (N+1 avoidance, D-D) —
    // `mensajeStockBajo` only uses fields the candidate already carries.
    await this.notificationPort.sendPush(
      candidata.userId,
      mensajeStockBajo({
        nombre: candidata.nombre,
        diasRestantes: diasRestantesValor,
        unidad: candidata.unidad ?? null,
      }),
    );

    return 'emitido';
  }
}
