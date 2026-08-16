import { Global, Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { EventBusModule } from './event-bus/event-bus.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { SupabaseModule } from './supabase/supabase.module';

/**
 * Aggregates every shared-kernel module with a real provider (design.md's DI
 * token table) behind one `@Global()` import — `AppModule` imports this
 * instead of each module individually (task 3.10, the follow-up PR 4's
 * `app.module.ts` flagged). `shared/notifications` gained a real binding in
 * PR 5 (D9): `NotificationsModule` provides `NOTIFICATION_PORT` via
 * `ExpoPushNotificationAdapter`, so it is aggregated here like every other
 * bound module. `shared/payments` gained its first binding in
 * `backend-core-api-pedidos-pagos` PR5 (design.md D-C.1):
 * `PaymentsModule` provides `PAYMENT_GATEWAY_PORT` via
 * `PasarelaNoConfiguradaAdapter` today, a real gateway adapter from that
 * same change's PR7a on.
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    SupabaseModule,
    EventBusModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    PaymentsModule,
  ],
  exports: [
    DatabaseModule,
    SupabaseModule,
    EventBusModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    PaymentsModule,
  ],
})
export class SharedKernelModule {}
