import { Inject, Injectable } from '@nestjs/common';
import type { PaymentStatus } from '@repon/types';
import { PagoNoEncontradoError, PedidoNoEncontradoError } from '../domain/pedido.errors';
import { ORDER_REPOSITORY, type OrderRepository } from '../ports-out/order-repository.port';
import { PAYMENT_REPOSITORY, type PaymentRepository } from '../ports-out/payment-repository.port';

export interface EstadoPago {
  readonly estado: PaymentStatus;
  readonly monto: number;
  readonly moneda: string;
  readonly paidAt?: string;
}

/**
 * `obtenerEstadoPago(orderId)` (design.md D-E) — lee estado LOCAL
 * únicamente, NUNCA llama a `PaymentGatewayPort`: un GET no debe depender
 * de un tercero. Lee el intento MÁS RECIENTE (`findUltimoPorPedido`,
 * `created_at desc`) — si hubo un intento fallido y luego uno exitoso,
 * este último es el que se muestra.
 *
 * **Sin `TRANSACTION_MANAGER` inyectado** (design.md D-G.2, precedente D13
 * de `ofertas`): un solo `SELECT`, su atomicidad es trivial.
 *
 * Read model angosto a propósito: `raw_payload`/`external_transaction_id`
 * nunca salen de `adapters/persistence/` — este caso de uso ni siquiera
 * los ve, porque `PaymentRepository`'s propio mapper (Fase 3) ya los
 * excluye del `Payment` que devuelve.
 */
@Injectable()
export class ObtenerEstadoPagoUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly paymentRepository: PaymentRepository,
  ) {}

  async execute(profileId: string, orderId: string): Promise<EstadoPago> {
    const order = await this.orderRepository.findById(orderId);
    if (order === null || order.userId !== profileId) {
      throw new PedidoNoEncontradoError(orderId);
    }

    const payment = await this.paymentRepository.findUltimoPorPedido(orderId);
    if (payment === null) {
      throw new PagoNoEncontradoError(`El pedido ${orderId} no tiene ningún intento de pago.`);
    }

    return {
      estado: payment.estado,
      monto: payment.monto,
      moneda: payment.moneda,
      paidAt: payment.paidAt,
    };
  }
}
