import { Logger } from '@nestjs/common';
import type { MarcarComoConfirmadaUseCase } from '../../ports-in/marcar-como-confirmada.use-case';
import type { OfertaAceptadaPayload } from './ofertas-event.payloads';
import { OfertaAceptadaListener } from './oferta-aceptada.listener';

// design.md D-F/D7, tasks.md 8a.4 — D18-3 continued (also carries D18-5).
// `core-api-refill-matching` spec scenarios: "A proactive OfertaAceptada
// does not call marcarComoConfirmada" / "A reactive OfertaAceptada calls
// marcarComoConfirmada exactly once" / "Neither listener re-throws back
// into ofertas" — identical shape to `oferta-enviada.listener.spec.ts`
// against `MarcarComoConfirmadaUseCase` and `'ofertas.oferta_aceptada'`.

function buildUseCase(): jest.Mocked<MarcarComoConfirmadaUseCase> {
  return { execute: jest.fn() } as unknown as jest.Mocked<MarcarComoConfirmadaUseCase>;
}

const proactivaPayload: OfertaAceptadaPayload = {
  offerId: 'offer-proactiva-b',
  refillRequestId: null,
};

const reactivaPayload: OfertaAceptadaPayload = {
  offerId: 'offer-reactiva-b',
  refillRequestId: 'refill-request-b',
};

describe('OfertaAceptadaListener', () => {
  describe(
    'a proactive OfertaAceptada does not call marcarComoConfirmada (core-api-refill-matching ' +
      '"A proactive OfertaAceptada does not call marcarComoConfirmada")',
    () => {
      it('does NOT call marcarComoConfirmadaUseCase.execute when refillRequestId is null', async () => {
        const useCase = buildUseCase();
        const listener = new OfertaAceptadaListener(useCase);

        await listener.onOfertaAceptada({ payload: proactivaPayload });

        expect(useCase.execute).not.toHaveBeenCalled();
      });
    },
  );

  describe(
    'a reactive OfertaAceptada calls marcarComoConfirmada exactly once (core-api-refill-matching ' +
      '"A reactive OfertaAceptada calls marcarComoConfirmada exactly once")',
    () => {
      it('calls marcarComoConfirmadaUseCase.execute(refillRequestId) exactly once', async () => {
        const useCase = buildUseCase();
        useCase.execute.mockResolvedValue(undefined);
        const listener = new OfertaAceptadaListener(useCase);

        await listener.onOfertaAceptada({ payload: reactivaPayload });

        expect(useCase.execute).toHaveBeenCalledTimes(1);
        expect(useCase.execute).toHaveBeenCalledWith('refill-request-b');
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
        const listener = new OfertaAceptadaListener(useCase);
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        await expect(
          listener.onOfertaAceptada({ payload: reactivaPayload }),
        ).resolves.toBeUndefined();

        expect(useCase.execute).toHaveBeenCalledWith('refill-request-b');
        expect(errorSpy).toHaveBeenCalledTimes(1);

        errorSpy.mockRestore();
      });

      it('resolves without throwing and still logs when execute() rejects with a non-Error value', async () => {
        const useCase = buildUseCase();
        useCase.execute.mockRejectedValue('not-an-error-instance');
        const listener = new OfertaAceptadaListener(useCase);
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        await expect(
          listener.onOfertaAceptada({ payload: reactivaPayload }),
        ).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledTimes(1);

        errorSpy.mockRestore();
      });
    },
  );
});
