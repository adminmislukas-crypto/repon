import { Logger } from '@nestjs/common';
import type { RegistrarOportunidadUseCase } from '../../ports-in/registrar-oportunidad.use-case';
import type { MatchEncontradoPayload } from './refill-matching-event.payloads';
import { MatchEncontradoListener } from './match-encontrado.listener';

// design.md Diagrama 1 (D2 + D5 + R5), tasks.md 4a.5 — D18-5, ONE OF THE 5
// MANDATORY NEGATIVE TESTS for this whole change. `EventEmitterPublisher.
// publish` uses `emitAsync`: a rejecting listener here would propagate BACK
// into `refill-matching`'s own `buscarProveedoresCompatibles` publish call,
// turning a SUCCESSFUL match search into a 5xx for `refill-matching` itself.
// Catches everything, never re-throws — same pattern
// `refill-auto-solicitado.listener.spec.ts` already established for
// `consumo`/`refill-matching`.
//
// `EVENT_LISTENER_METADATA_KEY` is the Reflect metadata key `@nestjs/event-
// emitter`'s `OnEvent` decorator writes onto the decorated method itself —
// hardcoded here rather than importing the package's internal subpath, same
// technique `refill-auto-solicitado.listener.spec.ts`/
// `buscar-proveedores-compatibles.use-case.spec.ts` already use.
const EVENT_LISTENER_METADATA_KEY = 'EVENT_LISTENER_METADATA';

function buildUseCase(): jest.Mocked<RegistrarOportunidadUseCase> {
  return { execute: jest.fn() } as unknown as jest.Mocked<RegistrarOportunidadUseCase>;
}

const payload: MatchEncontradoPayload = {
  refillRequestId: 'refill-request-a',
  userId: 'user-a',
  comuna: 'Providencia',
  urgencia: 'hoy',
  companyIds: ['company-a'],
  items: [
    {
      refillItemId: 'refill-item-a',
      nombre: 'Alimento perro',
      categoria: 'alimento',
      precioReferencia: 12990,
      catalogProductId: null,
    },
  ],
};

describe('MatchEncontradoListener', () => {
  describe("a projection write failure does not propagate to the emitter (R5, core-api-ofertas 'A projection write failure does not propagate to the emitter')", () => {
    it('resolves without throwing when registrarOportunidad.execute() rejects, and logs the error', async () => {
      const useCase = buildUseCase();
      useCase.execute.mockRejectedValue(new Error('reemplazar failed'));
      const listener = new MatchEncontradoListener(useCase);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(listener.onMatchEncontrado({ payload })).resolves.toBeUndefined();

      expect(useCase.execute).toHaveBeenCalledWith(payload);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      errorSpy.mockRestore();
    });

    it('resolves without throwing and still logs when execute() rejects with a non-Error value', async () => {
      const useCase = buildUseCase();
      useCase.execute.mockRejectedValue('not-an-error-instance');
      const listener = new MatchEncontradoListener(useCase);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(listener.onMatchEncontrado({ payload })).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(1);

      errorSpy.mockRestore();
    });
  });

  describe('the happy path calls execute exactly once with the event payload', () => {
    it('calls registrarOportunidad.execute(event.payload) exactly once', async () => {
      const useCase = buildUseCase();
      useCase.execute.mockResolvedValue(undefined);
      const listener = new MatchEncontradoListener(useCase);

      await listener.onMatchEncontrado({ payload });

      expect(useCase.execute).toHaveBeenCalledTimes(1);
      expect(useCase.execute).toHaveBeenCalledWith(payload);
    });
  });

  describe("RefillCreado alone creates no opportunity (D2, core-api-ofertas 'RefillCreado alone creates no opportunity') — structural inspection across the whole adapters/events/ surface, not just this file", () => {
    it('exposes exactly one @OnEvent-decorated method on MatchEncontradoListener, registered on refill.match_encontrado only', () => {
      const prototype = MatchEncontradoListener.prototype as unknown as Record<string, object>;
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

      // If a second handler existed (e.g. an @OnEvent('refill.creado') one),
      // it would show up here as a 2nd entry — this assertion fails
      // structurally, not because "we didn't write one".
      expect(eventHandlers).toHaveLength(1);
      expect(eventHandlers[0]!.metadata).toEqual([
        { event: 'refill.match_encontrado', options: undefined },
      ]);
    });

    it('confirms no @OnEvent handler for refill.creado exists anywhere on the class prototype', () => {
      const prototype = MatchEncontradoListener.prototype as unknown as Record<string, object>;
      const methodNames = Object.getOwnPropertyNames(prototype).filter(
        (name) => name !== 'constructor',
      );

      const refillCreadoHandlers = methodNames.filter((name) => {
        const method = prototype[name]!;
        const metadata = Reflect.getMetadata(EVENT_LISTENER_METADATA_KEY, method) as
          Array<{ event: string; options: unknown }> | undefined;
        return metadata?.some((entry) => entry.event === 'refill.creado') ?? false;
      });

      expect(refillCreadoHandlers).toHaveLength(0);
    });
  });
});
