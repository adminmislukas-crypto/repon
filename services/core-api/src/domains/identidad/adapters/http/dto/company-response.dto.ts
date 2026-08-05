import { ApiProperty } from '@nestjs/swagger';
import type { CompanyStatus } from '@repon/types';

/** Response shape for `registrarEmpresa` (201) — mirrors `@repon/types`' `Company`. */
export class CompanyResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  razonSocial!: string;

  @ApiProperty()
  rut!: string;

  @ApiProperty()
  giro!: string;

  @ApiProperty({ enum: ['pendiente', 'activo', 'suspendido'] })
  status!: CompanyStatus;
}
