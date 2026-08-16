import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { PedidosController } from './adapters/http/pedidos.controller';
import { KyselyOrderRepository } from './adapters/persistence/kysely-order.repository';
import { KyselyPaymentRepository } from './adapters/persistence/kysely-payment.repository';
import { OfertaAceptadaListener } from './adapters/events/oferta-aceptada.listener';
import { ActualizarEstadoPedidoUseCase } from './ports-in/actualizar-estado-pedido.use-case';
import { CrearPedidoDesdeOfertaUseCase } from './ports-in/crear-pedido-desde-oferta.use-case';
import { IniciarPagoUseCase } from './ports-in/iniciar-pago.use-case';
import { ObtenerEstadoPagoUseCase } from './ports-in/obtener-estado-pago.use-case';
import { ORDER_REPOSITORY } from './ports-out/order-repository.port';
import { PAYMENT_REPOSITORY } from './ports-out/payment-repository.port';

/**
 * design.md D-G.4 "Estructura de archivos". Fase 4 (PR5) agregó
 * `ORDER_REPOSITORY`/`CrearPedidoDesdeOfertaUseCase`/`OfertaAceptadaListener`
 * y dejó `PAYMENT_REPOSITORY` deliberadamente sin bindear (nada lo
 * necesitaba todavía). Fase 5 (PR6, este batch) lo agrega — `iniciarPago`/
 * `obtenerEstadoPago` son sus primeros consumidores — junto con los 3
 * casos de uso del ciclo de vida y el primer controlador de este dominio.
 * `imports: [DatabaseModule]` (redundante, `@Global()`, pero explícito —
 * mismo estilo que el resto del repo).
 *
 * `PAYMENT_GATEWAY_PORT`/`NOTIFICATION_PORT`/`EVENT_PUBLISHER` NO se
 * redeclaran acá: infraestructura del kernel compartido.
 *
 * `exports: []` (design.md D15): sin `contracts/`, nada más importa de acá.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PedidosController],
  providers: [
    { provide: ORDER_REPOSITORY, useClass: KyselyOrderRepository },
    { provide: PAYMENT_REPOSITORY, useClass: KyselyPaymentRepository },
    CrearPedidoDesdeOfertaUseCase,
    OfertaAceptadaListener,
    IniciarPagoUseCase,
    ObtenerEstadoPagoUseCase,
    ActualizarEstadoPedidoUseCase,
  ],
  exports: [],
})
export class PedidosPagosModule {}
