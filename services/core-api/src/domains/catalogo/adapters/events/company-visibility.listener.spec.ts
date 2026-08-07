import { Logger } from '@nestjs/common';
import type { OcultarCatalogoEmpresaUseCase } from '../../ports-in/ocultar-catalogo-empresa.use-case';
import type { RestaurarCatalogoEmpresaUseCase } from '../../ports-in/restaurar-catalogo-empresa.use-case';
import { CompanyVisibilityListener } from './company-visibility.listener';
import type { EmpresaOcultablePayload } from './identidad-event.payloads';

// design.md D-A: routes THREE channels to TWO use cases —
// `empresa.suspendida` -> OcultarCatalogoEmpresaUseCase,
// `empresa.reactivada`/`empresa.aprobada` -> the SAME
// RestaurarCatalogoEmpresaUseCase (Diagram 2's "MISMO handler" note, since
// `AprobarEmpresaUseCase` has no state precondition and can also move a
// company out of `'suspendido'`). Every handler catches everything,
// `logger.error({ evento, companyId })`, and NEVER re-throws —
// `EventEmitterPublisher.publish` uses `emitAsync`, so a rejecting
// listener here would propagate back into the PRODUCER's `publish()` call
// and turn an already-committed mutation into a 5xx.
//
// Unit-tested directly against the handler methods (bypassing Nest's
// `@OnEvent` wiring, which is metadata-only and has nothing to assert at
// this layer) — the mandatory Phase 8b contract test is what proves the
// real `EVENT_PUBLISHER` actually routes real `identidad` events here.

function buildUseCases() {
  const ocultarCatalogoEmpresaUseCase = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<OcultarCatalogoEmpresaUseCase>;
  const restaurarCatalogoEmpresaUseCase = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<RestaurarCatalogoEmpresaUseCase>;
  return { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase };
}

describe('CompanyVisibilityListener', () => {
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('empresa.suspendida -> OcultarCatalogoEmpresaUseCase', () => {
    it('calls execute with companyId and motivo', async () => {
      const { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase } = buildUseCases();
      const listener = new CompanyVisibilityListener(
        ocultarCatalogoEmpresaUseCase,
        restaurarCatalogoEmpresaUseCase,
      );
      const payload: EmpresaOcultablePayload = { companyId: 'company-a', motivo: 'Pago vencido' };

      await listener.onEmpresaSuspendida(payload);

      expect(ocultarCatalogoEmpresaUseCase.execute).toHaveBeenCalledWith(
        'company-a',
        'Pago vencido',
      );
      expect(restaurarCatalogoEmpresaUseCase.execute).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('normalizes an absent motivo to null', async () => {
      const { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase } = buildUseCases();
      const listener = new CompanyVisibilityListener(
        ocultarCatalogoEmpresaUseCase,
        restaurarCatalogoEmpresaUseCase,
      );

      await listener.onEmpresaSuspendida({ companyId: 'company-a' });

      expect(ocultarCatalogoEmpresaUseCase.execute).toHaveBeenCalledWith('company-a', null);
    });

    it('catches a rejection, logs { evento, companyId }, and never re-throws (fail-open, R4)', async () => {
      const { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase } = buildUseCases();
      ocultarCatalogoEmpresaUseCase.execute.mockRejectedValueOnce(new Error('db unreachable'));
      const listener = new CompanyVisibilityListener(
        ocultarCatalogoEmpresaUseCase,
        restaurarCatalogoEmpresaUseCase,
      );

      await expect(
        listener.onEmpresaSuspendida({ companyId: 'company-a', motivo: 'x' }),
      ).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'empresa.suspendida', companyId: 'company-a' }),
        expect.anything(),
      );
    });
  });

  describe('empresa.reactivada / empresa.aprobada -> RestaurarCatalogoEmpresaUseCase (SAME handler)', () => {
    it('empresa.reactivada calls execute with companyId', async () => {
      const { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase } = buildUseCases();
      const listener = new CompanyVisibilityListener(
        ocultarCatalogoEmpresaUseCase,
        restaurarCatalogoEmpresaUseCase,
      );

      await listener.onEmpresaReactivada({ companyId: 'company-a', motivo: 'Regularizada' });

      expect(restaurarCatalogoEmpresaUseCase.execute).toHaveBeenCalledWith('company-a');
      expect(ocultarCatalogoEmpresaUseCase.execute).not.toHaveBeenCalled();
    });

    it('empresa.aprobada calls the SAME execute path as empresa.reactivada (not redundant, D-A: AprobarEmpresaUseCase has no state precondition)', async () => {
      const { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase } = buildUseCases();
      const listener = new CompanyVisibilityListener(
        ocultarCatalogoEmpresaUseCase,
        restaurarCatalogoEmpresaUseCase,
      );

      await listener.onEmpresaAprobada({ companyId: 'company-a' });

      expect(restaurarCatalogoEmpresaUseCase.execute).toHaveBeenCalledWith('company-a');
      expect(ocultarCatalogoEmpresaUseCase.execute).not.toHaveBeenCalled();
    });

    it('catches a rejection from either channel, logs { evento, companyId }, and never re-throws', async () => {
      const { ocultarCatalogoEmpresaUseCase, restaurarCatalogoEmpresaUseCase } = buildUseCases();
      restaurarCatalogoEmpresaUseCase.execute.mockRejectedValueOnce(new Error('db unreachable'));
      const listener = new CompanyVisibilityListener(
        ocultarCatalogoEmpresaUseCase,
        restaurarCatalogoEmpresaUseCase,
      );

      await expect(listener.onEmpresaAprobada({ companyId: 'company-a' })).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'empresa.aprobada', companyId: 'company-a' }),
        expect.anything(),
      );
    });
  });
});
