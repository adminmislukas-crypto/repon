import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RefillEstadoActivo, Urgencia } from '@repon/types';

const URGENCIAS: readonly Urgencia[] = ['lo_antes_posible', 'hoy', 'manana', 'en_2_3_dias'];
const ESTADOS_ACTIVOS: readonly RefillEstadoActivo[] = ['abierta', 'ofertada', 'confirmada'];

/** One entry of `RefillRequestResponseDto.items` — mirrors `RefillItem` (`@repon/types`) field-for-field. */
export class RefillItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

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
 * Response shape for `crearSolicitud` (201) — mirrors `RefillRequestActiva`
 * (`@repon/types`) field-for-field. `estado` is typed `RefillEstadoActivo`
 * (never `'borrador'`): this DTO only ever represents an active request —
 * `crearSolicitud` always returns `estado: 'abierta'` by construction
 * (Phase 2's `crearSolicitudActiva`), and Phase 6b's `completarBorrador`
 * (which returns the same union member) is the only other producer this
 * DTO is expected to serve, reused as-is (task 4b.2's own mapper doc
 * comment names this precedent).
 */
export class RefillRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  direccion!: string;

  @ApiProperty()
  comuna!: string;

  @ApiProperty({ enum: URGENCIAS })
  urgencia!: Urgencia;

  @ApiProperty({ enum: ESTADOS_ACTIVOS })
  estado!: RefillEstadoActivo;

  @ApiProperty({ type: [RefillItemResponseDto] })
  items!: RefillItemResponseDto[];
}
