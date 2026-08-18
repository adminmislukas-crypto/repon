import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefrescarSesionDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
