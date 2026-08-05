import type { CatalogProduct } from '@repon/types';
import type { CatalogProductResponseDto } from './dto/catalog-product-response.dto';

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
