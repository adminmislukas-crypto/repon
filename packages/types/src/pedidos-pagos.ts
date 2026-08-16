export type OrderStatus =
  'expirado' | 'pendiente_pago' | 'confirmado' | 'preparando' | 'en_camino' | 'entregado';

export interface Order {
  id: string;
  offerId: string;
  userId: string;
  companyId: string;
  status: OrderStatus;
  total: number;
  /**
   * Copied by value from `offers.costoDespacho` at creation time
   * (design.md D-A.6) — `total` already includes it. Breaks the total down
   * so `OrderRepository.crear` can populate `orders.costo_despacho` without
   * a second parameter, mirroring `Offer.costoDespacho`'s own precedent.
   */
  costoDespacho: number;
}

export interface OrderItem {
  id: string;
  /**
   * Provenance only — see `order_items.offer_item_id` comment on column
   * (D-6). Never the source of price/description; those are copied onto
   * `OrderItem` at order-creation time.
   */
  offerItemId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  isAlt: boolean;
  altSize?: number;
  altQty?: number;
  altNote?: string;
}

export type PaymentStatus = 'pendiente' | 'pagado' | 'fallido' | 'reembolsado';

export interface Payment {
  id: string;
  orderId: string;
  /**
   * `CHECK IN ('webpay','mercadopago')` in the DB, not an enum here —
   * adding a gateway doesn't require changing this type.
   */
  gateway: string;
  externalTransactionId: string;
  monto: number;
  moneda: string;
  estado: PaymentStatus;
  paidAt?: string;
  // raw_payload is intentionally NOT exposed here: internal to core-api,
  // never travels to the client.
}
