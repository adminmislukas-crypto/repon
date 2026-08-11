# shared-notifications Specification

## Purpose

`NotificationPort`: a shared-kernel port for best-effort push notifications, bound to a real adapter for the first time in this change (D9). Mirrors `shared-audit-log`'s structure exactly — `consumo` is its first caller; `ofertas`/`pedidos-pagos` are declared future consumers of the same token.

## Requirements

### Requirement: NotificationPort binds in a new @Global() shared-kernel module, not inside any domain module

The real adapter for `NOTIFICATION_PORT` MUST bind in a new `src/shared/notifications/notifications.module.ts`, decorated `@Global()`, mirroring `shared/audit/audit.module.ts`: it MUST provide `NOTIFICATION_PORT` via `ExpoPushNotificationAdapter` and export `NOTIFICATION_PORT`. `SharedKernelModule` MUST import and export `NotificationsModule` alongside its existing shared modules. `consumo.module.ts` MUST NOT bind or export `NOTIFICATION_PORT` (D9).

#### Scenario: NotificationsModule mirrors AuditModule's shape

- GIVEN `src/shared/notifications/notifications.module.ts`
- WHEN it is inspected
- THEN it is decorated `@Global()`, provides `{ provide: NOTIFICATION_PORT, useClass: ExpoPushNotificationAdapter }`, and exports `NOTIFICATION_PORT` — the same shape `AuditModule` already has for `AUDIT_LOG_PORT`

#### Scenario: consumo.module.ts does not bind or export NOTIFICATION_PORT

- GIVEN `consumo.module.ts` after this change
- WHEN its `providers` and `exports` are enumerated
- THEN `NOTIFICATION_PORT` appears in neither — the token resolves only through `SharedKernelModule` → `NotificationsModule`

#### Scenario: A future domain reuses the same port without importing consumo

- GIVEN `ofertas` or `pedidos-pagos` later needs to send a push
- WHEN it injects `NOTIFICATION_PORT`
- THEN it resolves via `SharedKernelModule`, with no import of `ConsumoModule` or any `consumo` file required

### Requirement: sendPush never throws when the recipient has no registered token

`NotificationPort.sendPush(recipientProfileId, mensaje)` MUST resolve without throwing when no push token is registered for `recipientProfileId` — the common case today, since no token-registration surface exists yet. It MUST log the omission. No caller's use case MUST need to catch an exception from `sendPush` to remain correct (D10).

#### Scenario: No-op-safe on a missing token

- GIVEN a `profileId` with no registered push token
- WHEN `sendPush(profileId, mensaje)` is called
- THEN it logs the omission and resolves without throwing

#### Scenario: A caller's success does not depend on delivery

- GIVEN any `consumo` use case that calls `sendPush` as a side effect
- WHEN `sendPush` resolves, regardless of whether a token existed
- THEN the calling use case's own success or failure is unaffected by whether an actual delivery occurred
