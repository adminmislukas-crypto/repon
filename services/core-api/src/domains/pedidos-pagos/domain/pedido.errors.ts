/**
 * Domain-invariant violations for `pedidos-pagos` (design.md D-E's tabla de
 * errores, más `PedidoYaExisteError` de D-F Diagrama 1 — señal interna, no
 * mapeada a HTTP). Plain `Error` subclasses, zero framework imports
 * (`core-api-hexagonal-layout`: `domain/`/`ports-in/` MUST NOT import
 * HTTP-framework types) — `adapters/http/pedidos-pagos-exception.filter.ts`
 * (Phase 5+) maps each class to a status code.
 *
 * 5 de las 7 filas de la tabla de errores de D-E viven acá. Las otras 2 NO:
 * `PasarelaNoConfiguradaError` y `FirmaInvalidaError` viven en
 * `shared/payments/payments.errors.ts` (fases 4 y 6b respectivamente) —
 * ambas las lanza el ADAPTADOR de la pasarela (`interpretarWebhook` para la
 * segunda, D-C.3), nunca un caso de uso de este dominio, y se importan acá
 * sin redeclarar, mismo patrón que `CatalogQueryUnavailableError` en
 * `ofertas`.
 */

/**
 * Mapea a 404 `PEDIDO_NO_ENCONTRADO` (design.md D-E). Lanzado por
 * `iniciarPago`/`obtenerEstadoPago`/`actualizarEstadoPedido` cuando
 * `findById` devuelve `null` O devuelve un pedido cuyo dueño (usuario o
 * empresa, según la ruta) no es el actor — AMBAS ramas lanzan este mismo
 * error, construido igual (D4: byte-idéntico, nunca 403 — un 403
 * confirmaría la existencia del pedido a quien no es su dueño).
 */
export class PedidoNoEncontradoError extends Error {
  constructor(orderId: string) {
    super(`El pedido ${orderId} no existe o no pertenece al actor.`);
    this.name = 'PedidoNoEncontradoError';
  }
}

/**
 * Mapea a 409 `TRANSICION_INVALIDA` (design.md D-E, D-A.2). Lanzado por la
 * máquina de `OrderStatus` (Fase 2, `domain/order.entity.ts`) cuando la
 * transición no es adyacente, es hacia atrás, o el origen/destino es un
 * estado terminal (`entregado`/`expirado`) — incluye cualquier intento de
 * `actualizarEstadoPedido` de alcanzar `'confirmado'`, `'pendiente_pago'` o
 * `'expirado'`, los 3 inalcanzables por el proveedor.
 */
export class TransicionInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransicionInvalidaError';
  }
}

/**
 * Mapea a 409 `PEDIDO_NO_PAGABLE` (design.md D-E). Lanzado por `iniciarPago`
 * (Fase 5) cuando `order.status !== 'pendiente_pago'` — un pedido ya
 * confirmado, en curso, entregado o expirado no admite un nuevo intento de
 * pago.
 */
export class PedidoNoPagableError extends Error {
  constructor(orderId: string) {
    super(`El pedido ${orderId} no admite un nuevo intento de pago.`);
    this.name = 'PedidoNoPagableError';
  }
}

/**
 * Mapea a 404 `PAGO_NO_ENCONTRADO` (design.md D-E). Dos llamadores, mismo
 * significado ("no hay un pago que corresponda a lo pedido"), mensaje
 * propio en cada uno — mismo criterio que `TransicionInvalidaError`/
 * `PedidoInvalidoError` (constructor de mensaje libre, no de campos fijos):
 * (1) `obtenerEstadoPago` (Fase 5) cuando `findUltimoPorPedido` devuelve
 * `null` — el pedido existe y es del actor, pero nunca se llamó
 * `iniciarPago`, así que no hay nada que mostrar todavía. (2)
 * `procesarWebhookPago` (Fase 6b) cuando `findByExternalTransactionId`
 * devuelve `null` — un webhook para una transacción que este dominio no
 * conoce. **404 a propósito en (2)**: un no-2xx hace que la pasarela
 * reintente, y ese reintento es la red contra la carrera "webhook antes de
 * que commitee `iniciarPago`".
 */
export class PagoNoEncontradoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PagoNoEncontradoError';
  }
}

/**
 * Mapea a 400 `PEDIDO_INVALIDO` (design.md D-E). Lanzado por
 * `crearPedidoDesdeOferta` (Fase 4) ANTES de abrir la transacción, cuando
 * `orders.total !== Σ(order_items.subtotal) + orders.costo_despacho` —
 * validar antes del insert es obligatorio porque `order_items` no admite
 * `UPDATE` ni `DELETE`, ni para `service_role` (R6).
 */
export class PedidoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PedidoInvalidoError';
  }
}

/**
 * Señal interna, NUNCA mapeada a HTTP (design.md D-F, Diagrama 1). Lanzada
 * por `KyselyOrderRepository.crear` (Fase 3) cuando el driver reporta un
 * `23505` sobre `orders_offer_id_uidx` — el TOCTOU de dos entregas casi
 * simultáneas de `OfertaAceptada` para la misma oferta. `crearPedidoDesdeOferta`
 * (Fase 4) la captura y la trata como el MISMO resultado no-op que su propio
 * `findByOfferId` read-and-skip: cero escrituras adicionales, cero eventos.
 * Nunca llega al filtro de excepciones porque nunca sale del caso de uso.
 */
export class PedidoYaExisteError extends Error {
  constructor(offerId: string) {
    super(`Ya existe un pedido para la oferta ${offerId}.`);
    this.name = 'PedidoYaExisteError';
  }
}
