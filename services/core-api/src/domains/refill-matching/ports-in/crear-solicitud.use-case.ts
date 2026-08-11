import { Inject, Injectable } from '@nestjs/common';
import type { NuevoRefillItem, RefillRequestActiva, Urgencia } from '@repon/types';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { crearSolicitudActiva } from '../domain/refill-request.entity';
import { RefillCreado } from '../events/refill-creado.event';
import type { RefillSolicitudPayload } from '../events/refill-solicitud.payload';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';

/**
 * `refill-matching/SPEC.md`'s `crearSolicitud(userId, items, direccion,
 * comuna, urgencia)` — the manual (HTTP) path (core-api-refill-matching
 * spec: "crearSolicitud's manual path requires comuna as an explicit
 * parameter", D12). `profileId` is the ONLY source `userId` can ever come
 * from — this signature has no field a client could use to supply a
 * different `userId` (D13; Phase 4b's `CrearSolicitudDto` reinforces this one
 * layer up by never declaring a `userId` field at all, so there is nothing
 * to even trust-or-not-trust from the DTO side).
 *
 * design.md Diagrama 1: the entity is built via `crearSolicitudActiva`
 * (Phase 2) BEFORE `runInTransaction` opens — id generation (`randomUUID()`
 * for the request and every item) and the full `SolicitudInvalidaError`
 * validation surface (empty `items`/`direccion`/`comuna`, per-item empty
 * `nombre`/`categoria`, negative `precioReferencia`) both live there, not
 * here — this use case never duplicates that check, it just lets the throw
 * propagate before any repository/transaction-manager call happens
 * (core-api-refill-matching spec: "A manual crearSolicitud call without
 * comuna is rejected... before any insert").
 *
 * `runInTransaction` (D14) wraps exactly ONE `save()` call — unlike
 * `MarcarDosisTomadaUseCase`'s read+2-writes, there is no ownership read to
 * perform first (the entity does not exist yet). A rejecting `save()`
 * propagates out of `runInTransaction` untouched: `RefillCreado` is
 * constructed and published only AFTER the transaction resolves, never
 * before/inside its callback, so a rolled-back write can never produce an
 * event (core-api-refill-matching spec: "Request and items commit together"
 * / "An item failure leaves no partial request").
 */
@Injectable()
export class CrearSolicitudUseCase {
  constructor(
    @Inject(REFILL_REPOSITORY) private readonly refillRepository: RefillRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    profileId: string,
    items: readonly NuevoRefillItem[],
    direccion: string,
    comuna: string,
    urgencia: Urgencia,
  ): Promise<RefillRequestActiva> {
    const entity = crearSolicitudActiva(profileId, items, direccion, comuna, urgencia);

    await this.transactionManager.runInTransaction(async (tx) => {
      await this.refillRepository.save(entity, tx);
    });

    const payload: RefillSolicitudPayload = {
      refillRequestId: entity.id,
      userId: entity.userId,
      comuna: entity.comuna,
      urgencia: entity.urgencia,
      items: entity.items.map((item) => ({
        refillItemId: item.id,
        nombre: item.nombre,
        categoria: item.categoria,
        precioReferencia: item.precioReferencia,
        catalogProductId: item.catalogProductId ?? null,
      })),
    };
    await this.eventPublisher.publish(new RefillCreado(payload));

    return entity;
  }
}
