import type { PaymentStatus } from '@repon/types';

/**
 * design.md's DI token table — shared infra, used only by `pedidos-pagos`
 * (`core-api/SPEC.md`, "Pasarela de pago" → Webpay/MercadoPago). Interface
 * + token only (task 3.9); the real gateway adapter is `pedidos-pagos`'s job.
 */
export interface PaymentGatewayPort {
  crearTransaccion(orderId: string, monto: number): Promise<{ checkoutUrl: string }>;
  verificarPago(transactionId: string): Promise<PaymentStatus>;
}

export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');
