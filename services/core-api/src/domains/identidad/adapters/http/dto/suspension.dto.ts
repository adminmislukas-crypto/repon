import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Shared by `suspenderUsuario` and `suspenderEmpresa` — both take only a `motivo`. */
export class SuspensionDto {
  @ApiProperty({ example: 'Incumplimiento de contrato' })
  @IsString()
  @IsNotEmpty()
  motivo!: string;
}
