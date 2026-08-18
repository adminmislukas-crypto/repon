import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CompanyStatus } from '@repon/types';
import { ProfileResponseDto } from './profile-response.dto';

/** Response shape for `iniciarSesion`/`refrescarSesion` (200) — one parser, both routes (design.md D-2). */
export class SesionResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ enum: ['bearer'] })
  tokenType!: 'bearer';

  @ApiProperty({ description: 'Unix seconds, straight from GoTrue — never locally reinterpreted.' })
  expiresAt!: number;

  @ApiProperty({ type: ProfileResponseDto })
  perfil!: ProfileResponseDto;

  /** Non-null iff `perfil.role === 'provider'`. `'pendiente'` is a valid success value (spec). */
  @ApiPropertyOptional({ enum: ['pendiente', 'activo', 'suspendido'] })
  companyStatus?: CompanyStatus;
}
