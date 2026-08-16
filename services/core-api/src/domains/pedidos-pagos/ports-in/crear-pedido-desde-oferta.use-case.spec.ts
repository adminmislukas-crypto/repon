import type { Order } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { OrderRepository } from '../ports-out/order-repository.port';
import { PedidoInvalidoError, PedidoYaExisteError } from '../domain/pedido.errors';
import type { NuevaLineaPedido } from '../domain/order.entity';
import {
  CrearPedidoDesdeOfertaUseCase,
  type CrearPedidoDesdeOfertaInput,
} from './crear-pedido-desde-oferta.use-case';

// design.md Diagrama 1 (D-F): crearPedidoDesdeOferta valida el invariante
// del total ANTES de abrir la transacción (order_items no admite UPDATE ni
// DELETE, R6), hace read-and-skip por findByOfferId (R5), y traduce
// PedidoYaExisteError (23505 del índice único, el TOCTOU) al MISMO no-op —
// cero escrituras adicionales, cero eventos, en ambos casos.

const fakeTx = {} as TransactionContext;

function buildOrderRepository(): jest.Mocked<OrderRepository> {
  return {
    crear: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findByOfferId: jest.fn().mockResolvedValue(null),
    transicionar: jest.fn(),
  };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildUseCase() {
  const orderRepository = buildOrderRepository();
  const transactionManager = buildTransactionManager();
  const useCase = new CrearPedidoDesdeOfertaUseCase(orderRepository, transactionManager);
  return { orderRepository, transactionManager, useCase };
}

function linea(overrides: Partial<NuevaLineaPedido> = {}): NuevaLineaPedido {
  return {
    offerItemId: 'offer-item-1',
    nombre: 'Agua 20L',
    precio: 12990,
    isAlt: false,
    ...overrides,
  };
}

function input(overrides: Partial<CrearPedidoDesdeOfertaInput> = {}): CrearPedidoDesdeOfertaInput {
  const lineas = overrides.lineas ?? [linea()];
  const costoDespacho = overrides.costoDespacho ?? 2000;
  const total = overrides.total ?? lineas.reduce((suma, l) => suma + l.precio, 0) + costoDespacho;
  return {
    offerId: 'offer-1',
    userId: 'user-1',
    companyId: 'company-1',
    total,
    costoDespacho,
    lineas,
    ...overrides,
  };
}

describe('CrearPedidoDesdeOfertaUseCase', () => {
  it('creates exactly one order with its items inside a transaction', async () => {
    const { orderRepository, useCase } = buildUseCase();

    await useCase.execute(input());

    expect(orderRepository.crear).toHaveBeenCalledTimes(1);
    const [order, items, tx] = orderRepository.crear.mock.calls[0] as [
      Order,
      readonly unknown[],
      TransactionContext,
    ];
    expect(order.status).toBe('pendiente_pago');
    expect(items).toHaveLength(1);
    expect(tx).toBe(fakeTx);
  });

  it('validates the total invariant BEFORE opening any transaction', async () => {
    const { orderRepository, transactionManager, useCase } = buildUseCase();

    await expect(
      useCase.execute(
        input({ lineas: [linea({ precio: 1000 })], costoDespacho: 500, total: 999999 }),
      ),
    ).rejects.toThrow(PedidoInvalidoError);

    expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
    expect(orderRepository.crear).not.toHaveBeenCalled();
  });

  it('is a no-op — zero writes — when an order already exists for the offer (read-and-skip, R5)', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findByOfferId.mockResolvedValue({
      id: 'order-existing',
      offerId: 'offer-1',
      userId: 'user-1',
      companyId: 'company-1',
      status: 'pendiente_pago',
      total: 14990,
      costoDespacho: 2000,
    });

    await useCase.execute(input());

    expect(orderRepository.crear).not.toHaveBeenCalled();
  });

  it('treats a PedidoYaExisteError from crear (the TOCTOU) as the same no-op, never propagating it', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findByOfferId.mockResolvedValue(null);
    orderRepository.crear.mockRejectedValue(new PedidoYaExisteError('offer-1'));

    await expect(useCase.execute(input())).resolves.toBeUndefined();
  });

  it('re-throws any other error from crear as-is', async () => {
    const { orderRepository, useCase } = buildUseCase();
    const otherError = new Error('connection reset');
    orderRepository.crear.mockRejectedValue(otherError);

    await expect(useCase.execute(input())).rejects.toBe(otherError);
  });
});
