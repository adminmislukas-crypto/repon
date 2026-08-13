import { Inject, Injectable } from '@nestjs/common';
import type { Urgencia } from '@repon/types';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../ports-out/offer-opportunity-repository.port';

/**
 * design.md D-G.1/Diagrama 1 (D2 + D5 + R5) — `MatchEncontradoListener`'s
 * (Phase 4a's own listener, `adapters/events/match-encontrado.listener.ts`)
 * ONLY entry point. Internal use case: **no HTTP route reaches this,
 * ever** (design.md D-E's route table names it explicitly as "Sin ruta.
 * Nunca — interno, solo el listener").
 *
 * `RegistrarOportunidadInput` is declared LOCALLY here, field-for-field
 * matching `adapters/events/refill-matching-event.payloads.ts`'s
 * `MatchEncontradoPayload` (tasks.md 4a.1/4a.2) — but this is `ports-in/`'s
 * OWN vocabulary, not a re-export of the adapter's payload type. `ports-in/`
 * never imports from `adapters/` (same layering discipline as every other
 * boundary in this repo, e.g. `CrearBorradorRefillInput` in
 * `refill-matching/ports-in/crear-borrador-refill.use-case.ts` mirroring
 * `consumo-event.payloads.ts` without importing it). The listener maps
 * `event.payload` (an `adapters/events/` type) into this shape at the call
 * site.
 */
export interface RegistrarOportunidadItemInput {
  readonly refillItemId: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly precioReferencia: number;
  readonly catalogProductId: string | null;
}

export interface RegistrarOportunidadInput {
  readonly refillRequestId: string;
  readonly userId: string;
  readonly comuna: string;
  readonly urgencia: Urgencia;
  readonly companyIds: readonly string[];
  readonly items: readonly RegistrarOportunidadItemInput[];
}

/**
 * design.md Diagrama 1, step 3a: `runInTransaction` (D5/D13) wraps EXACTLY
 * ONE `reemplazar(snapshot, tx)` call — the writer's 5-statement
 * retire-blanket-then-upsert mechanic (D-A.2) lives entirely inside
 * `KyselyOfferOpportunityRepository.reemplazar` (PR3b); this use case never
 * reimplements any part of it, it only translates the listener's input into
 * a snapshot 1:1 and hands it to the repository.
 *
 * `companyIds: []` is NEVER suppressed (`core-api-ofertas` spec "A
 * MatchEncontrado with companyIds: [] still writes the header", D2/D5):
 * "buscamos y no hay nadie" is a fact `refill-matching` owns, and the header
 * write must happen regardless — the repository itself is what omits the
 * companies-upsert step (step 3 of the 5) when the array is empty, not this
 * use case short-circuiting the call.
 *
 * Constructor injects `TRANSACTION_MANAGER` — one of the 4 use cases in this
 * domain that does (design.md D13), alongside `enviarOferta`,
 * `enviarOfertaProactiva`, and `aceptarOferta`. Deliberately does NOT inject
 * `EVENT_PUBLISHER`: `registrarOportunidad` publishes nothing on either
 * branch (design.md Diagrama 1, step 3b — "CERO EVENTOS, CERO push. Esta
 * proyeccion es estado interno; el proveedor se entera cuando consulta su
 * lista"). There is no token to call `publish` through, so "publishes
 * nothing" is a structural guarantee here, not a convention to remember —
 * same shape as `CrearBorradorRefillUseCase`.
 */
@Injectable()
export class RegistrarOportunidadUseCase {
  constructor(
    @Inject(OFFER_OPPORTUNITY_REPOSITORY)
    private readonly opportunityRepository: OfferOpportunityRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(input: RegistrarOportunidadInput): Promise<void> {
    await this.transactionManager.runInTransaction(async (tx) => {
      await this.opportunityRepository.reemplazar(
        {
          refillRequestId: input.refillRequestId,
          userId: input.userId,
          comuna: input.comuna,
          urgencia: input.urgencia,
          companyIds: input.companyIds,
          items: input.items,
        },
        tx,
      );
    });
  }
}
