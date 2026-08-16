import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { Payment, PaymentStatus } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { PaymentRepository } from '../../ports-out/payment-repository.port';

/**
 * `KyselyPaymentRepository`'s Kysely-backed implementation (design.md
 * D-G.1/D-G.3, tasks.md Phase 2 / PR3, C5). Primera implementación de
 * `raw_payload` (jsonb) del repo: se lee como objeto ya parseado por el
 * driver, se escribe como `string` vía `JSON.stringify` — la asimetría que
 * `Generated<ColumnType<unknown, string, string>>` hace visible en
 * `schema.ts`. `raw_payload` NUNCA sale de este archivo: no está en
 * `Payment` de `@repon/types` y no debe estarlo.
 */

type Executor = Kysely<DB> | Transaction<DB>;

// ============================================================
// Row -> domain mapper. `monto` es `numeric(12,2)` -> STRING, siempre
// seguro con `Number(...)` directo (NOT NULL). `paid_at` ES nullable:
// `row.paid_at ?? undefined`, NUNCA `new Date(row.paid_at)` (que daría la
// época sobre `null`) — design.md D-G.3's callout explícito.
// ============================================================

interface PaymentRow {
  id: string;
  order_id: string;
  gateway: string;
  external_transaction_id: string;
  monto: string;
  moneda: string;
  estado: PaymentStatus;
  paid_at: string | null;
}

const PAYMENT_SELECT = [
  'id',
  'order_id',
  'gateway',
  'external_transaction_id',
  'monto',
  'moneda',
  'estado',
  'paid_at',
] as const;

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
    gateway: row.gateway,
    externalTransactionId: row.external_transaction_id,
    monto: Number(row.monto),
    moneda: row.moneda,
    estado: row.estado,
    paidAt: row.paid_at ?? undefined,
  };
}

function toPaymentRowValues(payment: Payment) {
  return {
    id: payment.id,
    order_id: payment.orderId,
    gateway: payment.gateway,
    external_transaction_id: payment.externalTransactionId,
    monto: payment.monto.toFixed(2),
    moneda: payment.moneda,
    // SIEMPRE explícito, mismo criterio que orders.status: `crear` nunca se
    // apoya en el default 'pendiente' de la columna. `raw_payload` también
    // explícito en vez de confiar en su default: `'{}'` hasta que
    // `marcarResultado` (Fase 7b) lo reemplace con el cuerpo real.
    estado: payment.estado,
    raw_payload: '{}',
  };
}

@Injectable()
export class KyselyPaymentRepository implements PaymentRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext): Executor {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * UNA sentencia: no hay transacción, no hay nada que hacer atómico
   * (design.md D-G.2 — `iniciarPago` no abre `runInTransaction`, la
   * llamada a la pasarela ya resolvió fuera de toda transacción antes de
   * llegar acá).
   */
  async crear(payment: Payment, tx?: TransactionContext): Promise<void> {
    await this.executor(tx).insertInto('payments').values(toPaymentRowValues(payment)).execute();
  }

  /** Clave natural de idempotencia del webhook (índice único compuesto
   *  `payments_gateway_external_txn_uidx`, design.md D-A.3). */
  async findByExternalTransactionId(
    gateway: string,
    externalTransactionId: string,
    tx?: TransactionContext,
  ): Promise<Payment | null> {
    const row = await this.executor(tx)
      .selectFrom('payments')
      .select(PAYMENT_SELECT)
      .where('gateway', '=', gateway)
      .where('external_transaction_id', '=', externalTransactionId)
      .executeTakeFirst();

    return row ? toPayment(row) : null;
  }

  /** El intento más reciente por `created_at desc` — lo que lee
   *  `GET /pedidos/:orderId/pago` (design.md D-E). */
  async findUltimoPorPedido(orderId: string, tx?: TransactionContext): Promise<Payment | null> {
    const row = await this.executor(tx)
      .selectFrom('payments')
      .select(PAYMENT_SELECT)
      .where('order_id', '=', orderId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row ? toPayment(row) : null;
  }

  /**
   * `UPDATE ... WHERE id = $1 AND estado <> $estado RETURNING id`. El
   * rowcount ES la idempotencia (design.md Diagrama 3, R4) — dos entregas
   * del mismo webhook dejan el sistema en el mismo estado y publican el
   * evento una sola vez, sin un `SELECT` previo. `rawPayload` se
   * serializa con `JSON.stringify` acá y NUNCA sale de este archivo.
   */
  async marcarResultado(
    paymentId: string,
    estado: PaymentStatus,
    rawPayload: unknown,
    tx: TransactionContext,
  ): Promise<boolean> {
    const rows = await toKyselyTransaction(tx)
      .updateTable('payments')
      .set({
        estado,
        raw_payload: JSON.stringify(rawPayload),
        // Solo se toca en el camino exitoso — un intento fallido no debe
        // pisar un `paid_at` de un intento anterior con `null` (la clave de
        // idempotencia `payments_gateway_external_txn_uidx` es por fila,
        // pero `paid_at` es semánticamente "cuándo se pagó ESTE intento").
        ...(estado === 'pagado' ? { paid_at: new Date().toISOString() } : {}),
      })
      .where('id', '=', paymentId)
      .where('estado', '<>', estado)
      .returning('id')
      .execute();

    return rows.length > 0;
  }
}
