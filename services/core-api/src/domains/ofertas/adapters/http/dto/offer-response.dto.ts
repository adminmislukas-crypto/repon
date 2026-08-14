import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OfferKind, OfferStatus } from '@repon/types';

const OFFER_KINDS: readonly OfferKind[] = ['reactiva', 'proactiva'];
const OFFER_STATUSES: readonly OfferStatus[] = ['pendiente', 'aceptada', 'rechazada', 'expirada'];

/**
 * One entry of `OfferResponseDto.items` — mirrors `OfferItem`
 * (`OfferItemReactiva | OfferItemProactiva`, `@repon/types`) field-for-field.
 * Both discriminant fields (`refillItemId`/`providerCatalogItemId`) are
 * declared optional here (response-shape mirror of the same union
 * `NuevoOfferItemDto` already flattens on the request side): a reactiva
 * item's response always carries `refillItemId` and omits
 * `providerCatalogItemId` (and vice-versa for proactiva) — enforced by
 * `toOfferResponseDto`'s mapping, not by this DTO's own shape (response
 * DTOs in this repo carry no `class-validator` decorators, same convention
 * `SolicitudElegibleItemDto`/`ProviderCatalogItemResponseDto` already use).
 */
export class OfferItemResponseDto {
  @ApiPropertyOptional({ format: 'uuid' })
  refillItemId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  providerCatalogItemId?: string;

  @ApiProperty()
  precio!: number;

  @ApiProperty()
  isAlt!: boolean;

  @ApiPropertyOptional()
  altNote?: string;

  @ApiPropertyOptional()
  altSize?: number;

  @ApiPropertyOptional()
  altQty?: number;
}

/**
 * Response shape for `POST /ofertas` (201, task 5b.1) — mirrors `Offer`
 * (`@repon/types`) field-for-field, items inline. Deliberately generic
 * enough to be REUSED, unmodified, by PR6b (`POST /ofertas/proactivas`,
 * `enviarOfertaProactiva`) and PR7b (`GET /ofertas/bandeja`,
 * `obtenerBandeja`) — only this PR's own reactiva path is exercised today
 * (`refillRequestId` always populated, every item carries `refillItemId`);
 * `refillRequestId` is optional here (mirroring `Offer`'s own `kind`-
 * discriminated union, where the proactiva branch has no such field) so a
 * future proactiva response simply omits it, no shape change needed.
 *
 * Same discipline `SolicitudElegibleDto` established: a dedicated named DTO,
 * never the raw domain/`@repon/types` `Offer` shape returned straight off
 * the controller.
 */
export class OfferResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  companyId!: string;

  @ApiProperty({ enum: OFFER_STATUSES })
  status!: OfferStatus;

  @ApiProperty({ enum: OFFER_KINDS })
  kind!: OfferKind;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Presente únicamente cuando kind === "reactiva".',
  })
  refillRequestId?: string;

  @ApiProperty()
  tiempoEntregaHoras!: number;

  @ApiProperty()
  costoDespacho!: number;

  @ApiProperty()
  total!: number;

  @ApiPropertyOptional()
  mensaje?: string;

  @ApiProperty({ type: [OfferItemResponseDto] })
  items!: OfferItemResponseDto[];
}
