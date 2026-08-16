import type { Order, OrderStatus } from '@repon/types';
import type { OrderRepository } from '../ports-out/order-repository.port';
import { PedidoNoEncontradoError, TransicionInvalidaError } from '../domain/pedido.errors';
import { ActualizarEstadoPedidoUseCase } from './actualizar-estado-pedido.use-case';

// design.md D-A.2/D-G.2 — actualizarEstadoPedido: SIN TRANSACTION_MANAGER
// (un select + un update condicional, su atomicidad es el WHERE); la
// máquina de estados (Fase 2) se consulta ANTES de escribir, y el rowcount
// del repositorio es la red final contra una carrera.

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    offerId: 'offer-1',
    userId: 'user-1',
    companyId: 'company-1',
    status: 'confirmado',
    total: 14990,
    costoDespacho: 2000,
    ...overrides,
  };
}

function buildOrderRepository(): jest.Mocked<OrderRepository> {
  return {
    crear: jest.fn(),
    findById: jest.fn().mockResolvedValue(orderFixture()),
    findByOfferId: jest.fn(),
    transicionar: jest.fn().mockResolvedValue(true),
  };
}

function buildUseCase() {
  const orderRepository = buildOrderRepository();
  const useCase = new ActualizarEstadoPedidoUseCase(orderRepository);
  return { orderRepository, useCase };
}

describe('ActualizarEstadoPedidoUseCase', () => {
  it('does not inject TRANSACTION_MANAGER (design.md D-G.2, inspection test)', () => {
    // El constructor de ActualizarEstadoPedidoUseCase solo toma OrderRepository
    // — verificado por su propia arity, sin necesitar reflection.
    expect(ActualizarEstadoPedidoUseCase.length).toBe(1);
  });

  it('transitions confirmado -> preparando for the owning company', async () => {
    const { orderRepository, useCase } = buildUseCase();

    await useCase.execute('company-1', 'order-1', 'preparando');

    expect(orderRepository.transicionar).toHaveBeenCalledWith(
      'order-1',
      'confirmado',
      'preparando',
    );
  });

  it('throws PedidoNoEncontradoError when the order does not exist', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('company-1', 'order-missing', 'preparando')).rejects.toThrow(
      PedidoNoEncontradoError,
    );
  });

  it('throws PedidoNoEncontradoError (never a different error) when the order belongs to another company', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ companyId: 'company-other' }));

    await expect(useCase.execute('company-1', 'order-1', 'preparando')).rejects.toThrow(
      PedidoNoEncontradoError,
    );
  });

  it('throws TransicionInvalidaError for a skipped step, before ever calling the repository', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ status: 'confirmado' }));

    await expect(useCase.execute('company-1', 'order-1', 'en_camino')).rejects.toThrow(
      TransicionInvalidaError,
    );
    expect(orderRepository.transicionar).not.toHaveBeenCalled();
  });

  it.each<OrderStatus>(['entregado', 'expirado'])(
    'throws TransicionInvalidaError from a terminal state (%s)',
    async (estado) => {
      const { orderRepository, useCase } = buildUseCase();
      orderRepository.findById.mockResolvedValue(orderFixture({ status: estado }));

      await expect(useCase.execute('company-1', 'order-1', 'preparando')).rejects.toThrow(
        TransicionInvalidaError,
      );
    },
  );

  it('throws TransicionInvalidaError when the repository rowcount reports 0 — a race lost after the read', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.transicionar.mockResolvedValue(false);

    await expect(useCase.execute('company-1', 'order-1', 'preparando')).rejects.toThrow(
      TransicionInvalidaError,
    );
  });
});
