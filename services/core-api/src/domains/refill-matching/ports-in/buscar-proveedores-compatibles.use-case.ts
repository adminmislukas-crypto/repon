import { Inject, Injectable } from '@nestjs/common';
import type { ProviderCatalogItem } from '@repon/types';
import {
  CATALOG_QUERY_PORT,
  type CatalogQueryPort,
} from '../../catalogo/contracts/catalog-query.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { RefillRequestNotFoundError, SolicitudEnBorradorError } from '../domain/refill.errors';
import { MatchEncontrado } from '../events/match-encontrado.event';
import type { MatchEncontradoPayload } from '../events/match-encontrado.payload';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';

/**
 * `refill-matching/SPEC.md`'s `buscarProveedoresCompatibles(refillRequestId)`
 * — design.md Diagrama 2, the **first real consumer** of `catalogo`'s frozen
 * `CatalogQueryPort` (C1–C8). This is design.md's own "PR que más merece
 * review dedicada": it closes R2 (404 cross-tenant, never 403) and R3 (no
 * `TRANSACTION_MANAGER` ever injected here).
 *
 * ## Constructor: exactly 3 tokens, NEVER `TRANSACTION_MANAGER`
 *
 * `REFILL_REPOSITORY` + `CATALOG_QUERY_PORT` + `EVENT_PUBLISHER`. This is not
 * a convention to remember — it's a structural property, inspectable by
 * reading the constructor's DI metadata (tasks.md 5a.6, mirrored on
 * `consumo`'s `ProcesarConsumosVencidosUseCase`). There is nothing to wrap in
 * a transaction: this use case performs **zero writes**. `findById` runs
 * without a `tx` (there is none), and `CatalogQueryPort.buscarCoincidencias`
 * (C1) has no `tx?` parameter AT ALL — even a caller determined to open a
 * transaction here would have no parameter to pass it through. Calling
 * `buscarCoincidencias` from inside an open transaction is the exact
 * self-deadlock-by-pool-exhaustion risk C2 warns against; never injecting
 * `TRANSACTION_MANAGER` at all removes the invitation at the root, not just
 * the call site.
 *
 * ## Flow (design.md Diagrama 2)
 *
 * 1. `findById(refillRequestId)` — no `tx`.
 * 2. `null` OR `entity.userId !== profileId` -> `RefillRequestNotFoundError`,
 *    constructed the exact same way in both branches (D13/R2: "byte a byte
 *    identico al caso 'no existe'"; core-api-refill-matching spec: "Cross-tenant
 *    read returns 404, not 403"). Checked FIRST, before state — a borrador
 *    belonging to another user returns 404, never `SolicitudEnBorradorError`
 *    (D-F ordering rule).
 * 3. `entity.estado === 'borrador'` -> `SolicitudEnBorradorError` (409),
 *    reachable ONLY over a request the caller genuinely owns. Never `[]` —
 *    an empty array would be indistinguishable from "no hay proveedores".
 *    Past this point TypeScript narrows `entity` to `RefillRequestActiva`
 *    (design.md D-B): `entity.items` is `RefillItem[]`, `entity.comuna` is
 *    `string`. A borrador's `RefillItemBorrador[]` items are structurally
 *    impossible to reach `buscarCoincidencias(itemsSolicitados: RefillItem[])`
 *    from here — this runtime 409 is the HTTP-observable half of that
 *    compile-time guarantee, not the only defense.
 * 4. `buscarCoincidencias(entity.items)` — OUTSIDE any transaction, by
 *    construction (there is none to be inside of). A thrown
 *    `CatalogQueryUnavailableError` (C8) is NOT caught here: it propagates
 *    uncaught out of `execute()`. Mapping it to HTTP 503 is Phase 5b's job
 *    (the exception filter); this use case's only contribution is never
 *    degrading it to `[]`.
 * 5. Dedup the matched items' `companyId`s in first-appearance order (never
 *    sorted) — `Array.from(new Set(...))` preserves insertion order for
 *    strings, so this is the whole dedup, no extra bookkeeping needed.
 * 6. Build `MatchEncontradoPayload` and `publish(new MatchEncontrado(...))`
 *    — even when the matched set (and therefore `companyIds`) is empty
 *    (design.md: "MatchEncontrado se publica también con cero coincidencias").
 */
@Injectable()
export class BuscarProveedoresCompatiblesUseCase {
  constructor(
    @Inject(REFILL_REPOSITORY) private readonly refillRepository: RefillRepository,
    @Inject(CATALOG_QUERY_PORT) private readonly catalogQueryPort: CatalogQueryPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(profileId: string, refillRequestId: string): Promise<ProviderCatalogItem[]> {
    const entity = await this.refillRepository.findById(refillRequestId);

    if (entity === null || entity.userId !== profileId) {
      throw new RefillRequestNotFoundError(refillRequestId);
    }

    if (entity.estado === 'borrador') {
      throw new SolicitudEnBorradorError(refillRequestId);
    }

    // `entity` is `RefillRequestActiva` past this point (D-B narrowing):
    // `entity.items` is `RefillItem[]`, exactly what `buscarCoincidencias`
    // accepts — a borrador's items could not have compiled here.
    const matches = await this.catalogQueryPort.buscarCoincidencias(entity.items);

    const companyIds = Array.from(new Set(matches.map((item) => item.companyId)));
    const providerCatalogItemIds = matches.map((item) => item.id);

    const payload: MatchEncontradoPayload = {
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
      companyIds,
      providerCatalogItemIds,
    };
    await this.eventPublisher.publish(new MatchEncontrado(payload));

    return matches;
  }
}
