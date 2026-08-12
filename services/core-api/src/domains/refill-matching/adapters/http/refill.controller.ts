import {
  Body,
  Controller,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { BuscarProveedoresCompatiblesUseCase } from '../../ports-in/buscar-proveedores-compatibles.use-case';
import { CompletarBorradorUseCase } from '../../ports-in/completar-borrador.use-case';
import { CrearSolicitudUseCase } from '../../ports-in/crear-solicitud.use-case';
import { RefillExceptionFilter } from './refill-exception.filter';
import { toProveedorCompatibleDto, toRefillRequestResponseDto } from './refill.mapper';
import { CompletarBorradorDto } from './dto/completar-borrador.dto';
import { CrearSolicitudDto } from './dto/crear-solicitud.dto';
import { ProveedorCompatibleDto } from './dto/proveedor-compatible.dto';
import { RefillRequestResponseDto } from './dto/refill-request-response.dto';

/**
 * design.md D-E's "Superficie HTTP" table. Prefix `refill`, not
 * `refill-matching`: a hyphenated domain exposes its resource family, not
 * its internal name (design.md: "un dominio con nombre compuesto expone su
 * familia de recursos, no su nombre interno" — `pedidos-pagos` inherits
 * this rule; `openspec/changes/.../tasks.md` 4b.3 confirms the same,
 * pinned as load-bearing, not cosmetic). `mis-` codifies D13 in the URL
 * space, same as `mis-consumos`/`mi-catalogo`: no `:userId` path param
 * ever exists on any route this controller declares, so the only source
 * of the owner is `actor.profileId`.
 *
 * No `@Roles()` anywhere in this controller, and it's a decision, not an
 * omission: `refill_requests.user_id` references `profiles(id)` with no
 * role restriction, and its RLS policy is `user_id = auth.uid()` with no
 * role check — `@Roles('user')` would make the API stricter than the
 * database and would block a `provider` profile (who can also own a pet)
 * from requesting a refill. Same reasoning `ConsumoController` already
 * used for every one of its routes.
 *
 * This is this domain's FIRST controller — Phase 5b (`.../matching`) and
 * Phase 6b (`.../completar`) EXTEND this same class with more `@Post()`
 * handlers, they never create a second controller for this domain.
 */
@ApiTags('refill')
@ApiBearerAuth()
@Controller('refill')
@UseFilters(RefillExceptionFilter)
export class RefillController {
  constructor(
    private readonly crearSolicitudUseCase: CrearSolicitudUseCase,
    private readonly buscarProveedoresCompatiblesUseCase: BuscarProveedoresCompatiblesUseCase,
    private readonly completarBorradorUseCase: CompletarBorradorUseCase,
  ) {}

  @Post('mis-solicitudes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Crea una solicitud de reposición propia del actor autenticado, nace en estado ' +
      "'abierta' (D13: sin userId en el body).",
  })
  @ApiCreatedResponse({ type: RefillRequestResponseDto })
  @ApiBadRequestResponse({
    description: 'DTO inválido (0 ítems, campos vacíos, precio negativo — 400 SOLICITUD_INVALIDA).',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async crearSolicitud(
    @Body() dto: CrearSolicitudDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<RefillRequestResponseDto> {
    const entity = await this.crearSolicitudUseCase.execute(
      actor.profileId,
      dto.items,
      dto.direccion,
      dto.comuna,
      dto.urgencia,
    );
    return toRefillRequestResponseDto(entity);
  }

  @Post('mis-solicitudes/:refillRequestId/matching')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Busca proveedores compatibles para una solicitud propia del actor autenticado y ' +
      'publica MatchEncontrado (D-E: POST, no GET — esta operación no es segura ni ' +
      'idempotente porque publica un evento).',
  })
  @ApiParam({ name: 'refillRequestId', format: 'uuid' })
  @ApiOkResponse({ type: ProveedorCompatibleDto, isArray: true })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiNotFoundResponse({
    description:
      'La solicitud no existe, o pertenece a otro usuario (404, nunca 403 — D13; byte a ' +
      'byte idéntico también sobre un borrador ajeno, D-F).',
  })
  @ApiConflictResponse({
    description:
      'La solicitud propia está en borrador y no admite matching (409 REFILL_REQUEST_EN_BORRADOR — D-F).',
  })
  @ApiServiceUnavailableResponse({
    description: 'El catálogo no pudo responder la consulta (503 CATALOG_UNAVAILABLE — C8/D15).',
  })
  async buscarProveedoresCompatibles(
    @Param('refillRequestId', ParseUUIDPipe) refillRequestId: string,
    @Actor() actor: AuthenticatedActor,
  ): Promise<ProveedorCompatibleDto[]> {
    const matches = await this.buscarProveedoresCompatiblesUseCase.execute(
      actor.profileId,
      refillRequestId,
    );
    return matches.map(toProveedorCompatibleDto);
  }

  @Post('mis-solicitudes/:refillRequestId/completar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Completa un borrador propio del actor autenticado y lo transiciona a 'abierta', " +
      'publicando RefillCreado después del commit (D-C Decisión 1; 200, no 201 — no crea ' +
      'un recurso nuevo, transiciona uno existente).',
  })
  @ApiParam({ name: 'refillRequestId', format: 'uuid' })
  @ApiOkResponse({ type: RefillRequestResponseDto })
  @ApiBadRequestResponse({
    description:
      "DTO inválido, o la transición a 'abierta' queda incompleta (400 REFILL_REQUEST_INCOMPLETA " +
      '/ REFILL_ITEM_DESCONOCIDO — D3/D4).',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiNotFoundResponse({
    description: 'La solicitud no existe, o pertenece a otro usuario (404, nunca 403 — D13).',
  })
  @ApiConflictResponse({
    description: "La solicitud no está en 'borrador' (409 TRANSICION_INVALIDA).",
  })
  async completarBorrador(
    @Param('refillRequestId', ParseUUIDPipe) refillRequestId: string,
    @Body() dto: CompletarBorradorDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<RefillRequestResponseDto> {
    const entity = await this.completarBorradorUseCase.execute(
      actor.profileId,
      refillRequestId,
      dto,
    );
    return toRefillRequestResponseDto(entity);
  }
}
