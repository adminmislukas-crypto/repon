import { Inject, Injectable } from '@nestjs/common';
import type { CatalogProduct } from '@repon/types';
import {
  CATALOG_PRODUCT_REPOSITORY,
  type CatalogProductRepository,
} from '../ports-out/catalog-product-repository.port';

/**
 * core-api-catalogo spec, "buscarProductos reads the shared reference
 * catalog, with no company dimension": a pure passthrough to
 * `CatalogProductRepository.buscar` — `catalog_products` has no
 * `company_id` column, so there is nothing to scope beyond the search term
 * + optional `categoria`, and no `companyStatus` gate (design.md D-E:
 * "buscarProductos no lo recibe").
 */
@Injectable()
export class BuscarProductosUseCase {
  constructor(
    @Inject(CATALOG_PRODUCT_REPOSITORY)
    private readonly catalogProductRepository: CatalogProductRepository,
  ) {}

  async execute(query: string, categoria?: string): Promise<CatalogProduct[]> {
    return this.catalogProductRepository.buscar(query, categoria);
  }
}
