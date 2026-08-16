import type { Order, Payment } from '@repon/types';
import type { PaymentGatewayPort } from '../../../shared/payments/payment-gateway.port';
import type { OrderRepository } from '../ports-out/order-repository.port';
import type { PaymentRepository } from '../ports-out/payment-repository.port';
import { PedidoNoEncontradoError, PedidoNoPagableError } from '../domain/pedido.errors';
import { IniciarPagoUseCase } from './iniciar-pago.use-case';

// design.md Diagrama 2 / D-D — iniciarPago: SIN tx (una sola escritura, la
// llamada a la pasarela es de red y NUNCA entra a una transacción, D-G.2);
// el monto SIEMPRE sale de `orders.total`, jamás del cliente.

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
    crear: jest.fn().mockResolvedValue(undefined),
    findByExternalTransactionId: jest.fn(),
    findUltimoPorPedido: jest.fn(),
    marcarResultado: jest.fn(),
  };
}

function buildPaymentGateway(): jest.Mocked<PaymentGatewayPort> {
  return {
    crearTransaccion: jest.fn().mockResolvedValue({
      checkoutUrl: 'https://pasarela/checkout/x',
      externalTransactionId: 'txn-1',
      gateway: 'webpay',
    }),
    verificarPago: jest.fn(),
  };
}

function buildUseCase() {
  const orderRepository = buildOrderRepository();
  const paymentRepository = buildPaymentRepository();
  const paymentGateway = buildPaymentGateway();
  const useCase = new IniciarPagoUseCase(orderRepository, paymentRepository, paymentGateway);
  return { orderRepository, paymentRepository, paymentGateway, useCase };
}

describe('IniciarPagoUseCase', () => {
  it('returns the checkoutUrl from a successful crearTransaccion call', async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.execute('user-1', 'order-1');

    expect(result).toEqual({ checkoutUrl: 'https://pasarela/checkout/x' });
  });

  it('derives monto exclusively from order.total, never from the caller', async () => {
    const { orderRepository, paymentGateway, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ total: 99999 }));

    await useCase.execute('user-1', 'order-1');

    expect(paymentGateway.crearTransaccion).toHaveBeenCalledWith('order-1', 99999);
  });

  it('creates exactly one payments row with estado pendiente after a successful crearTransaccion', async () => {
    const { paymentRepository, useCase } = buildUseCase();

    await useCase.execute('user-1', 'order-1');

    expect(paymentRepository.crear).toHaveBeenCalledTimes(1);
    const [payment] = paymentRepository.crear.mock.calls[0] as [Payment];
    expect(payment).toMatchObject({
      orderId: 'order-1',
      gateway: 'webpay',
      externalTransactionId: 'txn-1',
      monto: 14990,
      estado: 'pendiente',
    });
  });

  it('throws PedidoNoEncontradoError when the order does not exist', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(null);

    await expect(useCase.execute('user-1', 'order-missing')).rejects.toThrow(
      PedidoNoEncontradoError,
    );
  });

  it('throws PedidoNoEncontradoError (never a different error) when the order belongs to another user', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ userId: 'user-other' }));

    await expect(useCase.execute('user-1', 'order-1')).rejects.toThrow(PedidoNoEncontradoError);
  });

  it('throws PedidoNoPagableError when the order is not pendiente_pago', async () => {
    const { orderRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ status: 'confirmado' }));

    await expect(useCase.execute('user-1', 'order-1')).rejects.toThrow(PedidoNoPagableError);
  });

  it('never calls the payment gateway or writes a payments row for a non-payable order', async () => {
    const { orderRepository, paymentGateway, paymentRepository, useCase } = buildUseCase();
    orderRepository.findById.mockResolvedValue(orderFixture({ status: 'confirmado' }));

    await expect(useCase.execute('user-1', 'order-1')).rejects.toThrow(PedidoNoPagableError);

    expect(paymentGateway.crearTransaccion).not.toHaveBeenCalled();
    expect(paymentRepository.crear).not.toHaveBeenCalled();
  });

  it('propagates a PasarelaNoConfiguradaError (or any gateway error) uncaught, and writes no payments row', async () => {
    const { paymentGateway, paymentRepository, useCase } = buildUseCase();
    const gatewayError = new Error('pasarela no configurada');
    paymentGateway.crearTransaccion.mockRejectedValue(gatewayError);

    await expect(useCase.execute('user-1', 'order-1')).rejects.toBe(gatewayError);
    expect(paymentRepository.crear).not.toHaveBeenCalled();
  });
});
