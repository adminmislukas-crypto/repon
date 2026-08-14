import type { NuevoOfferItemReactiva, Offer, SolicitudElegible } from '@repon/types';
import type { NuevoOfferItemDto } from './dto/nuevo-offer-item.dto';
import type { OfferResponseDto } from './dto/offer-response.dto';
import type { SolicitudElegibleDto } from './dto/solicitud-elegible-response.dto';

/**
 * `core-api-hexagonal-layout` spec, "DTOs and framework decorators stay in
 * adapters/http": the thin entity/read-model <-> response-DTO conversion,
 * kept free of business logic — mirrors `refill.mapper.ts`'s
 * `toRefillRequestResponseDto`/`catalogo.mapper.ts`'s equivalents.
 *
 * More `toXResponseDto` functions land here as later phases (5b's
 * `OfferResponseDto`, 6b/7b reuse it) add routes — this file is appended
 * to, not one-mapper-per-file, same convention every sibling domain's own
 * `*.mapper.ts` already established.
 */

/**
 * PR4b (task 4b.3): the `200 SolicitudElegibleDto[]` response for
 * `listarSolicitudesElegibles`. Thin field-for-field conversion —
 * `SolicitudElegible` (`@repon/types`) already has no `userId` field, so
 * there is nothing to strip here, only to shape.
 */
export function toSolicitudElegibleResponseDto(solicitud: SolicitudElegible): SolicitudElegibleDto {
  return {
    refillRequestId: solicitud.refillRequestId,
    comuna: solicitud.comuna,
    urgencia: solicitud.urgencia,
    matchedAt: solicitud.matchedAt,
    items: solicitud.items.map((item) => ({
      refillItemId: item.refillItemId,
      nombre: item.nombre,
      categoria: item.categoria,
      precioReferencia: item.precioReferencia,
      catalogProductId: item.catalogProductId,
    })),
  };
}

/**
 * PR5b (task 5b.2): the `201 OfferResponseDto` response for `enviarOferta`
 * (reused unmodified by 6b's `enviarOfertaProactiva`/7b's `obtenerBandeja`,
 * per `dto/offer-response.dto.ts`'s own doc comment). `Offer.refillRequestId`/
 * `OfferItem.refillItemId`/`.providerCatalogItemId` are each declared on
 * BOTH branches of their respective discriminated unions (`?: never` on the
 * branch that excludes them) — TypeScript allows reading them straight off
 * the union without an `'x' in y` narrowing check, resolving to `undefined`
 * on the branch that doesn't carry the field. Thin field-for-field
 * conversion, no business logic.
 */
export function toOfferResponseDto(offer: Offer): OfferResponseDto {
  return {
    id: offer.id,
    userId: offer.userId,
    companyId: offer.companyId,
    status: offer.status,
    kind: offer.kind,
    refillRequestId: offer.refillRequestId,
    tiempoEntregaHoras: offer.tiempoEntregaHoras,
    costoDespacho: offer.costoDespacho,
    total: offer.total,
    mensaje: offer.mensaje,
    items: offer.items.map((item) => ({
      refillItemId: item.refillItemId,
      providerCatalogItemId: item.providerCatalogItemId,
      precio: item.precio,
      isAlt: item.isAlt,
      altNote: item.altNote,
      altSize: item.altSize,
      altQty: item.altQty,
    })),
  };
}

/**
 * PR5b: `EnviarOfertaDto.items` (`NuevoOfferItemDto[]`, both discriminant
 * fields optional, `dto/nuevo-offer-item.dto.ts`'s own doc comment) ->
 * `EnviarOfertaUseCase.execute`'s `readonly NuevoOfferItemReactiva[]`
 * parameter — the reactiva-only narrowing this route needs. NOT a
 * `toNuevoOfferItemReactiva(dto)` per-item mapper alone: a genuinely absent
 * `refillItemId` cannot be safely cast to `string` (an unsafe `as string`
 * this repo's own review history has flagged as a bug pattern elsewhere,
 * e.g. PR2's fix). Falling back to `''` instead is deliberately never a
 * valid `oportunidad.items` id, so `EnviarOfertaUseCase`'s own step-6
 * membership check rejects it with `OfertaInvalidaError` (400) exactly as
 * it would any other foreign/absent id — no separate presence check needed
 * here, and no silent 500 either.
 */
export function toNuevoOfertaItemsReactiva(
  items: readonly NuevoOfferItemDto[],
): readonly NuevoOfferItemReactiva[] {
  return items.map(
    (item) =>
      ({
        refillItemId: item.refillItemId ?? '',
        precio: item.precio,
        isAlt: item.isAlt,
        altNote: item.altNote,
        altSize: item.altSize,
        altQty: item.altQty,
        // `isAlt` here is a plain `boolean` (`NuevoOfferItemDto`, already
        // `class-validator`-checked but not compile-time-discriminated) —
        // the same `as NuevoOfferItemReactiva` bypass
        // `offer.entity.spec.ts`'s own `itemReactiva()` test helper uses to
        // construct this exact discriminated union from untrusted/loosely-
        // typed data. `assertItemValido` (Phase 2) re-validates `isAlt ⇒
        // altNote` regardless — this cast never substitutes for that check.
      }) as NuevoOfferItemReactiva,
  );
}
