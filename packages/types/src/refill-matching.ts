export interface RefillRequest {
  id: string;
  userId: string;
  items: RefillItem[];
  direccion: string;
  /**
   * Always required (Q2, `db-schema-refill-matching`): a structured join
   * key for dispatch-zone matching, kept separate from `direccion` (free
   * text) — neither the matching Edge Function nor RLS can operate on an
   * unstructured address.
   */
  comuna: string;
  urgencia: 'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias';
  estado: 'abierta' | 'ofertada' | 'confirmada';
}

export interface RefillItem {
  id: string;
  nombre: string;
  categoria: string;
  precioReferencia: number;
  /**
   * Optional by design (Q4, `db-schema-refill-matching`): a user can
   * request a product that isn't in `catalog_products`.
   */
  catalogProductId?: string;
}
