import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { BuscarProductosUseCase } from '../../ports-in/buscar-productos.use-case';
import { toCatalogProductResponseDto } from './catalogo.mapper';
import { CatalogProductResponseDto } from './dto/catalog-product-response.dto';

// design.md's "Superficie HTTP" table: `GET /catalogo/productos` is
// authenticated (no `@Public()` — the underlying grants are
// `authenticated`-only, Q6 of `db-schema-catalogo`) but carries no
// `@Roles()`/`@AdminRoles()` — any authenticated actor, any role, may
// search the shared reference catalog.
@ApiTags('catalogo')
@ApiBearerAuth()
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly buscarProductosUseCase: BuscarProductosUseCase) {}

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
}
