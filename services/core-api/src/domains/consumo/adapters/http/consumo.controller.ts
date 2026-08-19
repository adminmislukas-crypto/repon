import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { CalcularAdherenciaSemanalUseCase } from '../../ports-in/calcular-adherencia-semanal.use-case';
import { CalcularDiasRestantesUseCase } from '../../ports-in/calcular-dias-restantes.use-case';
import { ConfigurarConsumoUseCase } from '../../ports-in/configurar-consumo.use-case';
import { ListarConsumosUseCase } from '../../ports-in/listar-consumos.use-case';
import { ListarMascotasUseCase } from '../../ports-in/listar-mascotas.use-case';
import { MarcarDosisTomadaUseCase } from '../../ports-in/marcar-dosis-tomada.use-case';
import { RegistrarMascotaUseCase } from '../../ports-in/registrar-mascota.use-case';
import { ConsumoExceptionFilter } from './consumo-exception.filter';
import {
  toAdherenciaResponseDto,
  toConsumoListItemResponseDto,
  toDiasRestantesResponseDto,
  toNuevaMascotaInput,
  toNuevoConsumoInput,
  toPetResponseDto,
  toUserConsumptionResponseDto,
} from './consumo.mapper';
import { AdherenciaResponseDto } from './dto/adherencia-response.dto';
import { ConsumoListItemResponseDto } from './dto/consumo-list-item-response.dto';
import { DiasRestantesResponseDto } from './dto/dias-restantes-response.dto';
import { MarcarDosisDto } from './dto/marcar-dosis.dto';
import { NuevaMascotaDto } from './dto/nueva-mascota.dto';
import { NuevoConsumoDto } from './dto/nuevo-consumo.dto';
import { PetResponseDto } from './dto/pet-response.dto';
import { UserConsumptionResponseDto } from './dto/user-consumption-response.dto';

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
  constructor(
    private readonly calcularDiasRestantesUseCase: CalcularDiasRestantesUseCase,
    private readonly registrarMascotaUseCase: RegistrarMascotaUseCase,
    private readonly configurarConsumoUseCase: ConfigurarConsumoUseCase,
    private readonly marcarDosisTomadaUseCase: MarcarDosisTomadaUseCase,
    private readonly listarMascotasUseCase: ListarMascotasUseCase,
    private readonly listarConsumosUseCase: ListarConsumosUseCase,
    private readonly calcularAdherenciaSemanalUseCase: CalcularAdherenciaSemanalUseCase,
  ) {}

  @Get('mis-mascotas')
  @ApiOperation({
    summary:
      'Lista las mascotas propias del actor autenticado (usuario-mobile-consumo D-4: sin ' +
      'filtro de usuario aceptado desde el cliente).',
  })
  @ApiOkResponse({ type: [PetResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async listarMascotas(@Actor() actor: AuthenticatedActor): Promise<PetResponseDto[]> {
    const pets = await this.listarMascotasUseCase.execute(actor.profileId);
    return pets.map(toPetResponseDto);
  }

  @Get('mis-consumos')
  @ApiOperation({
    summary:
      'Lista los UserConsumption propios del actor autenticado, cada uno con diasRestantes ' +
      'ya calculado (usuario-mobile-consumo D7: nunca un request por item).',
  })
  @ApiOkResponse({ type: [ConsumoListItemResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async listarConsumos(@Actor() actor: AuthenticatedActor): Promise<ConsumoListItemResponseDto[]> {
    const items = await this.listarConsumosUseCase.execute(actor.profileId);
    return items.map(toConsumoListItemResponseDto);
  }

  @Get('mi-adherencia')
  @ApiOperation({
    summary:
      'Adherencia de los últimos 7 días del actor autenticado, ya calculada server-side ' +
      '(usuario-mobile-consumo D-2/D6: el cliente nunca recalcula adherencia). Nunca acepta ' +
      'un consumptionId — el set de ids sale de las propias mascotas/consumos del actor (D-4).',
  })
  @ApiOkResponse({ type: AdherenciaResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async calcularAdherenciaSemanal(
    @Actor() actor: AuthenticatedActor,
  ): Promise<AdherenciaResponseDto> {
    const adherencia = await this.calcularAdherenciaSemanalUseCase.execute(actor.profileId);
    return toAdherenciaResponseDto(adherencia);
  }

  @Post('mis-mascotas')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registra una mascota propia del actor autenticado (D8: sin userId en el body).',
  })
  @ApiCreatedResponse({ type: PetResponseDto })
  @ApiBadRequestResponse({
    description: 'DTO inválido (nombre/especie vacíos, o un userId no permitido en el body).',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async registrarMascota(
    @Body() dto: NuevaMascotaDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<PetResponseDto> {
    const pet = await this.registrarMascotaUseCase.execute(
      actor.profileId,
      toNuevaMascotaInput(dto),
    );
    return toPetResponseDto(pet);
  }

  @Post('mis-consumos')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Configura un UserConsumption propio del actor autenticado (D8: sin userId en el body).',
  })
  @ApiCreatedResponse({ type: UserConsumptionResponseDto })
  @ApiBadRequestResponse({ description: 'DTO inválido, o un userId no permitido en el body.' })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiNotFoundResponse({
    description:
      'El petId suministrado no existe, o pertenece a otro usuario (404, nunca 403 — D-H.3).',
  })
  async configurarConsumo(
    @Body() dto: NuevoConsumoDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<UserConsumptionResponseDto> {
    const consumption = await this.configurarConsumoUseCase.execute(
      actor.profileId,
      toNuevoConsumoInput(dto),
    );
    return toUserConsumptionResponseDto(consumption);
  }

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

  @Post('mis-consumos/:consumptionId/dosis')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Registra una dosis/porción tomada para un UserConsumption propio del actor ' +
      'autenticado (D8: ningún :userId en la URL; D-H.2: sin cantidad en el body — ' +
      'siempre se descuenta dosisPorToma).',
  })
  @ApiParam({ name: 'consumptionId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'DTO inválido, o tomadoAt es un instante futuro (400 DOSIS_INVALIDA).',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiNotFoundResponse({
    description:
      'El consumo no existe, o pertenece a otro usuario (404, nunca 403 — D7: no filtra ' +
      'existencia cross-tenant sobre datos de salud).',
  })
  async marcarDosisTomada(
    @Param('consumptionId', ParseUUIDPipe) consumptionId: string,
    @Body() dto: MarcarDosisDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.marcarDosisTomadaUseCase.execute(actor.profileId, consumptionId, dto.tomadoAt);
  }
}
