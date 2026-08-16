import type { Order, Payment } from '@repon/types';
import type { OrderRepository } from '../ports-out/order-repository.port';
import type { PaymentRepository } from '../ports-out/payment-repository.port';
import { PagoNoEncontradoError, PedidoNoEncontradoError } from '../domain/pedido.errors';
import { ObtenerEstadoPagoUseCase } from './obtener-estado-pago.use-case';

// design.md D-E — obtenerEstadoPago lee estado LOCAL únicamente, nunca llama
// a la pasarela (D-G.2, sin TRANSACTION_MANAGER — la ausencia es el test).

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

function buildOrderRepository(): jest.Mocked<OrderRepository> {
  return {
    crear: jest.fn(),
    findById: jest.fn().mockResolvedValue(orderFixture()),
    findByOfferId: jest.fn(),
    transicionar: jest.fn(),
  };
}

function buildPaymentRepository(): jest.Mocked<PaymentRepository> {
  return {
    crear: jest.fn(),
    findByExternalTransactionId: jest.fn(),
    findUltimoPorPedido: jest.fn().mockResolvedValue(paymentFixture()),
    marcarResultado: jest.fn(),
  };
}

function buildUseCase() {
  const orderRepository = buildOrderRepository();
  const paymentRepository = buildPaymentRepository();
  const useCase = new ObtenerEstadoPagoUseCase(orderRepository, paymentRepository);
  return { orderRepository, paymentRepository, useCase };
}

describe('ObtenerEstadoPagoUseCase', () => {
  it('returns estado/monto/moneda/paidAt from the latest payment attempt', async () => {
    const { paymentRepository, useCase } = buildUseCase();
    paymentRepository.findUltimoPorPedido.mockResolvedValue(
      paymentFixture({
        estado: 'pagado',
        monto: 14990,
        moneda: 'CLP',
        paidAt: '2026-08-16T00:00:00.000Z',
      }),
    );

    const result = await useCase.execute('user-1', 'order-1');

    expect(result).toEqual({
      estado: 'pagado',
      monto: 14990,
      moneda: 'CLP',
      paidAt: '2026-08-16T00:00:00.000Z',
    });
  });

  it('never includes raw_payload or externalTransactionId — narrow read model', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute('user-1', 'order-1');

    expect(result).not.toHaveProperty('rawPayload');
    expect(result).not.toHaveProperty('externalTransactionId');
    expect(result).not.toHaveProperty('gateway');
  });

  it('throws PedidoNoEncontradoError when the order does not exist', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('user-1', 'order-missing')).rejects.toThrow(
      PedidoNoEncontradoError,
    );
  });

  it('throws PedidoNoEncontradoError when the order belongs to another user', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ userId: 'user-other' }));

    await expect(useCase.execute('user-1', 'order-1')).rejects.toThrow(PedidoNoEncontradoError);
  });

  it('throws PagoNoEncontradoError when the order has never had a payment attempt', async () => {
    const { paymentRepository, useCase } = buildUseCase();
    paymentRepository.findUltimoPorPedido.mockResolvedValue(null);

    await expect(useCase.execute('user-1', 'order-1')).rejects.toThrow(PagoNoEncontradoError);
  });
});
