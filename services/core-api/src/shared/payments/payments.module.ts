import { Global, Module } from '@nestjs/common';
import { PasarelaNoConfiguradaAdapter } from './pasarela-no-configurada.adapter';
import { PAYMENT_GATEWAY_PORT } from './payment-gateway.port';

/**
 * `specs/shared-payments/spec.md`: "PaymentsModule mirrors NotificationsModule's
 * shape" — mismo `@Global()` + provide/export que `shared/notifications/
 * notifications.module.ts` (design.md D-C.1, precedente literal). El puerto
 * no es de `pedidos-pagos` — es del kernel compartido — así que este
 * dominio nunca lo bindea ni lo exporta.
 *
 * Fase 5 (esta): bindea `PasarelaNoConfiguradaAdapter` (design.md D-C.2, la
 * rama permanente sin credenciales). Fase 6: pasa a `useFactory` — con
 * credenciales bindea el adaptador real, sin ellas sigue bindeando este.
 */
@Global()
@Module({
  providers: [{ provide: PAYMENT_GATEWAY_PORT, useClass: PasarelaNoConfiguradaAdapter }],
  exports: [PAYMENT_GATEWAY_PORT],
})
export class PaymentsModule {}
