import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Payment } from '@repon/types';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
} from '../../../shared/payments/payment-gateway.port';
import { PedidoNoEncontradoError, PedidoNoPagableError } from '../domain/pedido.errors';
import { ORDER_REPOSITORY, type OrderRepository } from '../ports-out/order-repository.port';
import { PAYMENT_REPOSITORY, type PaymentRepository } from '../ports-out/payment-repository.port';

/**
 * `iniciarPago(orderId)` (design.md Diagrama 2, D-D) — HTTP-triggered,
 * deliberadamente FUERA del camino del listener (D-D: si `crearPedidoDesdeOferta`
 * también llamara a la pasarela, un timeout de red convertiría una
 * aceptación YA COMMITEADA en un 5xx). El monto SIEMPRE sale de
 * `orders.total`, jamás de un parámetro del cliente — el DTO de la ruta no
 * tiene body (Fase 6, controller).
 *
 * **SIN `runInTransaction`** (design.md D-G.2): una sola escritura, y la
 * llamada a `crearTransaccion` es de red — mantenerla dentro de una
 * transacción agotaría el pool bajo timeout (misma regla que la C2 de
 * `ofertas` para `CatalogQueryPort`).
 */
@Injectable()
export class IniciarPagoUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly paymentGateway: PaymentGatewayPort,
  ) {}

  async execute(profileId: string, orderId: string): Promise<{ checkoutUrl: string }> {
    const order = await this.orderRepository.findById(orderId);
    if (order === null || order.userId !== profileId) {
      throw new PedidoNoEncontradoError(orderId);
    }
    if (order.status !== 'pendiente_pago') {
      throw new PedidoNoPagableError(orderId);
    }

    // ***FUERA DE TODA TRANSACCIÓN*** — llamada de red a un tercero.
    const { checkoutUrl, externalTransactionId, gateway } =
      await this.paymentGateway.crearTransaccion(orderId, order.total);

    const payment: Payment = {
      id: randomUUID(),
      orderId,
      gateway,
      externalTransactionId,
      monto: order.total,
      moneda: 'CLP',
      estado: 'pendiente',
    };
    await this.paymentRepository.crear(payment);

    return { checkoutUrl };
  }
}
