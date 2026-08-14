import type { ProviderCatalogItem, RefillItem } from '@repon/types';

/**
 * `design.md` D-B (Q2) — sync cross-domain query contract consumed by
 * `refill-matching`/`ofertas`. Lives in `contracts/`, not `ports-out/`:
 * per `core-api-hexagonal-layout`'s "Only contracts/ is importable across a
 * domain boundary", a domain-owned cross-domain interface (as opposed to a
 * kernel-declared one like `ActorPort`) declares its interface + token here;
 * the concrete implementation (`KyselyCatalogQueryAdapter`) lives in
 * `adapters/persistence/`, never exported from `contracts/` (D1).
 */

/** Tope defensivo por ítem solicitado. Subirlo es aditivo; introducirlo después, no. */
export const MAX_COINCIDENCIAS_POR_ITEM = 50;

/** Único error del contrato. `cause` preserva el error original del driver. */
export class CatalogQueryUnavailableError extends Error {
  constructor(message = 'El catálogo no pudo responder la consulta.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogQueryUnavailableError';
  }
}

/**
 * C1: deliberadamente sin `tx?` — a diferencia de todo método de todo
 * ports-out del repo (D-A de la fundación). Aceptar `tx?` invitaría a un
 * caller a enlistar esta lectura en su propia transacción, compartiendo
 * ciclo de vida transaccional entre dos dominios. La ausencia de `tx?` es la
 * señal estructural de que esto es `contracts/` y no `ports-out/`.
 *
 * C2: el caller NO debe invocar este método con una transacción abierta —
 * consecuencia directa de C1. El puerto toma su propia conexión del pool;
 * llamarlo desde adentro de un `runInTransaction` es la receta de un
 * auto-deadlock por agotamiento del pool.
 *
 * C3: solo lectura, sin efectos — prohibido cachear escribiendo, contar
 * invocaciones o mutar nada.
 *
 * C4: el filtro de visibilidad (D9/D-A) va adentro de la implementación.
 * Nunca devuelve ítems de una empresa oculta; el consumidor no tiene acceso
 * a la proyección para re-filtrar.
 *
 * C5: filtra `disponible = true`; NO filtra por `stock` — `RefillItem` no
 * tiene campo de cantidad, así que decidir "cuánto stock alcanza" es
 * responsabilidad del consumidor.
 *
 * C6: un solo round-trip para todo el array de `itemsSolicitados` — nunca N
 * queries para N ítems.
 *
 * C7: semántica de matching por ítem — `catalogProductId` presente ⇒ match
 * exacto por `provider_catalog.catalog_product_id`; ausente ⇒ `categoria`
 * exacta + `nombre` por trigram. Unión de todos los ítems, deduplicada por
 * `provider_catalog.id`, tope `MAX_COINCIDENCIAS_POR_ITEM` por ítem
 * solicitado. `companyId?` acota a un solo proveedor.
 *
 * C8: ante cualquier fallo de infraestructura, **lanza**
 * `CatalogQueryUnavailableError` — nunca devuelve `[]` degradado (D-B).
 * Quien lo exponga por HTTP debe mapear esto a 503 `CATALOG_UNAVAILABLE`.
 */
export interface CatalogQueryPort {
  buscarCoincidencias(
    itemsSolicitados: RefillItem[],
    companyId?: string,
  ): Promise<ProviderCatalogItem[]>;

  /**
   * design.md D-B (Q2) — segundo método, aditivo, needed only by `ofertas`'
   * `enviarOfertaProactiva`. `companyId` va **primero** porque es el alcance
   * obligatorio de toda la consulta (a diferencia del `companyId?` de
   * `buscarCoincidencias`, que va último por ser un estrechamiento
   * opcional). Hereda C1-C6 y C8 término a término; C7 no aplica (no hay
   * matching difuso, es igualdad por PK).
   *
   * C9 — DESCARTE SILENCIOSO: un id que no existe, que pertenece a otra
   * empresa, que está `disponible = false` o cuya empresa está oculta, NO
   * aparece en el resultado y NO lanza. El caller compara cardinalidades.
   * C10 — sin tope propio: el resultado está acotado por `ids.length` (la
   * consulta es por PK). `MAX_COINCIDENCIAS_POR_ITEM` NO aplica acá: existe
   * para acotar una expansión trigram difusa, y acá no hay ninguna.
   */
  obtenerItemsDeProveedor(
    companyId: string,
    ids: readonly string[],
  ): Promise<ProviderCatalogItem[]>;
}

export const CATALOG_QUERY_PORT = Symbol('CATALOG_QUERY_PORT');
