import { Inject, Injectable } from '@nestjs/common';
import { esTransicionValida } from '../domain/order.entity';
import { PedidoNoEncontradoError, TransicionInvalidaError } from '../domain/pedido.errors';
import { ORDER_REPOSITORY, type OrderRepository } from '../ports-out/order-repository.port';

/** Los 3 únicos estados que `actualizarEstadoPedido` puede recibir como
 *  destino — el DTO (Fase 6) ya rechaza cualquier otro valor con 400,
 *  antes de que este caso de uso corra (design.md D-E). */
export type EstadoProveedor = 'preparando' | 'en_camino' | 'entregado';

/**
 * `actualizarEstadoPedido(companyId, orderId, nuevoEstado)` (design.md
 * D-A.2/D-E) — **sin `TRANSACTION_MANAGER` inyectado** (D-G.2, precedente
 * D13 de `ofertas`): un `SELECT` + un `UPDATE` condicional, su atomicidad
 * es el propio `WHERE status = $desde`, no una transacción.
 *
 * Doble defensa, a propósito: `esTransicionValida` (Fase 2) rechaza ANTES
 * de tocar la base una transición obviamente ilegal (salto, retroceso,
 * terminal); el rowcount de `orderRepository.transicionar` es la red
 * final contra una carrera perdida ENTRE el `findById` y el `UPDATE` — dos
 * llamadas casi simultáneas del mismo proveedor, o un pago que confirmó
 * justo en el medio.
 */
@Injectable()
export class ActualizarEstadoPedidoUseCase {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository) {}

  async execute(companyId: string, orderId: string, nuevoEstado: EstadoProveedor): Promise<void> {
    const order = await this.orderRepository.findById(orderId);
    if (order === null || order.companyId !== companyId) {
      throw new PedidoNoEncontradoError(orderId);
    }

    if (!esTransicionValida(order.status, nuevoEstado)) {
      throw new TransicionInvalidaError(
        `No se puede transicionar el pedido de '${order.status}' a '${nuevoEstado}'.`,
      );
    }

    const movida = await this.orderRepository.transicionar(orderId, order.status, nuevoEstado);
    if (!movida) {
      throw new TransicionInvalidaError(
        `El pedido ${orderId} ya no está en el estado '${order.status}'.`,
      );
    }
  }
}
