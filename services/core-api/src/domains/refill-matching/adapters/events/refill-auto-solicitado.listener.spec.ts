import { Logger } from '@nestjs/common';
import type { CrearBorradorRefillUseCase } from '../../ports-in/crear-borrador-refill.use-case';
import type { RefillAutoSolicitadoPayload } from './consumo-event.payloads';
import { RefillAutoSolicitadoListener } from './refill-auto-solicitado.listener';

// core-api-refill-matching spec: "the listener captures and logs, never
// re-throws" (R5) + "StockBajoDetectado alone creates nothing" (D2) — 2 of
// this change's 4 mandatory D17 negatives. `reflect-metadata` is loaded
// globally via `package.json`'s jest `setupFiles` (same convention
// `buscar-proveedores-compatibles.use-case.spec.ts`'s own constructor-
// inspection test relies on) — no explicit import needed here.
//
// `EVENT_LISTENER_METADATA` is the Reflect metadata key `@nestjs/event-
// emitter`'s `OnEvent` decorator writes onto the decorated method itself
// (`@nestjs/event-emitter/dist/constants.js`) — hardcoded here rather than
// importing the package's internal subpath, same technique this domain's
// own `buscar-proveedores-compatibles.use-case.spec.ts` (5a.6) already uses
// for `SELF_DECLARED_DEPS_METADATA`.
const EVENT_LISTENER_METADATA_KEY = 'EVENT_LISTENER_METADATA';

function buildUseCase(): jest.Mocked<CrearBorradorRefillUseCase> {
  return { execute: jest.fn() } as unknown as jest.Mocked<CrearBorradorRefillUseCase>;
}

const payload: RefillAutoSolicitadoPayload = {
  consumptionId: 'consumption-a',
  userId: 'user-a',
  nombre: 'Alimento perro',
};

describe('RefillAutoSolicitadoListener', () => {
  describe("the listener captures and logs, never re-throws (R5, core-api-refill-matching 'the listener captures and logs, never re-throws')", () => {
    it('resolves without throwing when crearBorradorRefillUseCase.execute() rejects, and logs the error', async () => {
      const useCase = buildUseCase();
      useCase.execute.mockRejectedValue(new Error('dedup/save failed'));
      const listener = new RefillAutoSolicitadoListener(useCase);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(listener.onRefillAutoSolicitado({ payload })).resolves.toBeUndefined();

      expect(useCase.execute).toHaveBeenCalledWith(payload);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      errorSpy.mockRestore();
    });
  });

  describe("StockBajoDetectado alone creates nothing (D2, core-api-refill-matching 'StockBajoDetectado alone creates nothing') — structural inspection, not textual", () => {
    it('exposes exactly one @OnEvent-decorated method on the class, registered on consumo.refill_auto_solicitado only', () => {
      const prototype = RefillAutoSolicitadoListener.prototype as unknown as Record<string, object>;
      const methodNames = Object.getOwnPropertyNames(prototype).filter(
        (name) => name !== 'constructor',
      );

      const eventHandlers = methodNames
        .map((name) => {
          const method = prototype[name]!;
          return {
            name,
            metadata: Reflect.getMetadata(EVENT_LISTENER_METADATA_KEY, method) as
              Array<{ event: string; options: unknown }> | undefined,
          };
        })
        .filter((entry) => entry.metadata !== undefined);

      // If a second handler existed (e.g. an @OnEvent('consumo.stock_bajo_detectado')
      // one), it would show up here as a 2nd entry — this assertion fails
      // structurally, not because "we didn't write one".
      expect(eventHandlers).toHaveLength(1);
      expect(eventHandlers[0]!.metadata).toEqual([
        { event: 'consumo.refill_auto_solicitado', options: undefined },
      ]);
    });
  });
});
