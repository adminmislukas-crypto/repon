import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyOrderRepository } from './adapters/persistence/kysely-order.repository';
import { OfertaAceptadaListener } from './adapters/events/oferta-aceptada.listener';
import { CrearPedidoDesdeOfertaUseCase } from './ports-in/crear-pedido-desde-oferta.use-case';
import { ORDER_REPOSITORY } from './ports-out/order-repository.port';

/**
 * design.md D-G.4 "Estructura de archivos". Fase 4 (`backend-core-api-
 * pedidos-pagos` PR5, este batch): primeros providers reales — deja de ser
 * `@Module({})`, el ÚLTIMO módulo de dominio vacío del repo. `imports:
 * [DatabaseModule]`: `KyselyOrderRepository` necesita `DATABASE`
 * (redundante, `DatabaseModule` es `@Global()`, pero explícito — mismo
 * estilo que `identidad`/`catalogo`/`consumo`/`refill-matching`).
 *
 * `PAYMENT_REPOSITORY` (implementado desde PR3) deliberadamente NO se
 * bindea acá todavía: `CrearPedidoDesdeOfertaUseCase` no lo necesita, y
 * este archivo agrega exactamente lo que cada fase usa por primera vez —
 * mismo criterio que `refill-matching.module.ts` extendió su propio array
 * de `providers` incrementalmente, fase por fase. Llega en la Fase 5
 * (PR6), cuando `iniciarPago`/`obtenerEstadoPago` lo necesiten.
 *
 * `PAYMENT_GATEWAY_PORT`/`NOTIFICATION_PORT`/`EVENT_PUBLISHER` NO se
 * redeclaran acá: son infraestructura del kernel compartido
 * (`shared/payments`/`shared/notifications`/`shared/event-bus`), mismo
 * patrón que la D17 de `ofertas`.
 *
 * `exports: []` (design.md D15): este dominio no tiene `contracts/` y
 * nada más lo importa.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: KyselyOrderRepository },
    CrearPedidoDesdeOfertaUseCase,
    OfertaAceptadaListener,
  ],
  exports: [],
})
export class PedidosPagosModule {}
