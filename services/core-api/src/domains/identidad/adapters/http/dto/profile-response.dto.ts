import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ProfileStatus, Role } from '@repon/types';

/** Response shape for `registrarUsuario` (201) — mirrors `@repon/types`' `Profile`. */
export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['user', 'provider', 'admin'] })
  role!: Role;

  @ApiProperty({ enum: ['activo', 'suspendido'] })
  status!: ProfileStatus;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  companyId?: string;
}
