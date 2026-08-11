// design.md D-B (Q2)/D-D.2 (backend-core-api-refill-matching) — the exact
// shapes below, copied verbatim from design.md, not improvised. Read the
// "Desviación declarada" section before touching `RefillItemBorrador`.

/** D11: hoy es una unión inline dentro de RefillRequest. Se promueve a tipo
 *  nombrado porque `crearSolicitud` la recibe como parámetro y los eventos la
 *  publican — es vocabulario DE ESTE dominio (consumo se niega, con razón, a
 *  publicarla en sus propios payloads). */
export type Urgencia = 'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias';

/** D3/D11. 'borrador' va primero, en el mismo orden que el enum de Postgres
 *  después del batch 14 (design.md D-A) — el tipo y el enum se leen igual. */
export type RefillEstado = 'borrador' | 'abierta' | 'ofertada' | 'confirmada';

/** Los 3 estados en los que la solicitud está completa y es matchable.
 *  `Exclude<>` y no una segunda lista literal: una sola fuente de verdad, y
 *  agregar un 5º estado obliga a decidir de qué lado cae. */
export type RefillEstadoActivo = Exclude<RefillEstado, 'borrador'>;

interface RefillItemCommon {
  id: string;
  nombre: string;
  /** Opcional por diseño (Q4, `db-schema-refill-matching`): el usuario puede
   *  pedir un producto que no está en `catalog_products`. */
  catalogProductId?: string;
}

/**
 * Ítem COMPLETO — el único que el matching acepta. Su forma es byte a byte la
 * de hoy, a propósito: `CatalogQueryPort.buscarCoincidencias(itemsSolicitados:
 * RefillItem[])` está congelado (C1–C8) y `catalogo` no se toca en este cambio.
 */
export interface RefillItem extends RefillItemCommon {
  categoria: string;
  precioReferencia: number;
}

/**
 * Ítem de una solicitud en 'borrador' (D3/D4). `categoria`/`precioReferencia`
 * son OPCIONALES, no `?: never`: la columna es nullable y sin CHECK, así que
 * la fila puede legalmente llevar valor, y un tipo incapaz de representar una
 * fila legal obliga al mapper a perder datos en silencio. `?: never` se
 * reserva para exclusividad estructural real — ver abajo.
 * `RefillItem` SÍ es asignable a este tipo (un ítem completo es un borrador
 * válido); la dirección peligrosa está bloqueada.
 */
export interface RefillItemBorrador extends RefillItemCommon {
  categoria?: string;
  precioReferencia?: number;
}

interface RefillRequestCommon {
  id: string;
  userId: string;
  urgencia: Urgencia;
  /** Clave de correlación hacia `consumo` (design.md D-D). Presente solo en
   *  las solicitudes nacidas de `RefillAutoSolicitado`; sobrevive a la
   *  transición a 'abierta', por eso vive acá y no en la variante borrador. */
  consumptionId?: string;
}

export type RefillRequestBorrador = RefillRequestCommon & {
  estado: 'borrador';
  items: RefillItemBorrador[];
  direccion?: string;
  comuna?: string;
};

export type RefillRequestActiva = RefillRequestCommon & {
  estado: RefillEstadoActivo;
  items: RefillItem[];
  direccion: string;
  comuna: string;
};

/**
 * Discriminada sobre `estado`, mismo patrón que `Offer` sobre `kind`:
 * interfaz `Common` + variantes por intersección + el array hijo estrechado
 * por variante (`items: RefillItemReactiva[]` allá, `items: RefillItem[]`
 * acá). `if (r.estado === 'borrador')` narrowea a la variante borrador; el
 * `else` narrowea a la activa, y ahí `direccion`/`comuna` son `string` y
 * `items` es `RefillItem[]` — sin un solo `!` ni cast en todo el dominio.
 */
export type RefillRequest = RefillRequestBorrador | RefillRequestActiva;

/**
 * D11. Entrada de `crearSolicitud`, sin `id` (lo genera el caso de uso con
 * `randomUUID()`, precedente uniforme del repo). Los campos son REQUERIDOS:
 * la ruta manual nace 'abierta' y 'abierta' exige completitud (D12). El
 * camino del borrador no tiene entrada del cliente en absoluto — lo arma el
 * listener desde `StockBajoPayload`. Sin decoradores de validación: eso vive
 * en el DTO de `adapters/http/`, igual que `NuevoProductoProveedor`.
 */
export interface NuevoRefillItem {
  nombre: string;
  categoria: string;
  precioReferencia: number;
  catalogProductId?: string;
}

// Desviación declarada (design.md D-B): `?: never` NO se usa en esta unión,
// a diferencia de `Offer`/`OfferItem`. En `Offer`, `refillRequestId?: never`
// expresa un error de categoría: una oferta proactiva nunca, en ningún
// estado del mundo, tiene solicitud de origen. Un borrador sin dirección no
// es un error de categoría: es un dato que todavía no se conoce — la
// columna es nullable y sin CHECK, Postgres acepta un borrador con
// dirección. `?: never` haría que el mapper de persistencia no pueda
// representar una fila legal. La unión sigue siendo segura sin `?: never`:
// el discriminante `estado` ya bloquea las dos direcciones.
