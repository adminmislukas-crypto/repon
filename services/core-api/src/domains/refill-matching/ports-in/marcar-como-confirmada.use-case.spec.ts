import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';
import { MarcarComoConfirmadaUseCase } from './marcar-como-confirmada.use-case';

// core-api-refill-matching spec / design.md D6: `marcarComoConfirmada` is a
// trivial `actualizarEstado` wrapper — same shape and same rationale as its
// sibling `MarcarComoOfertadaUseCase`, see that file's own doc comment for
// the full "no HTTP surface, no caller, mirrors consumo's
// adherenciaUltimos7Dias precedent" explanation. The 2 domain-wide
// structural checks ("neither is HTTP-reachable", "neither has a caller
// anywhere in this domain") are NOT duplicated here — they already assert
// facts about BOTH use cases at once and live in
// `marcar-como-ofertada.use-case.spec.ts`'s
// "Neither marcarComoOfertada nor marcarComoConfirmada..." describe block.
//
// `SELF_DECLARED_DEPS_METADATA` hardcoded here for the same reason 5a.6/6a.4/
// this file's sibling spec already document: decoupled from `@nestjs/common`'s
// undocumented internal `constants` subpath while still proving the real DI
// wiring structurally.
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

function buildRefillRepository(): jest.Mocked<RefillRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findBorradorByConsumption: jest.fn(),
    actualizarEstado: jest.fn(),
  };
}

describe('MarcarComoConfirmadaUseCase', () => {
  // tasks.md 7.1 — happy path.
  it("execute(refillRequestId) calls actualizarEstado(refillRequestId, 'confirmada') exactly once", async () => {
    const refillRepository = buildRefillRepository();
    const useCase = new MarcarComoConfirmadaUseCase(refillRepository);

    await useCase.execute('refill-1');

    expect(refillRepository.actualizarEstado).toHaveBeenCalledTimes(1);
    expect(refillRepository.actualizarEstado).toHaveBeenCalledWith('refill-1', 'confirmada');
  });

  // tasks.md 7.1 — constructor-inspection test.
  it('constructor injects ONLY REFILL_REPOSITORY — no EVENT_PUBLISHER, no AuditLogPort (D16)', () => {
    const injectedTokens: Array<{ index: number; param: unknown }> =
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, MarcarComoConfirmadaUseCase) ?? [];

    expect(injectedTokens).toHaveLength(1);
    expect(injectedTokens[0]?.param).toBe(REFILL_REPOSITORY);
  });
});
