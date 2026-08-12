import { Inject, Injectable } from '@nestjs/common';
import type { RefillRequestActiva } from '@repon/types';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { completar, type CompletarInput } from '../domain/refill-request.entity';
import { RefillRequestNotFoundError, TransicionInvalidaError } from '../domain/refill.errors';
import { RefillCreado } from '../events/refill-creado.event';
import type { RefillSolicitudPayload } from '../events/refill-solicitud.payload';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';

// `CompletarInput`/`CompletarRefillItemInput` — tasks.md 6b.1's literal text
// says to declare `CompletarRefillItemInput` LOCALLY in this file. That text
// predates PR2: `domain/refill-request.entity.ts`'s `completar()` (task 2.6)
// already exports both `CompletarInput` and `CompletarRefillItemInput`, one
// file away from where design.md's D-E originally placed them, and its own
// doc comment says so explicitly ("declarado ACÁ... y exportado para que
// Phase 6b's CompletarBorradorUseCase lo importe en vez de redeclararlo").
// The two shapes are field-for-field identical to what design.md's D-E code
// block specifies (`refillItemId`, `categoria`, `precioReferencia`,
// `catalogProductId?`) — importing here instead of redeclaring avoids two
// structurally-identical interfaces living under two different names in the
// same domain, and this use case is `completar()`'s only caller (nothing
// else in this domain would need a second declaration). `@repon/types`'s
// export count stays at the 4 from D11 either way — this was never a
// candidate for promotion there (D-B: "no `SPEC.md` names it").
export type { CompletarInput, CompletarRefillItemInput } from '../domain/refill-request.entity';

/**
 * `refill-matching/SPEC.md`'s `completarBorrador` — design.md Diagrama 1's
 * closing note: "exactamente la misma forma [que `crearSolicitud`], con tres
 * diferencias: (a) abre con `findById` DENTRO de la transacción y rechaza si
 * no es del actor (404) o no es 'borrador' (409 `TRANSICION_INVALIDA`); (b)
 * valida completitud con la unión discriminada de D-B antes de escribir
 * (`SolicitudIncompletaError` -> 400); (c) responde 200 en vez de 201."
 *
 * ## Constructor
 *
 * `REFILL_REPOSITORY` + `TRANSACTION_MANAGER` + `EVENT_PUBLISHER` — same 3
 * tokens `CrearSolicitudUseCase` injects (in the same order), unlike
 * `BuscarProveedoresCompatiblesUseCase`'s deliberate absence of
 * `TRANSACTION_MANAGER`: this use case DOES write (`save()`), so it needs one.
 *
 * ## Flow — same shape as `MarcarDosisTomadaUseCase` (`consumo`), not
 * `CrearSolicitudUseCase`
 *
 * Unlike `crearSolicitud` (which builds a brand-new entity before ever
 * opening a transaction — nothing to read first), this use case needs an
 * ownership read before it can write, exactly `marcarDosisTomada`'s shape
 * (tasks.md 6b.2: "same pattern as marcarDosisTomada"): `findById` runs
 * INSIDE `runInTransaction`, on the SAME `tx` the `save()` call also uses —
 * a rejection anywhere in the callback rolls back with zero writes, so there
 * is no separate pre-transaction read.
 *
 * 1. `findById(refillRequestId, tx)`.
 * 2. `null` OR `found.userId !== profileId` -> `RefillRequestNotFoundError`,
 *    constructed the exact same way in both branches (D13, same "byte a byte
 *    idéntico" rule `BuscarProveedoresCompatiblesUseCase` already
 *    established) — checked FIRST, before state.
 * 3. `found.estado !== 'borrador'` -> `TransicionInvalidaError` (409). This
 *    is a check THIS use case makes, not `completar()`: the domain function
 *    takes a `RefillRequestBorrador` as its typed parameter (TypeScript
 *    enforces "is this a borrador?" at the call site), so it has no runtime
 *    branch for "what if it wasn't actually one" — that branch has to live
 *    here, before `completar()` is ever called. Past this check, TypeScript
 *    narrows `found` to `RefillRequestBorrador` (D-B), so the call below
 *    type-checks without a cast.
 * 4. `completar(found, input)` (Phase 2, `domain/refill-request.entity.ts`)
 *    — delegated, never re-implemented here. Its own 2 completeness checks
 *    (`SolicitudIncompletaError`) and its unknown-`refillItemId` check
 *    (`RefillItemDesconocidoError`) both propagate straight out of this
 *    use case uncaught; this file adds no logic of its own for either.
 * 5. `save(activa, tx)` — same `tx` as step 1's read (D-G.2: `save()` is the
 *    update-in-place path here, never a fresh insert — the request already
 *    exists).
 * 6. `RefillCreado` publishes only AFTER `runInTransaction` resolves, never
 *    from inside its callback (core-api-refill-matching spec: "completarBorrador
 *    publishes RefillCreado after commit") — reusing Phase 4a's
 *    `RefillSolicitudPayload`/`RefillCreado` verbatim, same
 *    `refillItemId`/`catalogProductId ?? null` conversion `CrearSolicitudUseCase`
 *    already established (D-C: both producers of `RefillCreado` build the
 *    exact same payload shape).
 */
@Injectable()
export class CompletarBorradorUseCase {
  constructor(
    @Inject(REFILL_REPOSITORY) private readonly refillRepository: RefillRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(
    profileId: string,
    refillRequestId: string,
    input: CompletarInput,
  ): Promise<RefillRequestActiva> {
    const entity = await this.transactionManager.runInTransaction(async (tx) => {
      const found = await this.refillRepository.findById(refillRequestId, tx);
      if (found === null || found.userId !== profileId) {
        throw new RefillRequestNotFoundError(refillRequestId);
      }
      if (found.estado !== 'borrador') {
        throw new TransicionInvalidaError(
          `No se puede completar una solicitud en estado '${found.estado}' (se esperaba 'borrador').`,
        );
      }

      // `found` is `RefillRequestBorrador` past this point (D-B narrowing).
      const activa = completar(found, input);
      await this.refillRepository.save(activa, tx);
      return activa;
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
