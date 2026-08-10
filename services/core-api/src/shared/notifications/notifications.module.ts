import { Global, Module } from '@nestjs/common';
import { ExpoPushNotificationAdapter } from './expo-push-notification.adapter';
import { NullPushTokenResolver } from './null-push-token.resolver';
import { NOTIFICATION_PORT } from './notification.port';
import { PUSH_TOKEN_RESOLVER } from './push-token-resolver.port';

/**
 * shared-notifications spec.md: "NotificationsModule mirrors AuditModule's
 * shape" — same `@Global()` + provide/export pair as `shared/audit/
 * audit.module.ts`, no `DatabaseModule` import needed (today's adapter is
 * a no-op stub with zero I/O, D10).
 *
 * `PUSH_TOKEN_RESOLVER` is bound but deliberately NOT exported — it is an
 * internal wiring detail with exactly one consumer,
 * `ExpoPushNotificationAdapter`, inside this same module. Everything else
 * in the app only ever needs `NOTIFICATION_PORT`.
 */
@Global()
@Module({
  providers: [
    { provide: PUSH_TOKEN_RESOLVER, useClass: NullPushTokenResolver },
    { provide: NOTIFICATION_PORT, useClass: ExpoPushNotificationAdapter },
  ],
  exports: [NOTIFICATION_PORT],
})
export class NotificationsModule {}
