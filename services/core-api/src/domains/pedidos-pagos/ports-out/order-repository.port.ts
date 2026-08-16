import type { Order, OrderItem, OrderStatus } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `pedidos-pagos/SPEC.md`, "Puertos de salida" — delta declarado (design.md
 * D-G.1): `SPEC.md` solo declara `save(order: Order)`, que no alcanza
 * porque `Order` no lleva `items`, así que no puede escribir `order_items`.
 * `PaymentGatewayPort`/`NotificationPort`/`EventPublisher`, también listados
 * en el bloque de ports-out de `SPEC.md`, son infraestructura del kernel
 * compartido y no se redeclaran acá (mismo patrón que la D17 de `ofertas`).
 */
export interface OrderRepository {
  /**
   * UN insert en `orders` + UN insert bulk en `order_items`. `tx`
   * REQUERIDO (precedente D-G.5 de `ofertas`): acá la atomicidad ES la
   * operación — un pedido sin líneas es un cobro sin detalle, y
   * `order_items` no admite `UPDATE` ni `DELETE` para arreglarlo después
   * (R6).
   */
  crear(order: Order, items: readonly OrderItem[], tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Order | null>;
  /** Idempotencia de R5: read-and-skip antes del insert. El índice único
   *  `orders_offer_id_uidx` es la red del TOCTOU. */
  findByOfferId(offerId: string, tx?: TransactionContext): Promise<Order | null>;
  /**
   * `UPDATE ... WHERE id = $1 AND status = $desde RETURNING id`. Devuelve
   * si ESTA sentencia movió la fila: el rowcount es la idempotencia, nunca
   * un `SELECT` previo (design.md Diagrama 3).
   */
  transicionar(
    orderId: string,
    desde: OrderStatus,
    hacia: OrderStatus,
    tx?: TransactionContext,
  ): Promise<boolean>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
