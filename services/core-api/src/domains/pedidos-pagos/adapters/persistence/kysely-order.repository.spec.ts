import type { Kysely } from 'kysely';
import { DatabaseError } from 'pg';
import type { Order, OrderItem } from '@repon/types';
import type { DB } from '../../../../shared/database/schema';
import type { TransactionContext } from '../../../../shared/database/transaction';
import { PedidoYaExisteError } from '../../domain/pedido.errors';
import { KyselyOrderRepository } from './kysely-order.repository';

// design.md's "El gotcha de numeric sigue vigente" callout, extendido acá:
// total/costo_despacho (orders), cantidad/precio_unitario/subtotal
// (order_items) son numeric -> STRING desde el driver. alt_size/alt_qty SON
// nullable: `Number(null) === 0` reintroduciría el mismo centinela que
// `ofertas`' PR3a ya rechazó — probado explícitamente en ambas direcciones.

const UNUSED_DB = {} as unknown as Kysely<DB>;

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    offerId: 'offer-1',
    userId: 'user-1',
    companyId: 'company-1',
    status: 'pendiente_pago',
    total: 14990,
    costoDespacho: 2000,
    ...overrides,
  };
}

function orderItemFixture(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    offerItemId: 'offer-item-1',
    nombre: 'Agua 20L',
    cantidad: 1,
    precioUnitario: 12990,
    subtotal: 12990,
    isAlt: false,
    ...overrides,
  };
}

// ============================================================
// crear() mock harness (tasks.md 3.1) — 2 inserts en la misma "transacción"
// (acá, el mismo objeto db mockeado hace de `toKyselyTransaction(tx)`).
// ============================================================

function fakeUniqueViolation(constraint: string): DatabaseError {
  const error = new DatabaseError('duplicate key value violates unique constraint', 0, 'error');
  error.code = '23505';
  error.constraint = constraint;
  return error;
}

function buildCrearDb(rejectOrdersInsertWith?: unknown) {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };

  const ordersInsertChain: Record<string, jest.Mock> = {};
  ordersInsertChain.values = jest.fn((...args: unknown[]) => {
    record('ordersInsertValues', args);
    return ordersInsertChain;
  });
  ordersInsertChain.execute = jest.fn(async () => {
    if (rejectOrdersInsertWith !== undefined) {
      throw rejectOrdersInsertWith;
    }
    return undefined;
  });

  const itemsInsertChain: Record<string, jest.Mock> = {};
  itemsInsertChain.values = jest.fn((...args: unknown[]) => {
    record('itemsInsertValues', args);
    return itemsInsertChain;
  });
  itemsInsertChain.execute = jest.fn(async () => undefined);

  const insertInto = jest.fn((table: string) => {
    record('insertInto', [table]);
    return table === 'orders' ? ordersInsertChain : itemsInsertChain;
  });

  const db = { insertInto } as unknown as Kysely<DB>;
  return { db, calls, ordersInsertChain, itemsInsertChain, insertInto };
}

// ============================================================
// findById / findByOfferId mock harness (tasks.md 3.2) — 1 fila, sin join
// (Order no lleva items; los items se leen por su propio camino).
// ============================================================

interface OrderRow {
  id: string;
  offer_id: string;
  user_id: string;
  company_id: string;
  status: string;
  total: string;
  costo_despacho: string;
}

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    offer_id: 'offer-1',
    user_id: 'user-1',
    company_id: 'company-1',
    status: 'pendiente_pago',
    total: '14990.00',
    costo_despacho: '2000.00',
    ...overrides,
  };
}

function buildSelectDb(row: OrderRow | undefined) {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn((...args: unknown[]) => {
    record('select', args);
    return chain;
  });
  chain.where = jest.fn((...args: unknown[]) => {
    record('where', args);
    return chain;
  });
  chain.executeTakeFirst = jest.fn(async () => row);
  const selectFrom = jest.fn((...args: unknown[]) => {
    record('selectFrom', args);
    return chain;
  });
  const db = { selectFrom } as unknown as Kysely<DB>;
  return { db, calls, chain, selectFrom };
}

