import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationPort } from './notification.port';
import { PUSH_TOKEN_RESOLVER, type PushTokenResolver } from './push-token-resolver.port';

/**
 * design.md D-G: the real `NOTIFICATION_PORT` binding, first one this
 * kernel token gets. NO Expo HTTP client is wired (Q7 rejected both
 * `expo-server-sdk` and hand-rolled `fetch` — the send path is unreachable
 * today because `NullPushTokenResolver` always returns `null`; adding a
 * client now would be dead code). `expo-server-sdk` is the RECOMMENDED
 * client for the future change that wires a real `PushTokenResolver`,
 * written here so that change doesn't re-litigate it.
 */
@Injectable()
export class ExpoPushNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(ExpoPushNotificationAdapter.name);

  constructor(@Inject(PUSH_TOKEN_RESOLVER) private readonly resolver: PushTokenResolver) {}

  async sendPush(recipientProfileId: string, mensaje: string): Promise<void> {
    // D10, hard rule: this method NEVER throws — neither for a missing
    // token nor for an internal error. The cron's per-item try/catch (D4)
    // is the SECOND safety net, not the first. `mensaje` is NEVER passed
    // to the logger below: it may carry health data (e.g. medication
    // names/stock levels). Only metadata (profileId, outcome, reason) is
    // logged, never the message body. (`mensaje` is intentionally unused
    // below — it becomes load-bearing only once a real Expo client lands
    // at the insertion point marked further down.)
    void mensaje;
    try {
      const token = await this.resolver.resolve(recipientProfileId);

      if (token === null) {
        // The expected, common case today. `log`, not `warn`: this is not
        // an anomaly — it's the only reachable branch until a real
        // PushTokenResolver is wired.
        this.logger.log({ evento: 'push.omitida', recipientProfileId, motivo: 'sin_token' });
        return;
      }

      // UNREACHABLE today (NullPushTokenResolver always returns null).
      // `warn`, not silence: if a real resolver is wired without also
      // wiring an Expo client, this is discovered via a noisy log instead
      // of silent data loss. <-- EXACT insertion point for `expo-server-sdk`
      // (Q7) once a real client lands.
      this.logger.warn({
        evento: 'push.no_entregada',
        recipientProfileId,
        motivo: 'token_presente_sin_cliente_expo',
      });
    } catch (error) {
      this.logger.error({ evento: 'push.error', recipientProfileId, error });
    }
  }
}
