import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import { Roles } from '../../../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { EnviarOfertaProactivaUseCase } from '../../ports-in/enviar-oferta-proactiva.use-case';
import { EnviarOfertaUseCase } from '../../ports-in/enviar-oferta.use-case';
import { ListarSolicitudesElegiblesUseCase } from '../../ports-in/listar-solicitudes-elegibles.use-case';
import { EnviarOfertaProactivaDto } from './dto/enviar-oferta-proactiva.dto';
import { EnviarOfertaDto } from './dto/enviar-oferta.dto';
import { OfferResponseDto } from './dto/offer-response.dto';
import { SolicitudElegibleDto } from './dto/solicitud-elegible-response.dto';
import { OfertasExceptionFilter } from './ofertas-exception.filter';
import {
  toNuevoOfertaItemsProactiva,
  toNuevoOfertaItemsReactiva,
  toOfferResponseDto,
  toSolicitudElegibleResponseDto,
} from './ofertas.mapper';

/**
 * design.md D-E's "Superficie HTTP" table, prefix `ofertas` (one-word
 * domain, no deviation — same precedent `identidad`/`catalogo`/`consumo`
 * already established; `refill-matching`'s own compound-name rule does not
 * propagate here).
 *
 * This is this domain's **FIRST controller** — Phase 5b
 * (`POST /ofertas`), Phase 6b (`POST /ofertas/proactivas`), Phase 7b
 * (`POST /ofertas/:offerId/aceptar`, `GET /ofertas/bandeja`) EXTEND this
 * same class with more route handlers, they never create a second
 * controller for this domain (same discipline `RefillController`/
 * `CatalogoController` already established for their own first-controller
 * PRs).
 *
 * `@Roles('provider')`: both routes derive `companyId` exclusively from
 * `actor.companyId` — never a query/path param, never a DTO field (D11).
 * `actor.companyId` is non-null iff `role === 'provider'`
 * (`AuthenticatedActor`'s own doc comment) — the guard-enforced invariant
 * behind the non-null assertion below, same reasoning
 * `CatalogoController`'s own provider-scoped routes already use.
 */
@ApiTags('ofertas')
@ApiBearerAuth()
@Controller('ofertas')
@UseFilters(OfertasExceptionFilter)
export class OfertasController {
  constructor(
    private readonly listarSolicitudesElegiblesUseCase: ListarSolicitudesElegiblesUseCase,
    private readonly enviarOfertaUseCase: EnviarOfertaUseCase,
    private readonly enviarOfertaProactivaUseCase: EnviarOfertaProactivaUseCase,
  ) {}

  @Roles('provider')
  @Get('oportunidades')
  @ApiOperation({
    summary:
      'Lista las solicitudes actualmente elegibles para la empresa del proveedor autenticado ' +
      '(design.md Diagrama 3) — nunca incluye oportunidades cerradas ni empresas ya no vigentes.',
  })
  @ApiOkResponse({ type: SolicitudElegibleDto, isArray: true })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider.' })
  async listarOportunidades(@Actor() actor: AuthenticatedActor): Promise<SolicitudElegibleDto[]> {
    const solicitudes = await this.listarSolicitudesElegiblesUseCase.execute(actor.companyId!);
    return solicitudes.map(toSolicitudElegibleResponseDto);
  }

  /**
   * Task 5b.3 / design.md Diagrama 2. `actor.companyId!` — same
   * guard-enforced non-null pattern `listarOportunidades` above and
   * `CatalogoController.cargarProductoCatalogo` already use.
   * `toNuevoOfertaItemsReactiva` narrows the DTO's discriminated-but-
   * optional item shape to `EnviarOfertaUseCase`'s
   * `readonly NuevoOfferItemReactiva[]` parameter (`ofertas.mapper.ts`'s
   * own doc comment).
   */
  @Roles('provider')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'El proveedor autenticado envía una oferta reactiva contra una solicitud elegible ' +
      '(design.md Diagrama 2).',
  })
  @ApiCreatedResponse({ type: OfferResponseDto })
  @ApiBadRequestResponse({
    description:
      'DTO inválido, un refillItemId ajeno a la solicitud, o un item sin coincidencia vigente ' +
      '(o por sobre el techo de precio) en el catálogo del proveedor.',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider.' })
  @ApiNotFoundResponse({
    description:
      'La solicitud no existe, o esta empresa no es elegible — mismo 404, byte a byte (D11).',
  })
  @ApiConflictResponse({ description: 'La oportunidad de esta solicitud ya está cerrada.' })
  @ApiServiceUnavailableResponse({ description: 'El catálogo no pudo responder la consulta.' })
  async enviarOferta(
    @Body() dto: EnviarOfertaDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<OfferResponseDto> {
    const offer = await this.enviarOfertaUseCase.execute(
      actor.companyId!,
      dto.refillRequestId,
      toNuevoOfertaItemsReactiva(dto.items),
      dto.entrega,
    );
    return toOfferResponseDto(offer);
  }

  /**
   * Task 6b.6 / design.md Diagrama 2, línea 662 (diferencias (a)-(c)).
   * `actor.companyId!` — mismo patrón guard-enforced que `enviarOferta`
   * arriba. `dto.userId` es el destinatario — nunca `actor.userId`/
   * `actor.profileId` (esta ruta la invoca un PROVIDER; el destinatario
   * viaja en el DTO, la única excepción deliberada de D11, acotada por D10).
   * `toNuevoOfertaItemsProactiva` narrows the DTO's shared item shape to
   * `EnviarOfertaProactivaUseCase`'s `readonly NuevoOfferItemProactiva[]`
   * parameter (`ofertas.mapper.ts`'s own doc comment).
   */
  @Roles('provider')
  @Post('proactivas')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'El proveedor autenticado envía una oferta proactiva a un usuario con el que tuvo una ' +
      'relación previa (D10) — sin solicitud de origen (design.md Diagrama 2, diferencias a-c).',
  })
  @ApiCreatedResponse({ type: OfferResponseDto })
  @ApiBadRequestResponse({
    description:
      'DTO inválido, o al menos un item no pertenece al catálogo de esta empresa/no está ' +
      'disponible (D-B: la cardinalidad del resultado no coincide con la pedida).',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider.' })
  @ApiNotFoundResponse({
    description: 'El userId destinatario no tiene relación previa con esta empresa (D10).',
  })
  @ApiServiceUnavailableResponse({ description: 'El catálogo no pudo responder la consulta.' })
  async enviarOfertaProactiva(
    @Body() dto: EnviarOfertaProactivaDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<OfferResponseDto> {
    const offer = await this.enviarOfertaProactivaUseCase.execute(
      actor.companyId!,
      dto.userId,
      toNuevoOfertaItemsProactiva(dto.items),
      dto.entrega,
      dto.mensaje,
    );
    return toOfferResponseDto(offer);
  }
}
