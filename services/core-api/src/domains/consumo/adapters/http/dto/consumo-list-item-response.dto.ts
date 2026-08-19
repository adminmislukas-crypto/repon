import { ApiProperty } from '@nestjs/swagger';
import { UserConsumptionResponseDto } from './user-consumption-response.dto';

/**
 * `GET /consumo/mis-consumos` row shape (usuario-mobile-consumo design.md
 * D-5/D7) — `UserConsumptionResponseDto` plus a server-computed
 * `diasRestantes` so the client never issues a per-item follow-up request
 * and never re-derives the formula itself.
 */
export class ConsumoListItemResponseDto extends UserConsumptionResponseDto {
  @ApiProperty()
  diasRestantes!: number;
}
