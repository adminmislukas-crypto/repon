import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import { Roles } from '../../../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { ArchivoCargaInvalidoError } from '../../domain/catalogo.errors';
import { ActualizarPrecioUseCase } from '../../ports-in/actualizar-precio.use-case';
import { BuscarProductosUseCase } from '../../ports-in/buscar-productos.use-case';
import { CargarCatalogoMasivoUseCase } from '../../ports-in/cargar-catalogo-masivo.use-case';
import { CargarProductoCatalogoUseCase } from '../../ports-in/cargar-producto-catalogo.use-case';
import {
  CARGA_MASIVA_FILE_FIELD,
  CARGA_MASIVA_MAX_BYTES,
  parseArchivoCarga,
} from './carga-masiva.parser';
import { CatalogoExceptionFilter } from './catalogo-exception.filter';
import {
  toCatalogProductResponseDto,
  toNuevoProductoProveedor,
  toProviderCatalogItemResponseDto,
  toResultadoCargaMasivaResponseDto,
} from './catalogo.mapper';
import { ActualizarPrecioDto } from './dto/actualizar-precio.dto';
import { CargaMasivaDto } from './dto/carga-masiva.dto';
import { CatalogProductResponseDto } from './dto/catalog-product-response.dto';
import { NuevoProductoDto } from './dto/nuevo-producto.dto';
import { ProviderCatalogItemResponseDto } from './dto/provider-catalog-item-response.dto';
import { ResultadoCargaMasivaResponseDto } from './dto/resultado-carga-masiva-response.dto';

// design.md's "Superficie HTTP" table. `GET /catalogo/productos` is
// authenticated (no `@Public()` — the underlying grants are
// `authenticated`-only, Q6 of `db-schema-catalogo`) but carries no
// `@Roles()`/`@AdminRoles()` — any authenticated actor, any role, may
// search the shared reference catalog. The 2 write routes below live under
// `mi-catalogo` (D8 encoded in the URL space — no `:companyId` path param
// ever exists) and require `@Roles('provider')`; both derive `companyId`/
// `companyStatus` from the authenticated actor only, never from the
// request body or path (D8/D-E).
@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo')
@UseFilters(CatalogoExceptionFilter)
export class CatalogoController {
  constructor(
    private readonly buscarProductosUseCase: BuscarProductosUseCase,
    private readonly cargarProductoCatalogoUseCase: CargarProductoCatalogoUseCase,
    private readonly actualizarPrecioUseCase: ActualizarPrecioUseCase,
    private readonly cargarCatalogoMasivoUseCase: CargarCatalogoMasivoUseCase,
  ) {}

  @Get('productos')
  @ApiOperation({
    summary: 'Busca en el catálogo de referencia compartido, sin dimensión de empresa.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Término de búsqueda (nombre).' })
  @ApiQuery({ name: 'categoria', required: false })
  @ApiOkResponse({ type: CatalogProductResponseDto, isArray: true })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async buscarProductos(
    @Query('q') q: string = '',
    @Query('categoria') categoria?: string,
  ): Promise<CatalogProductResponseDto[]> {
    const products = await this.buscarProductosUseCase.execute(q, categoria);
    return products.map(toCatalogProductResponseDto);
  }

