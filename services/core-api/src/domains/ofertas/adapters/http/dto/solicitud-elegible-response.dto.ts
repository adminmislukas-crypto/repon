import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Urgencia } from '@repon/types';

const URGENCIAS: readonly Urgencia[] = ['lo_antes_posible', 'hoy', 'manana', 'en_2_3_dias'];

/** One entry of `SolicitudElegibleDto.items` — mirrors
 *  `SolicitudElegibleItem` (`@repon/types`) field-for-field. */
export class SolicitudElegibleItemDto {
  @ApiProperty({ format: 'uuid' })
  refillItemId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  categoria!: string;

  @ApiProperty()
  precioReferencia!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  catalogProductId?: string;
}

/**
 * Response shape for `GET /ofertas/oportunidades` (200 array) — mirrors
 * `SolicitudElegible` (`@repon/types`) field-for-field, task 4b.3. Same
 * discipline `RefillRequestResponseDto` established: a dedicated named DTO,
 * never the raw domain/`@repon/types` shape returned straight off the
 * controller.
 *
 * Deliberately **no `userId` field** — design.md Diagrama 3: the provider
 * does not need the recipient's `profileId` to compose an offer, and
 * exposing it here would turn this route into a profile enumerator.
 * `SolicitudElegible` itself has no such property (PR1), so there is
 * nothing to accidentally leak even if a future edit tried.
 */
export class SolicitudElegibleDto {
  @ApiProperty({ format: 'uuid' })
  refillRequestId!: string;

  @ApiProperty()
  comuna!: string;

  @ApiProperty({ enum: URGENCIAS })
  urgencia!: Urgencia;

  @ApiProperty()
  matchedAt!: string;

  @ApiProperty({ type: [SolicitudElegibleItemDto] })
  items!: SolicitudElegibleItemDto[];
}
