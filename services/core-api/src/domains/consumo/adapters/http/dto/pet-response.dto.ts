import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shape for `registrarMascota` (201) — mirrors `@repon/types`' `Pet`. */
export class PetResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  especie!: string;

  @ApiPropertyOptional()
  raza?: string;

  @ApiPropertyOptional()
  pesoKg?: number;
}
