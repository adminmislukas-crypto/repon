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
  UseFilters,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import { Roles } from '../../../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { ActualizarPrecioUseCase } from '../../ports-in/actualizar-precio.use-case';
import { BuscarProductosUseCase } from '../../ports-in/buscar-productos.use-case';
import { CargarProductoCatalogoUseCase } from '../../ports-in/cargar-producto-catalogo.use-case';
import { CatalogoExceptionFilter } from './catalogo-exception.filter';
import {
  toCatalogProductResponseDto,
  toNuevoProductoProveedor,
  toProviderCatalogItemResponseDto,
} from './catalogo.mapper';
import { ActualizarPrecioDto } from './dto/actualizar-precio.dto';
import { CatalogProductResponseDto } from './dto/catalog-product-response.dto';
import { NuevoProductoDto } from './dto/nuevo-producto.dto';
import { ProviderCatalogItemResponseDto } from './dto/provider-catalog-item-response.dto';

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
}
