import type { SolicitudElegible } from '@repon/types';
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
