import type { Kysely } from 'kysely';
import type { Payment } from '@repon/types';
import type { DB } from '../../../../shared/database/schema';
import { KyselyPaymentRepository } from './kysely-payment.repository';

// design.md D-G.3's gotcha NUEVO: `raw_payload` se lee como objeto ya
// parseado por el driver y se escribe como `string` (`JSON.stringify`).
// Probado explícitamente en ambas direcciones en este archivo — primera
// columna jsonb del repo, sin precedente previo que copiar.

const UNUSED_DB = {} as unknown as Kysely<DB>;

function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    orderId: 'order-1',
    gateway: 'webpay',
    externalTransactionId: 'txn-1',
    monto: 14990,
    moneda: 'CLP',
    estado: 'pendiente',
    ...overrides,
  };
}

// ============================================================
// crear() mock harness (tasks.md 3.4)
// ============================================================

function buildCrearDb() {
  const calls: Record<string, unknown[][]> = {};
  const record = (method: string, args: unknown[]) => {
    (calls[method] ??= []).push(args);
  };
  const chain: Record<string, jest.Mock> = {};
  chain.values = jest.fn((...args: unknown[]) => {
    record('values', args);
    return chain;
  });
  chain.execute = jest.fn(async () => undefined);
  const insertInto = jest.fn((...args: unknown[]) => {
    record('insertInto', args);
    return chain;
  });
  const db = { insertInto } as unknown as Kysely<DB>;
  return { db, calls, chain, insertInto };
}

// ============================================================
// findByExternalTransactionId / findUltimoPorPedido mock harness
// (tasks.md 3.4)
// ============================================================

interface PaymentRow {
  id: string;
  order_id: string;
  gateway: string;
  external_transaction_id: string;
  monto: string;
  moneda: string;
  estado: string;
  paid_at: string | null;
}

function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 'payment-1',
    order_id: 'order-1',
    gateway: 'webpay',
    external_transaction_id: 'txn-1',
    monto: '14990.00',
    moneda: 'CLP',
    estado: 'pendiente',
    paid_at: null,
    ...overrides,
  };
}

function buildSelectDb(row: PaymentRow | undefined) {
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
  chain.orderBy = jest.fn((...args: unknown[]) => {
    record('orderBy', args);
    return chain;
  });
  chain.limit = jest.fn((...args: unknown[]) => {
    record('limit', args);
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
// marcarResultado() mock harness (tasks.md 3.5/3.6) — UPDATE condicional +
// RETURNING, mismo mecanismo de idempotencia que `transicionar`.
// ============================================================

function buildMarcarResultadoDb(returningRows: { id: string }[]) {
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

describe('KyselyPaymentRepository', () => {
  describe('crear (tasks.md 3.4)', () => {
    it('inserts exactly ONE row with estado EXPLICIT', async () => {
      const { db, chain } = buildCrearDb();
      const repo = new KyselyPaymentRepository(db);

      await repo.crear(paymentFixture({ estado: 'pendiente' }));

      expect(chain.values).toHaveBeenCalledTimes(1);
      const [insertedValues] = chain.values.mock.calls[0] as [Record<string, unknown>];
      expect(insertedValues).toHaveProperty('estado', 'pendiente');
    });

    it('formats monto into the numeric-column string shape and writes raw_payload as an explicit empty object', async () => {
      const { db, chain } = buildCrearDb();
      const repo = new KyselyPaymentRepository(db);

      await repo.crear(paymentFixture({ monto: 14990 }));

      const [insertedValues] = chain.values.mock.calls[0] as [Record<string, unknown>];
      expect(insertedValues).toMatchObject({ monto: '14990.00', raw_payload: '{}' });
    });
  });

  describe('findByExternalTransactionId (tasks.md 3.4)', () => {
    it('returns null when no row matches', async () => {
      const { db } = buildSelectDb(undefined);
      const repo = new KyselyPaymentRepository(db);

      await expect(repo.findByExternalTransactionId('webpay', 'unknown')).resolves.toBeNull();
    });

    it('maps a found row into a Payment, converting monto to number and paid_at null to undefined', async () => {
      const { db } = buildSelectDb(paymentRow({ monto: '14990.00', paid_at: null }));
      const repo = new KyselyPaymentRepository(db);

      const payment = await repo.findByExternalTransactionId('webpay', 'txn-1');

      expect(payment).toMatchObject({ monto: 14990, paidAt: undefined });
    });

    it('converts a non-null paid_at as-is, never new Date(null)', async () => {
      const { db } = buildSelectDb(paymentRow({ paid_at: '2026-08-16T10:00:00.000Z' }));
      const repo = new KyselyPaymentRepository(db);

      const payment = await repo.findByExternalTransactionId('webpay', 'txn-1');

      expect(payment?.paidAt).toBe('2026-08-16T10:00:00.000Z');
    });
  });

  describe('findUltimoPorPedido (tasks.md 3.4)', () => {
    it('orders by created_at desc and limits to 1', async () => {
      const { db, chain } = buildSelectDb(paymentRow());
      const repo = new KyselyPaymentRepository(db);

      await repo.findUltimoPorPedido('order-1');

      expect(chain.orderBy).toHaveBeenCalledWith('created_at', 'desc');
      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when the order has no payment attempts', async () => {
      const { db } = buildSelectDb(undefined);
      const repo = new KyselyPaymentRepository(db);

      await expect(repo.findUltimoPorPedido('order-x')).resolves.toBeNull();
    });
  });

  describe('marcarResultado — UPDATE condicional, rowcount como idempotencia (tasks.md 3.5)', () => {
    it('returns true when the conditional UPDATE moved exactly one row', async () => {
      const { db, chain } = buildMarcarResultadoDb([{ id: 'payment-1' }]);
      const repo = new KyselyPaymentRepository(UNUSED_DB);

      const movida = await repo.marcarResultado('payment-1', 'pagado', { foo: 'bar' }, db as never);

      expect(movida).toBe(true);
      expect(chain.set).toHaveBeenCalledTimes(1);
    });

    it('returns false when the row was already in the target state (0 rows matched — R4 idempotency)', async () => {
      const { db } = buildMarcarResultadoDb([]);
      const repo = new KyselyPaymentRepository(UNUSED_DB);

      const movida = await repo.marcarResultado('payment-1', 'pagado', {}, db as never);

      expect(movida).toBe(false);
    });

    it('serializes rawPayload with JSON.stringify, never the raw object', async () => {
      const { db, chain } = buildMarcarResultadoDb([{ id: 'payment-1' }]);
      const repo = new KyselyPaymentRepository(UNUSED_DB);

      await repo.marcarResultado('payment-1', 'pagado', { estado: 'pagado' }, db as never);

      const [setValues] = chain.set.mock.calls[0] as [Record<string, unknown>];
      expect(setValues.raw_payload).toBe(JSON.stringify({ estado: 'pagado' }));
      expect(typeof setValues.raw_payload).toBe('string');
    });

    it('conditions the UPDATE on both id and estado <> the target — never applies to an already-matching row', async () => {
      const { db, chain } = buildMarcarResultadoDb([{ id: 'payment-1' }]);
      const repo = new KyselyPaymentRepository(UNUSED_DB);

      await repo.marcarResultado('payment-1', 'pagado', {}, db as never);

      expect(chain.where).toHaveBeenCalledWith('id', '=', 'payment-1');
      expect(chain.where).toHaveBeenCalledWith('estado', '<>', 'pagado');
    });
  });
});
