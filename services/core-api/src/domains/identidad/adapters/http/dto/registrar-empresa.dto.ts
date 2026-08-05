import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** `POST /identidad/empresas` is `@Public()` — self-service company registration. */
export class RegistrarEmpresaDto {
  @ApiProperty({ example: 'Proveedora Agua SPA' })
  @IsString()
  @IsNotEmpty()
  razonSocial!: string;

  @ApiProperty({ example: '76.123.456-7' })
  @IsString()
  @IsNotEmpty()
  rut!: string;

  @ApiProperty({ example: 'Distribución de agua' })
  @IsString()
  @IsNotEmpty()
  giro!: string;
}