  @Roles('provider')
  @Post('mi-catalogo')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Carga un producto al catálogo propio del proveedor autenticado.' })
  @ApiCreatedResponse({ type: ProviderCatalogItemResponseDto })
  @ApiBadRequestResponse({ description: 'DTO inválido, o precioMaximo < precioBase.' })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider, o su empresa no está activa.' })
  async cargarProductoCatalogo(
    @Body() dto: NuevoProductoDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<ProviderCatalogItemResponseDto> {
    // `@Roles('provider')` already passed by the time this handler runs
    // (`RolesGuard` rejects any other `actor.role` first) — `companyId`/
    // `companyStatus` are "Non-null iff role === 'provider'"
    // (`AuthenticatedActor`'s own doc comment), so the non-null assertion
    // here reflects a guard-enforced invariant, not an unchecked guess.
    const item = await this.cargarProductoCatalogoUseCase.execute(
      actor.companyId!,
      actor.companyStatus!,
      toNuevoProductoProveedor(dto),
    );
    return toProviderCatalogItemResponseDto(item);
  }

  @Roles('provider')
  @Put('mi-catalogo/:itemId/precio')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Actualiza el precio de un ítem del catálogo propio.' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'DTO inválido, o precioMaximo < precioBase.' })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider, o su empresa no está activa.' })
  @ApiNotFoundResponse({
    description:
      'El ítem no existe, o pertenece a otra empresa (404, nunca 403 — D7: no filtra existencia cross-tenant).',
  })
  async actualizarPrecio(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ActualizarPrecioDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.actualizarPrecioUseCase.execute(
      actor.companyId!,
      actor.companyStatus!,
      itemId,
      dto.precioBase,
      dto.precioMaximo,
    );
  }

  @Roles('provider')
  @Post('mi-catalogo/carga-masiva')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(CARGA_MASIVA_FILE_FIELD, { limits: { fileSize: CARGA_MASIVA_MAX_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CargaMasivaDto })
  @ApiOperation({
    summary: 'Carga masiva de productos al catálogo propio, vía archivo CSV (multipart/form-data).',
  })
  @ApiOkResponse({ type: ResultadoCargaMasivaResponseDto })
  @ApiBadRequestResponse({
    description:
      'Archivo inválido: mimetype, cantidad de filas, o cabecera (design.md Diagram 1, P1). ' +
      'Nada se escribió ni se emitió. NOTA: un archivo que excede ' +
      `${CARGA_MASIVA_MAX_BYTES} bytes no llega a este código — ver 413 abajo.`,
  })
  @ApiPayloadTooLargeResponse({
    description:
      `Archivo mayor a ${CARGA_MASIVA_MAX_BYTES} bytes. Rechazado por el límite de ` +
      "Multer (`FileInterceptor`'s `limits.fileSize`) ANTES de que el archivo se " +
      'bufferee en memoria — deliberadamente más estricto que el chequeo de tamaño ' +
      'que `parseArchivoCarga` también hace (ese segundo chequeo cubre un `Content-Length` ' +
      'ausente o mentiroso; en la práctica Multer siempre gana primero). No es un caso de ' +
      '`ARCHIVO_CARGA_INVALIDO` (400) — es un rechazo a nivel de transporte, decisión ' +
      'deliberada para nunca bufferear un archivo que ya sabemos que es demasiado grande.',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es provider, o su empresa no está activa.' })
  async cargarCatalogoMasivo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Actor() actor: AuthenticatedActor,
  ): Promise<ResultadoCargaMasivaResponseDto> {
    // No file on the multipart field at all — `parseArchivoCarga` reads
    // `.mimetype`/`.size`/`.buffer` and would throw a raw TypeError on
    // `undefined`, which is not what `ARCHIVO_CARGA_INVALIDO` should look
    // like to a client. Same envelope-rejection shape as every other check
    // inside `parseArchivoCarga` itself: 400, before the use case runs.
    if (!file) {
      throw new ArchivoCargaInvalidoError(
        `Falta el archivo en el campo "${CARGA_MASIVA_FILE_FIELD}" del multipart/form-data.`,
      );
    }

    // (P1 + P2) Envelope validation + form-only row mapping — throws 400
    // ARCHIVO_CARGA_INVALIDO before cargarCatalogoMasivo (and its
    // EmpresaNoActivaError gate) ever runs: nothing is written, nothing is
    // emitted for an invalid envelope (design.md Diagram 1).
    const archivo = parseArchivoCarga(file);

    const resultado = await this.cargarCatalogoMasivoUseCase.execute(
      actor.companyId!,
      actor.companyStatus!,
      archivo,
    );
    return toResultadoCargaMasivaResponseDto(resultado);
  }
}
