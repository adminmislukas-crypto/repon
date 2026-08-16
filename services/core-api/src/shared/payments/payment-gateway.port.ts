import type { PaymentStatus } from '@repon/types';

/**
 * design.md's DI token table — shared infra, used only by `pedidos-pagos`
 * (`core-api/SPEC.md`, "Pasarela de pago" → Webpay/MercadoPago). Interface
 * + token only (task 3.9); the real gateway adapter is `pedidos-pagos`'s job.
 *
 * `crearTransaccion` ensanchado (design.md D-C.3, backend-core-api-pedidos-
 * pagos PR5): `payments.external_transaction_id` es `NOT NULL`, y la forma
 * original (`{ checkoutUrl }` solo) no lo devolvía — con el puerto de
 * entonces la fila de `payments` era inescribible. Delta aditivo en el tipo
 * de retorno; el puerto no tenía ningún implementador todavía.
 */
export interface PaymentGatewayPort {
  crearTransaccion(
    orderId: string,
    monto: number,
  ): Promise<{ checkoutUrl: string; externalTransactionId: string }>;
  verificarPago(transactionId: string): Promise<PaymentStatus>;
}

export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');
