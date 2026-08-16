import type { Payment, PaymentStatus } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * Puerto nuevo, no declarado en `pedidos-pagos/SPEC.md` (delta C5): `SPEC.md`
 * solo listaba `OrderRepository`, pero `payments` es una tabla propia, con
 * estado propio y sin lectura directa de cliente — necesita su propio
 * puerto (design.md D-G.1).
 */
export interface PaymentRepository {
  crear(payment: Payment, tx?: TransactionContext): Promise<void>;
  /** Clave natural de idempotencia del webhook (índice único compuesto
   *  `payments_gateway_external_txn_uidx`, design.md D-A.3). */
  findByExternalTransactionId(
    gateway: string,
    externalTransactionId: string,
    tx?: TransactionContext,
  ): Promise<Payment | null>;
  /** El intento más reciente por `created_at desc` — lo que lee
   *  `GET /pedidos/:orderId/pago`. */
  findUltimoPorPedido(orderId: string, tx?: TransactionContext): Promise<Payment | null>;
  /**
   * `UPDATE ... WHERE id = $1 AND estado <> $estado RETURNING id`, rowcount
   * como idempotencia. `rawPayload` se escribe ACÁ y nunca sale de este
   * dominio (design.md D-G.3's `jsonb` gotcha).
   */
  marcarResultado(
    paymentId: string,
    estado: PaymentStatus,
    rawPayload: unknown,
    tx: TransactionContext,
  ): Promise<boolean>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
