import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import { crearPedidoPendiente, type NuevaLineaPedido } from '../domain/order.entity';
import { PedidoYaExisteError } from '../domain/pedido.errors';
import { ORDER_REPOSITORY, type OrderRepository } from '../ports-out/order-repository.port';

/**
 * Forma que el listener (`oferta-aceptada.listener.ts`, este mismo PR) le
 * pasa a este caso de uso, ya mapeada desde su payload local de `ofertas` —
 * este archivo no conoce nada de `ofertas` (D3).
 */
export interface CrearPedidoDesdeOfertaInput {
  readonly offerId: string;
  readonly userId: string;
  readonly companyId: string;
  readonly total: number;
  readonly costoDespacho: number;
  readonly lineas: readonly NuevaLineaPedido[];
}

/**
 * `crearPedidoDesdeOferta` (design.md D-F, Diagrama 1) — interno, sin ruta
 * HTTP, invocado exclusivamente por el listener. NUNCA llama a
 * `PaymentGatewayPort`: esa es la razón de ser de D-D (Fase 6), separar
 * "el pedido existe" de "el usuario quiere pagar ahora".
 *
 * ## Flujo
 *
 * 1. `crearPedidoPendiente(input)` (Fase 2, dominio puro) — construye
 *    `Order`/`OrderItem[]` en memoria, `status: 'pendiente_pago'` explícito,
 *    y valida el invariante del total. **Antes de abrir cualquier
 *    transacción**: `order_items` no admite `UPDATE` ni `DELETE` (R6), así
 *    que un payload incoherente debe fallar acá, nunca después del insert.
 * 2. Dentro de `runInTransaction`:
 *    - `findByOfferId(offerId, tx)` — read-and-skip (R5). Si ya existe un
 *      pedido para esta oferta, retorna sin escribir nada.
 *    - `orderRepository.crear(order, items, tx)` — 1 insert + 1 insert
 *      bulk. Si el driver reporta `23505` sobre `orders_offer_id_uidx`
 *      (el TOCTOU de 2 entregas casi simultáneas), el adaptador (Fase 3)
 *      ya lo tradujo a `PedidoYaExisteError` — este caso de uso lo captura
 *      y lo trata como el MISMO no-op que el read-and-skip, nunca como un
 *      error real.
 * 3. **Cero eventos.** Un pedido `pendiente_pago` no es un hecho que nadie
 *    deba consumir todavía — `PedidoConfirmado` se publica recién cuando el
 *    pago confirma (Fase 6b, Diagrama 3).
 */
@Injectable()
export class CrearPedidoDesdeOfertaUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(input: CrearPedidoDesdeOfertaInput): Promise<void> {
    // (1) Fuera de la transacción — valida antes de cualquier escritura.
    const { order, items } = crearPedidoPendiente(input);

    // (2)
    await this.transactionManager.runInTransaction(async (tx) => {
      const existente = await this.orderRepository.findByOfferId(input.offerId, tx);
      if (existente !== null) {
        return;
      }

      try {
        await this.orderRepository.crear(order, items, tx);
      } catch (error) {
        if (error instanceof PedidoYaExisteError) {
          return;
        }
        throw error;
      }
    });
    // ---- COMMIT ----
    // (3) Cero eventos.
  }
}
