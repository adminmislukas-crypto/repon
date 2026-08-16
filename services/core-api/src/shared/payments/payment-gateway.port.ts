import type { PaymentStatus } from '@repon/types';

/**
 * design.md's DI token table — shared infra, used only by `pedidos-pagos`
 * (`core-api/SPEC.md`, "Pasarela de pago" → Webpay/MercadoPago). Interface
 * + token only (task 3.9); the real gateway adapter is `pedidos-pagos`'s job.
 *
 * `crearTransaccion` ensanchado dos veces, ambas aditivas sobre el tipo de
 * retorno, el puerto sin implementadores en ninguna de las dos:
 * `externalTransactionId` (design.md D-C.3, PR5 — `payments.external_
 * transaction_id` es `NOT NULL`, y la forma original `{ checkoutUrl }` solo
 * no lo devolvía). `gateway` (PR6, hueco que ninguna Q/D nombró): `Payment.
 * gateway` también es `NOT NULL` y `IniciarPagoUseCase` no tenía de dónde
 * sacarlo — la pasarela concreta (Fase 7a) es quien sabe cuál es, nunca un
 * valor fijo en el caso de uso, porque `payments.gateway` ya está diseñado
 * (`CHECK`, no enum) para que convivan varias.
 */
export interface PaymentGatewayPort {
  crearTransaccion(
    orderId: string,
    monto: number,
  ): Promise<{ checkoutUrl: string; externalTransactionId: string; gateway: string }>;
  verificarPago(transactionId: string): Promise<PaymentStatus>;
}

export const PAYMENT_GATEWAY_PORT = Symbol('PAYMENT_GATEWAY_PORT');
