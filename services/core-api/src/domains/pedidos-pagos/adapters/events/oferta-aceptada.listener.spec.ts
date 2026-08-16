import { Logger } from '@nestjs/common';
import type { CrearPedidoDesdeOfertaUseCase } from '../../ports-in/crear-pedido-desde-oferta.use-case';
import { OfertaAceptadaListener } from './oferta-aceptada.listener';
import type { OfertaAceptadaPayload } from './ofertas-event.payloads';

// design.md D3/D-F Diagrama 1 — el listener suscribe por nombre de canal
// string, tipa el payload con la interfaz LOCAL, y NUNCA re-lanza (R8): una
// falla acá no debe convertir la aceptación YA COMMITEADA de `ofertas` en
// un 5xx (emitAsync propaga rechazos de vuelta al publisher). Mismo patrón
// que `refill-matching/adapters/events/oferta-aceptada.listener.spec.ts`.

function buildUseCase(): jest.Mocked<CrearPedidoDesdeOfertaUseCase> {
  return { execute: jest.fn() } as unknown as jest.Mocked<CrearPedidoDesdeOfertaUseCase>;
}

const eventPayload: OfertaAceptadaPayload = {
  offerId: 'offer-1',
  companyId: 'company-1',
  userId: 'user-1',
  total: 14990,
  costoDespacho: 2000,
  lineas: [{ offerItemId: 'offer-item-1', nombre: 'Agua 20L', precio: 12990, isAlt: false }],
};

describe('OfertaAceptadaListener', () => {
  it('calls CrearPedidoDesdeOfertaUseCase.execute with the payload mapped to its input shape', async () => {
    const useCase = buildUseCase();
    useCase.execute.mockResolvedValue(undefined);
    const listener = new OfertaAceptadaListener(useCase);

    await listener.onOfertaAceptada({ payload: eventPayload });

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    expect(useCase.execute).toHaveBeenCalledWith({
      offerId: 'offer-1',
      userId: 'user-1',
      companyId: 'company-1',
      total: 14990,
      costoDespacho: 2000,
      lineas: eventPayload.lineas,
    });
  });

  // design.md D3/R8 — negativo obligatorio: el handler resuelve aunque el
  // caso de uso lance, y el error se loguea, nunca se propaga.
  it('resolves without throwing when execute() rejects, and logs the error', async () => {
    const useCase = buildUseCase();
    useCase.execute.mockRejectedValue(new Error('boom'));
    const listener = new OfertaAceptadaListener(useCase);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(listener.onOfertaAceptada({ payload: eventPayload })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('resolves without throwing and still logs when execute() rejects with a non-Error value', async () => {
    const useCase = buildUseCase();
    useCase.execute.mockRejectedValue('not-an-error-instance');
    const listener = new OfertaAceptadaListener(useCase);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(listener.onOfertaAceptada({ payload: eventPayload })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
