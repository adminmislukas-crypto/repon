import { Controller, Get, UseFilters } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import { Roles } from '../../../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { ListarSolicitudesElegiblesUseCase } from '../../ports-in/listar-solicitudes-elegibles.use-case';
import { SolicitudElegibleDto } from './dto/solicitud-elegible-response.dto';
import { OfertasExceptionFilter } from './ofertas-exception.filter';
import { toSolicitudElegibleResponseDto } from './ofertas.mapper';

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
 * `@Roles('provider')`: `listarSolicitudesElegibles` derives `companyId`
 * exclusively from `actor.companyId` — never a query/path param (D11).
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
}
