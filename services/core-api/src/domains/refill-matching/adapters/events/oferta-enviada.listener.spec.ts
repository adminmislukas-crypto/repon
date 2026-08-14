import { Logger } from '@nestjs/common';
import type { MarcarComoOfertadaUseCase } from '../../ports-in/marcar-como-ofertada.use-case';
import type { OfertaEnviadaPayload } from './ofertas-event.payloads';
import { OfertaEnviadaListener } from './oferta-enviada.listener';

// design.md D-F/D7, tasks.md 8a.2 — D18-3, ONE OF THE 5 MANDATORY NEGATIVE
// TESTS for the whole `backend-core-api-ofertas` change (also carries D18-5
// for this listener: "Neither listener re-throws back into ofertas").
// `core-api-refill-matching` spec scenarios: "A proactive OfertaEnviada does
// not call marcarComoOfertada" / "A reactive OfertaEnviada calls
// marcarComoOfertada exactly once" / "Neither listener re-throws back into
// ofertas". Same shape `match-encontrado.listener.spec.ts` (`ofertas`) and
// `refill-auto-solicitado.listener.spec.ts` (`refill-matching`'s own PR6a)
// already established — mocked use case, no Nest container needed.

function buildUseCase(): jest.Mocked<MarcarComoOfertadaUseCase> {
  return { execute: jest.fn() } as unknown as jest.Mocked<MarcarComoOfertadaUseCase>;
}

const proactivaPayload: OfertaEnviadaPayload = {
  offerId: 'offer-proactiva-a',
  refillRequestId: null,
};

const reactivaPayload: OfertaEnviadaPayload = {
  offerId: 'offer-reactiva-a',
  refillRequestId: 'refill-request-a',
};

describe('OfertaEnviadaListener', () => {
  describe(
    'a proactive OfertaEnviada does not call marcarComoOfertada (core-api-refill-matching ' +
      '"A proactive OfertaEnviada does not call marcarComoOfertada")',
    () => {
      it('does NOT call marcarComoOfertadaUseCase.execute when refillRequestId is null', async () => {
        const useCase = buildUseCase();
        const listener = new OfertaEnviadaListener(useCase);

        await listener.onOfertaEnviada({ payload: proactivaPayload });

        expect(useCase.execute).not.toHaveBeenCalled();
      });
    },
  );

  describe(
    'a reactive OfertaEnviada calls marcarComoOfertada exactly once (core-api-refill-matching ' +
      '"A reactive OfertaEnviada calls marcarComoOfertada exactly once")',
    () => {
      it('calls marcarComoOfertadaUseCase.execute(refillRequestId) exactly once', async () => {
        const useCase = buildUseCase();
        useCase.execute.mockResolvedValue(undefined);
        const listener = new OfertaEnviadaListener(useCase);

        await listener.onOfertaEnviada({ payload: reactivaPayload });

        expect(useCase.execute).toHaveBeenCalledTimes(1);
        expect(useCase.execute).toHaveBeenCalledWith('refill-request-a');
      });
    },
  );

  describe(
    'neither listener re-throws back into ofertas (D18-5, core-api-refill-matching ' +
      '"Neither listener re-throws back into ofertas")',
    () => {
      it('resolves without throwing when execute() rejects, and logs the error', async () => {
        const useCase = buildUseCase();
        useCase.execute.mockRejectedValue(new Error('actualizarEstado failed'));
        const listener = new OfertaEnviadaListener(useCase);
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        await expect(
          listener.onOfertaEnviada({ payload: reactivaPayload }),
        ).resolves.toBeUndefined();

        expect(useCase.execute).toHaveBeenCalledWith('refill-request-a');
        expect(errorSpy).toHaveBeenCalledTimes(1);

        errorSpy.mockRestore();
      });

      it('resolves without throwing and still logs when execute() rejects with a non-Error value', async () => {
        const useCase = buildUseCase();
        useCase.execute.mockRejectedValue('not-an-error-instance');
        const listener = new OfertaEnviadaListener(useCase);
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        await expect(
          listener.onOfertaEnviada({ payload: reactivaPayload }),
        ).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledTimes(1);

        errorSpy.mockRestore();
      });
    },
  );
});
