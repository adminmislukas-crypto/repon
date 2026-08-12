import type { ProviderCatalogItem, RefillRequestActiva } from '@repon/types';
import type { ProveedorCompatibleDto } from './dto/proveedor-compatible.dto';
import type { RefillRequestResponseDto } from './dto/refill-request-response.dto';

/**
 * `core-api-hexagonal-layout` spec, "DTOs and framework decorators stay in
 * adapters/http": the thin entity <-> response-DTO conversion, kept free of
 * business logic — mirrors `consumo.mapper.ts`'s `toUserConsumptionResponseDto`
 * / `catalogo.mapper.ts`'s equivalents. `CrearSolicitudUseCase.execute()`
 * already returns the full `RefillRequestActiva` entity (PR4a), so this
 * needs no follow-up `findById` call.
 *
 * More `toXResponseDto` functions land here as later phases (5b's
 * `ProveedorCompatibleDto`, 6b reuses this same function for
 * `completarBorrador`) add routes — this file is appended to, not
 * one-mapper-per-file.
 */
export function toRefillRequestResponseDto(entity: RefillRequestActiva): RefillRequestResponseDto {
  return {
    id: entity.id,
    userId: entity.userId,
    direccion: entity.direccion,
    comuna: entity.comuna,
    urgencia: entity.urgencia,
    estado: entity.estado,
    items: entity.items.map((item) => ({
      id: item.id,
      nombre: item.nombre,
      categoria: item.categoria,
      precioReferencia: item.precioReferencia,
      catalogProductId: item.catalogProductId,
    })),
  };
}

/**
 * PR5b (task 5b.1): the `200 ProveedorCompatibleDto[]` response for
 * `buscarProveedoresCompatibles`. Thin field-for-field conversion, same
 * shape `catalogo`'s own `ProviderCatalogItemResponseDto`-producing mapper
 * would build — this domain does not add, drop, or rename any field of
 * `ProviderCatalogItem` (`catalogo`'s vocabulary, D-C Decisión 2).
 */
export function toProveedorCompatibleDto(item: ProviderCatalogItem): ProveedorCompatibleDto {
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
