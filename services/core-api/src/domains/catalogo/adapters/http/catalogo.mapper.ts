import type { CatalogProduct, NuevoProductoProveedor, ProviderCatalogItem } from '@repon/types';
import type { CatalogProductResponseDto } from './dto/catalog-product-response.dto';
import type { NuevoProductoDto } from './dto/nuevo-producto.dto';
import type { ProviderCatalogItemResponseDto } from './dto/provider-catalog-item-response.dto';

/**
 * `core-api-hexagonal-layout` spec, "DTOs and framework decorators stay in
 * adapters/http": the thin domain-entity <-> response-DTO conversion, kept
 * free of business logic (that lives in `ports-in/buscar-productos.use-case.ts`).
 */
export function toCatalogProductResponseDto(product: CatalogProduct): CatalogProductResponseDto {
  return {
    id: product.id,
    nombre: product.nombre,
    categoria: product.categoria,
    marca: product.marca,
    presentacion: product.presentacion,
    imagenUrl: product.imagenUrl,
    status: product.status,
  };
}

/**
 * `POST /catalogo/mi-catalogo` body -> `CargarProductoCatalogoUseCase`'s
 * `producto` param. Deliberately does NOT read a `companyId` off `dto` — it
 * has none (D8); the controller supplies `companyId` separately, from
 * `actor.companyId`.
 */
export function toNuevoProductoProveedor(dto: NuevoProductoDto): NuevoProductoProveedor {
  return {
    catalogProductId: dto.catalogProductId,
    nombre: dto.nombre,
    categoria: dto.categoria,
    precioBase: dto.precioBase,
    precioMaximo: dto.precioMaximo,
    stock: dto.stock,
    disponible: dto.disponible,
    imagenUrl: dto.imagenUrl,
  };
}

/** Response shape for `cargarProductoCatalogo` (201). */
export function toProviderCatalogItemResponseDto(
  item: ProviderCatalogItem,
): ProviderCatalogItemResponseDto {
  return {
    id: item.id,
    companyId: item.companyId,
    catalogProductId: item.catalogProductId,
    nombre: item.nombre,
    categoria: item.categoria,
    precioBase: item.precioBase,
    precioMaximo: item.precioMaximo,
    stock: item.stock,
    disponible: item.disponible,
    imagenUrl: item.imagenUrl,
  };
}

// `PUT /catalogo/mi-catalogo/:itemId/precio`'s `ActualizarPrecioDto` has
// only 2 fields (`precioBase`/`precioMaximo`), both passed straight through
// to `execute()` as scalars from the controller (same convention as
// `SuspensionDto.motivo` in `identidad.controller.ts`) — no dedicated
// mapper function for a 2-field passthrough.