// ============================================================
// transicionar() mock harness (tasks.md 3.2, design.md Diagrama 3) —
// UPDATE ... WHERE status = $desde RETURNING id. El rowcount ES la
// idempotencia, nunca un SELECT previo.
// ============================================================

function buildTransicionarDb(returningRows: { id: string }[]) {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn((...args: unknown[]) => {
    record('set', args);
    return chain;
  });
  chain.where = jest.fn((...args: unknown[]) => {
    record('where', args);
    return chain;
  });
  chain.returning = jest.fn((...args: unknown[]) => {
    record('returning', args);
    return chain;
  });
  chain.execute = jest.fn(async () => returningRows);
  const updateTable = jest.fn((...args: unknown[]) => {
    record('updateTable', args);
    return chain;
  });
  const db = { updateTable } as unknown as Kysely<DB>;
  return { db, calls, chain, updateTable };
}

describe('KyselyOrderRepository', () => {
  describe('crear — 1 insert en orders + 1 insert bulk en order_items (tasks.md 3.1)', () => {
    // `tx: TransactionContext` es REQUERIDO (design.md D-G.1, mismo
    // precedente que `marcarAceptada` de `ofertas`): `crear` nunca toca
    // `this.db`, siempre `toKyselyTransaction(tx)` — el mock `db` de cada
    // harness se pasa como `tx`, nunca al constructor.
    it('inserts exactly ONE row into orders with status EXPLICIT', async () => {
      const { db, ordersInsertChain } = buildCrearDb();
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await repo.crear(
        orderFixture({ status: 'pendiente_pago' }),
        [orderItemFixture()],
        db as unknown as TransactionContext,
      );

      expect(ordersInsertChain.values).toHaveBeenCalledTimes(1);
      const [insertedValues] = ordersInsertChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(insertedValues).toHaveProperty('status', 'pendiente_pago');
    });

    it('bulk-inserts ALL items in ONE multi-row statement, never N round-trips', async () => {
      const { db, itemsInsertChain } = buildCrearDb();
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await repo.crear(
        orderFixture(),
        [orderItemFixture(), orderItemFixture({ id: 'item-2', offerItemId: 'offer-item-2' })],
        db as unknown as TransactionContext,
      );

      expect(itemsInsertChain.values).toHaveBeenCalledTimes(1);
      expect(itemsInsertChain.execute).toHaveBeenCalledTimes(1);
      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [unknown[]];
      expect(itemRows).toHaveLength(2);
    });

    it('formats total/costo_despacho and precio_unitario/subtotal into numeric-column string shape', async () => {
      const { db, ordersInsertChain, itemsInsertChain } = buildCrearDb();
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await repo.crear(
        orderFixture({ total: 14990, costoDespacho: 2000 }),
        [orderItemFixture({ precioUnitario: 12990, subtotal: 12990 })],
        db as unknown as TransactionContext,
      );

      const [orderRowValues] = ordersInsertChain.values.mock.calls[0] as [Record<string, unknown>];
      expect(orderRowValues).toMatchObject({ total: '14990.00', costo_despacho: '2000.00' });
      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({
        precio_unitario: '12990.00',
        subtotal: '12990.00',
        cantidad: '1',
      });
    });

    it('writes alt_size/alt_qty as NULL (never "0") when the item is not an alt presentation', async () => {
      const { db, itemsInsertChain } = buildCrearDb();
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await repo.crear(
        orderFixture(),
        [orderItemFixture({ altSize: undefined, altQty: undefined })],
        db as unknown as TransactionContext,
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ alt_size: null, alt_qty: null });
    });

    it('writes alt_size/alt_qty as numeric strings when the item carries them', async () => {
      const { db, itemsInsertChain } = buildCrearDb();
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await repo.crear(
        orderFixture(),
        [orderItemFixture({ isAlt: true, altSize: 25, altQty: 1, altNote: 'Saco 25kg' })],
        db as unknown as TransactionContext,
      );

      const [itemRows] = itemsInsertChain.values.mock.calls[0] as [Record<string, unknown>[]];
      expect(itemRows[0]).toMatchObject({ alt_size: '25', alt_qty: '1', alt_note: 'Saco 25kg' });
    });

    it('translates a 23505 on orders_offer_id_uidx to PedidoYaExisteError', async () => {
      const { db } = buildCrearDb(fakeUniqueViolation('orders_offer_id_uidx'));
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await expect(
        repo.crear(
          orderFixture({ offerId: 'offer-1' }),
          [orderItemFixture()],
          db as unknown as TransactionContext,
        ),
      ).rejects.toThrow(PedidoYaExisteError);
    });

    it('re-throws any other driver error as-is', async () => {
      const otherError = new Error('connection reset');
      const { db } = buildCrearDb(otherError);
      const repo = new KyselyOrderRepository(UNUSED_DB);

      await expect(
        repo.crear(orderFixture(), [orderItemFixture()], db as unknown as TransactionContext),
      ).rejects.toBe(otherError);
    });
  });

  describe('findById / findByOfferId (tasks.md 3.2)', () => {
    it('findById returns null when no row matches', async () => {
      const { db } = buildSelectDb(undefined);
      const repo = new KyselyOrderRepository(db);

      await expect(repo.findById('missing')).resolves.toBeNull();
    });

    it('findById maps a found row into an Order, converting numeric strings to number', async () => {
      const { db } = buildSelectDb(orderRow({ total: '14990.00', costo_despacho: '2000.00' }));
      const repo = new KyselyOrderRepository(db);

      const order = await repo.findById('order-1');

      expect(order).toMatchObject({ id: 'order-1', total: 14990, costoDespacho: 2000 });
    });

    it('findByOfferId returns null when no order exists for that offer', async () => {
      const { db } = buildSelectDb(undefined);
      const repo = new KyselyOrderRepository(db);

      await expect(repo.findByOfferId('offer-x')).resolves.toBeNull();
    });

    it('findByOfferId maps a found row into an Order', async () => {
      const { db } = buildSelectDb(orderRow());
      const repo = new KyselyOrderRepository(db);

      const order = await repo.findByOfferId('offer-1');

      expect(order).toMatchObject({ id: 'order-1', offerId: 'offer-1' });
    });
  });

  describe('transicionar — UPDATE condicional, rowcount como idempotencia (tasks.md 3.2)', () => {
    it('returns true when the conditional UPDATE moved exactly one row', async () => {
      const { db, chain } = buildTransicionarDb([{ id: 'order-1' }]);
      const repo = new KyselyOrderRepository(db);

      const movida = await repo.transicionar('order-1', 'pendiente_pago', 'confirmado');

      expect(movida).toBe(true);
      expect(chain.set).toHaveBeenCalledWith({ status: 'confirmado' });
    });

    it('returns false when the row was already in the target-adjacent state (0 rows matched)', async () => {
      const { db } = buildTransicionarDb([]);
      const repo = new KyselyOrderRepository(db);

      const movida = await repo.transicionar('order-1', 'pendiente_pago', 'confirmado');

      expect(movida).toBe(false);
    });

    it('conditions the UPDATE on both id and the exact desde status, never a bare id match', async () => {
      const { db, chain } = buildTransicionarDb([{ id: 'order-1' }]);
      const repo = new KyselyOrderRepository(db);

      await repo.transicionar('order-1', 'confirmado', 'preparando');

      expect(chain.where).toHaveBeenCalledWith('id', '=', 'order-1');
      expect(chain.where).toHaveBeenCalledWith('status', '=', 'confirmado');
    });
  });
});
