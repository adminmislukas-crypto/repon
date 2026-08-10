import { ApiProperty } from '@nestjs/swagger';

/** Response shape for `GET /consumo/mis-consumos/:consumptionId/dias-restantes` (200). */
export class DiasRestantesResponseDto {
  @ApiProperty({
    description: 'Días restantes de stock, Math.floor (nunca redondeado hacia arriba).',
  })
  diasRestantes!: number;
}
