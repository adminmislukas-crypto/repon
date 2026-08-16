import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { DatabaseError } from 'pg';
import type { Order, OrderItem, OrderStatus } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import { PedidoYaExisteError } from '../../domain/pedido.errors';
import type { OrderRepository } from '../../ports-out/order-repository.port';

/**
 * `KyselyOrderRepository`'s Kysely-backed implementation (design.md D-G.1,
 * tasks.md Phase 2 / PR3). One file across the 4 `OrderRepository` methods
 * — mismo criterio "un archivo por repositorio de dominio" que
 * `KyselyOfferRepository`.
 */

type Executor = Kysely<DB> | Transaction<DB>;

// ============================================================
// Row -> domain mappers (design.md's "El gotcha de numeric sigue vigente"
// callout). `total`/`costo_despacho` son `numeric(12,2)` -> STRING desde el
// driver, siempre seguros de convertir con `Number(...)` directo (nunca
// nullable).
// ============================================================

interface OrderRow {
  id: string;
  offer_id: string;
  user_id: string;
  company_id: string;
  status: OrderStatus;
  total: string;
  costo_despacho: string;
}

const ORDER_SELECT = [
  'id',
  'offer_id',
  'user_id',
  'company_id',
  'status',
  'total',
  'costo_despacho',
] as const;

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    companyId: row.company_id,
    status: row.status,
    total: Number(row.total),
    costoDespacho: Number(row.costo_despacho),
  };
}

// ============================================================
// Domain -> row mappers (el lado de escritura del mismo gotcha).
// `alt_size`/`alt_qty` `undefined` DEBE aterrizar en Postgres como `NULL`,
// nunca como un `"0"` stringificado (mismo riesgo que `ofertas`' PR3a).
// ============================================================

function toOrderRowValues(order: Order) {
  return {
    id: order.id,
    offer_id: order.offerId,
    user_id: order.userId,
    company_id: order.companyId,
    // SIEMPRE explícito (design.md D-A.4): la columna perdió su default a
    // propósito, olvidarla es ahora un error de compilación además de un
    // NOT NULL en la base.
    status: order.status,
    total: order.total.toFixed(2),
    costo_despacho: order.costoDespacho.toFixed(2),
  };
}

function toOrderItemRowValues(orderId: string, item: OrderItem) {
  return {
    id: item.id,
    order_id: orderId,
    offer_item_id: item.offerItemId,
    nombre: item.nombre,
    // Siempre '1' (design.md D-B.3, CANTIDAD_LINEA) — el dominio ya lo
    // garantiza, el adaptador solo lo serializa como numeric string.
    cantidad: item.cantidad.toString(),
    precio_unitario: item.precioUnitario.toFixed(2),
    subtotal: item.subtotal.toFixed(2),
    is_alt: item.isAlt,
    alt_size: item.altSize === undefined ? null : item.altSize.toString(),
    alt_qty: item.altQty === undefined ? null : item.altQty.toString(),
    alt_note: item.altNote ?? null,
  };
}

@Injectable()
export class KyselyOrderRepository implements OrderRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext): Executor {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * `tx` REQUERIDO (design.md D-G.1/D-G.5): la atomicidad ES la operación
   * — un pedido sin sus líneas es un cobro sin detalle, y `order_items` no
   * admite `UPDATE` ni `DELETE` para corregirlo después (R6). Un INSERT en
   * `orders` + un INSERT bulk multi-fila en `order_items`, nunca N+1.
   *
   * La violación del índice único `orders_offer_id_uidx` se traduce acá,
   * en el adaptador, nunca en el caso de uso (mismo patrón que
   * `KyselyOfferRepository.marcarAceptada` con `OfertaYaAceptadaError`) —
   * un `code` de Postgres es vocabulario de infraestructura que
   * `ports-in/` no debe conocer. Cualquier otro error del driver se
   * re-lanza tal cual (mapea a 500).
   */
  async crear(order: Order, items: readonly OrderItem[], tx: TransactionContext): Promise<void> {
    const executor = toKyselyTransaction(tx);

    try {
      await executor.insertInto('orders').values(toOrderRowValues(order)).execute();
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.code === '23505' &&
        error.constraint === 'orders_offer_id_uidx'
      ) {
        throw new PedidoYaExisteError(order.offerId);
      }
      throw error;
    }

    const itemRows = items.map((item) => toOrderItemRowValues(order.id, item));
    if (itemRows.length > 0) {
      await executor.insertInto('order_items').values(itemRows).execute();
    }
  }

  async findById(id: string, tx?: TransactionContext): Promise<Order | null> {
    const row = await this.executor(tx)
      .selectFrom('orders')
      .select(ORDER_SELECT)
      .where('id', '=', id)
      .executeTakeFirst();

    return row ? toOrder(row) : null;
  }

  /** Idempotencia de R5: read-and-skip antes del insert en `crearPedidoDesdeOferta`
   *  (Fase 4). El índice único `orders_offer_id_uidx` es la red del TOCTOU. */
  async findByOfferId(offerId: string, tx?: TransactionContext): Promise<Order | null> {
    const row = await this.executor(tx)
      .selectFrom('orders')
      .select(ORDER_SELECT)
      .where('offer_id', '=', offerId)
      .executeTakeFirst();

    return row ? toOrder(row) : null;
  }

  /**
   * `UPDATE ... WHERE id = $1 AND status = $desde RETURNING id` (design.md
   * Diagrama 3). El rowcount ES la idempotencia — nunca un `SELECT` previo:
   * 0 filas significa que otra ejecución ya movió el pedido, o que el
   * estado de origen no coincidía, y ambos casos son indistinguibles (y no
   * necesitan serlo) para el caso de uso.
   */
  async transicionar(
    orderId: string,
    desde: OrderStatus,
    hacia: OrderStatus,
    tx?: TransactionContext,
  ): Promise<boolean> {
    const rows = await this.executor(tx)
      .updateTable('orders')
      .set({ status: hacia })
      .where('id', '=', orderId)
      .where('status', '=', desde)
      .returning('id')
      .execute();

    return rows.length > 0;
  }
}
