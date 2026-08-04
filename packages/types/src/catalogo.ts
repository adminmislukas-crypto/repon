export type CatalogProductStatus = 'activo' | 'inactivo';

/**
 * `status` is not filtered out of this type: `'inactivo'` remains a valid,
 * visible value. This is not a soft-delete hidden from an authenticated
 * client (Q6, `db-schema-catalogo`).
 */
export interface CatalogProduct {
  id: string;
  nombre: string;
  categoria: string;
  marca?: string;
  presentacion?: string;
  imagenUrl?: string;
  status: CatalogProductStatus;
}

export interface ProviderCatalogItem {
  id: string;
  companyId: string;
  /**
   * Optional by design (Q4, `db-schema-catalogo`): a provider can load a
   * product that doesn't match anything in `catalog_products`, using
   * `nombre`/`categoria` for matching instead — never forced to `NOT NULL`.
   */
  catalogProductId?: string;
  nombre: string;
  categoria: string;
  precioBase: number;
  precioMaximo: number;
  stock: number;
  disponible: boolean;
  imagenUrl?: string;
}
