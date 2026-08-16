import { randomUUID } from 'node:crypto';
import type { Order, OrderItem, OrderStatus } from '@repon/types';
import { PedidoInvalidoError, TransicionInvalidaError } from './pedido.errors';

// ============================================================
// crearPedidoPendiente (tasks.md 2.1/2.2, design.md D-B.4/D-F Diagrama 1)
// ============================================================

/**
 * Forma local de una línea del payload extendido de `OfertaAceptada`
 * (design.md D-B.4). Deliberadamente NO importa nada de `ofertas` — el
 * listener (Fase 4) redeclara su propia interfaz de payload y la mapea a
 * esta forma antes de llamar a esta factory (D3: nunca la clase de evento
 * de `ofertas`, solo su forma).
 */
export interface NuevaLineaPedido {
  readonly offerItemId: string;
  readonly nombre: string;
  readonly precio: number;
  readonly isAlt: boolean;
  readonly altSize?: number;
  readonly altQty?: number;
  readonly altNote?: string;
}

export interface CrearPedidoPendienteInput {
  readonly offerId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly total: number;
  readonly costoDespacho: number;
  readonly lineas: readonly NuevaLineaPedido[];
}

/**
 * Una fila de `offer_items` ES una línea cotizada, y `offer_items.precio`
 * es el precio TOTAL de esa línea, no un unitario (design.md D-B.3,
 * verificado contra `offer.entity.ts`'s `total()`: suma `item.precio`
 * directo). `cantidad = 1` hace que `precio_unitario = subtotal =
 * linea.precio` se cumpla trivialmente y siempre — NUNCA se llena con
 * `altQty`, que ya se copia a su propia columna con un significado
 * distinto ("cuántas unidades de la presentación alternativa", no
 * "cuántas líneas").
 */
export const CANTIDAD_LINEA = 1;

/**
 * Toma el payload extendido de `OfertaAceptada` y produce, en memoria, el
 * `Order`/`OrderItem[]` que `crearPedidoDesdeOferta` (Fase 4) insertará en
 * una sola transacción. `status: 'pendiente_pago'` por construcción —
 * único estado inicial legal (design.md D-A.2), nunca se apoya en un
 * default de columna (el batch `17b` lo dropea a propósito, D-A.4).
 *
 * Función PURA: sin I/O, nunca muta su input. Valida el invariante del
 * total ANTES de devolver nada — `order_items` no admite `UPDATE` ni
 * `DELETE` para corregirlo después (R6), así que un payload incoherente
 * debe fallar acá, no en el insert.
 */
export function crearPedidoPendiente(input: CrearPedidoPendienteInput): {
  order: Order;
  items: readonly OrderItem[];
} {
  const items: OrderItem[] = input.lineas.map((linea) => ({
    id: randomUUID(),
    offerItemId: linea.offerItemId,
    nombre: linea.nombre,
    cantidad: CANTIDAD_LINEA,
    precioUnitario: linea.precio,
    subtotal: linea.precio,
    isAlt: linea.isAlt,
    altSize: linea.altSize,
    altQty: linea.altQty,
    altNote: linea.altNote,
  }));

  assertTotalCoherente(input.total, items, input.costoDespacho);

  const order: Order = {
    id: randomUUID(),
    offerId: input.offerId,
    userId: input.userId,
    companyId: input.companyId,
    status: 'pendiente_pago',
    total: input.total,
    costoDespacho: input.costoDespacho,
  };

  return { order, items };
}

function assertTotalCoherente(
  total: number,
  items: readonly OrderItem[],
  costoDespacho: number,
): void {
  const sumaSubtotales = items.reduce((suma, item) => suma + item.subtotal, 0);
  const esperado = sumaSubtotales + costoDespacho;
  if (total !== esperado) {
    throw new PedidoInvalidoError(
      `El total declarado (${total}) no coincide con la suma de las líneas más el despacho (${esperado}).`,
    );
  }
}

// ============================================================
// Máquina de estados de OrderStatus (tasks.md 2.3, design.md D-A.2)
// ============================================================

/**
 * La tabla completa de `design.md` D-A.2. Función caller-agnóstica a
 * propósito: no sabe si la llama `actualizarEstadoPedido` (proveedor) o el
 * camino de confirmación de pago — esa distinción la impone el DTO de
 * `actualizarEstadoPedido`, que ya rechaza `'confirmado'`/`'pendiente_pago'`/
 * `'expirado'` como destino ANTES de llegar acá (design.md D-E: 400 antes
 * que 409). Esta tabla es la única fuente de verdad sobre qué transición es
 * legal; el repositorio (Fase 3) ejecuta el `UPDATE ... WHERE status =
 * $desde RETURNING id` que la hace efectiva y atómica.
 */
const TRANSICIONES: ReadonlyMap<OrderStatus, readonly OrderStatus[]> = new Map([
  ['pendiente_pago', ['confirmado', 'expirado']],
  ['confirmado', ['preparando']],
  ['preparando', ['en_camino']],
  ['en_camino', ['entregado']],
  ['entregado', []],
  ['expirado', []],
]);

export function esTransicionValida(desde: OrderStatus, hacia: OrderStatus): boolean {
  return (TRANSICIONES.get(desde) ?? []).includes(hacia);
}

/**
 * Función PURA: valida y devuelve el estado destino, o lanza
 * `TransicionInvalidaError` (409, design.md D-E) — nunca muta nada, no hay
 * nada que mutar (a diferencia de `ofertas`' `aceptar(offer)`, esta función
 * no recibe ni devuelve un `Order` completo porque la escritura atómica
 * vive en el repositorio, no acá).
 */
export function transicionar(desde: OrderStatus, hacia: OrderStatus): OrderStatus {
  if (!esTransicionValida(desde, hacia)) {
    throw new TransicionInvalidaError(
      `No se puede transicionar el pedido de '${desde}' a '${hacia}'.`,
    );
  }
  return hacia;
}
