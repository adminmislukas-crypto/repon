import { Logger } from '@nestjs/common';
import type { PushTokenResolver } from './push-token-resolver.port';
import { ExpoPushNotificationAdapter } from './expo-push-notification.adapter';

// shared-notifications spec.md: "sendPush never throws when the recipient
// has no registered token" + design.md D-G's exact adapter shape —
// reclaim-before-throw is not the model here, it's simpler: the adapter
// NEVER throws, period (D10's "no caller must catch an exception from
// sendPush" contract). `mensaje` is never asserted into any log call
// below — it may carry health data (D-G) and must never be logged.

function buildResolver(): jest.Mocked<PushTokenResolver> {
  return { resolve: jest.fn() };
}

describe('ExpoPushNotificationAdapter', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('no token registered (the common case today, shared-notifications "No-op-safe on a missing token")', () => {
    it('resolves without throwing and logs push.omitida / sin_token', async () => {
      const resolver = buildResolver();
      resolver.resolve.mockResolvedValueOnce(null);
      const adapter = new ExpoPushNotificationAdapter(resolver);

      await expect(
        adapter.sendPush('profile-a', 'tu mascota tiene stock bajo de medicamento'),
      ).resolves.toBeUndefined();

      expect(resolver.resolve).toHaveBeenCalledWith('profile-a');
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'push.omitida',
          recipientProfileId: 'profile-a',
          motivo: 'sin_token',
        }),
      );
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('never logs the mensaje content anywhere (D-G: may carry health data)', async () => {
      const resolver = buildResolver();
      resolver.resolve.mockResolvedValueOnce(null);
      const adapter = new ExpoPushNotificationAdapter(resolver);
      const mensaje = 'a tu mascota Firulais le queda 1 día de Amoxicilina';

      await adapter.sendPush('profile-a', mensaje);

      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
      for (const call of allCalls) {
        for (const arg of call) {
          expect(JSON.stringify(arg)).not.toContain(mensaje);
        }
      }
    });
  });

  describe('the resolver itself throws', () => {
    it('does not throw and logs push.error', async () => {
      const resolver = buildResolver();
      resolver.resolve.mockRejectedValueOnce(new Error('resolver unreachable'));
      const adapter = new ExpoPushNotificationAdapter(resolver);

      await expect(adapter.sendPush('profile-a', 'mensaje')).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'push.error', recipientProfileId: 'profile-a' }),
      );
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('a token is present (unreachable today: NullPushTokenResolver always returns null; tested for when a real resolver lands)', () => {
    it('resolves without throwing and logs push.no_entregada / token_presente_sin_cliente_expo', async () => {
      const resolver = buildResolver();
      resolver.resolve.mockResolvedValueOnce('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]');
      const adapter = new ExpoPushNotificationAdapter(resolver);

      await expect(adapter.sendPush('profile-a', 'mensaje')).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'push.no_entregada',
          recipientProfileId: 'profile-a',
          motivo: 'token_presente_sin_cliente_expo',
        }),
      );
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
