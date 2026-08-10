import { Controller, Get, Param, ParseUUIDPipe, UseFilters } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { CalcularDiasRestantesUseCase } from '../../ports-in/calcular-dias-restantes.use-case';
import { ConsumoExceptionFilter } from './consumo-exception.filter';
import { toDiasRestantesResponseDto } from './consumo.mapper';
import { DiasRestantesResponseDto } from './dto/dias-restantes-response.dto';

// design.md's "Superficie HTTP" table. `mis-` codifies D8 in the URL space,
// exactly like `mi-catalogo` in `catalogo` — no `:userId` path param ever
// exists, so the only source of the owner is `actor.profileId`. No
// `@Roles()` anywhere in this controller, and it's a decision, not an
// omission: `pets`/`user_consumption` reference `profiles(id)` with no role
// restriction and their RLS policies are `user_id = auth.uid()` with no role
// check — the same reasoning `GET /catalogo/productos` already used.
@ApiTags('consumo')
@ApiBearerAuth()
@Controller('consumo')
@UseFilters(ConsumoExceptionFilter)
export class ConsumoController {
  constructor(private readonly calcularDiasRestantesUseCase: CalcularDiasRestantesUseCase) {}

  @Get('mis-consumos/:consumptionId/dias-restantes')
  @ApiOperation({
    summary:
      'Días restantes de stock para un UserConsumption propio del actor autenticado (D8: ' +
      'ningún :userId en la URL).',
  })
  @ApiParam({ name: 'consumptionId', format: 'uuid' })
  @ApiOkResponse({ type: DiasRestantesResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiNotFoundResponse({
    description:
      'El consumo no existe, o pertenece a otro usuario (404, nunca 403 — D7: no filtra ' +
      'existencia cross-tenant sobre datos de salud).',
  })
  async calcularDiasRestantes(
    @Param('consumptionId', ParseUUIDPipe) consumptionId: string,
    @Actor() actor: AuthenticatedActor,
  ): Promise<DiasRestantesResponseDto> {
    const diasRestantes = await this.calcularDiasRestantesUseCase.execute(
      actor.profileId,
      consumptionId,
    );
    return toDiasRestantesResponseDto(diasRestantes);
  }
}
