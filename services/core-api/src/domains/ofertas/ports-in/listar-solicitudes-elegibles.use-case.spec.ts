import type { SolicitudElegible } from '@repon/types';
import { TRANSACTION_MANAGER } from '../../../shared/database/transaction';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../ports-out/offer-opportunity-repository.port';
import { ListarSolicitudesElegiblesUseCase } from './listar-solicitudes-elegibles.use-case';

// core-api-ofertas spec: "listarSolicitudesElegibles is scoped to the
// actor's own companyId and excludes closed opportunities" (design.md
// Diagrama 3) + "TRANSACTION_MANAGER is injected only in the 4 write use
// cases; never in the 2 reads" (D13) — this use case's own half of that
// Scenario ("The two read use cases have no transaction manager injected");
// `obtenerBandeja` is the other half, Phase 7a. `companyId` MUST be derived
// only from the actor argument this use case receives — there is no DTO
// input at all (design.md D11/Diagrama 3: `@Roles('provider')` +
// `actor.companyId`, never a query/body param).
//
// Written in tasks.md's literal order: 4b.1 (RED) before 4b.2 (GREEN).

// NestJS stores every `@Inject(TOKEN)`-decorated constructor parameter's
// token under this Reflect metadata key (`SELF_DECLARED_DEPS_METADATA` in
// `@nestjs/common/constants.ts`). Same technique
// `BuscarProveedoresCompatiblesUseCase`'s spec (refill-matching PR5a) and
// `ProcesarConsumosVencidosUseCase`'s spec (consumo) already established for
// this exact structural guarantee — hardcoded here rather than importing
// the package's internal subpath, to stay decoupled from an undocumented
// Nest internal import path while still proving the real DI wiring
// structurally (tasks.md 4b.1, D13).
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

function buildOfferOpportunityRepository(): jest.Mocked<OfferOpportunityRepository> {
  return {
    reemplazar: jest.fn(),
    findElegible: jest.fn(),
    listarPorCompany: jest.fn(),
    existeRelacion: jest.fn(),
    cerrar: jest.fn(),
  };
}

function buildUseCase() {
  const offerOpportunityRepository = buildOfferOpportunityRepository();
  const useCase = new ListarSolicitudesElegiblesUseCase(offerOpportunityRepository);
  return { offerOpportunityRepository, useCase };
}

function solicitudFixture(overrides: Partial<SolicitudElegible> = {}): SolicitudElegible {
  return {
    refillRequestId: 'refill-1',
    comuna: 'Las Condes',
    urgencia: 'hoy',
    matchedAt: '2026-08-01T00:00:00.000Z',
    items: [
      {
        refillItemId: 'item-1',
        nombre: 'Alimento perro',
        categoria: 'mascotas',
        precioReferencia: 15990,
        catalogProductId: 'cat-1',
      },
    ],
    ...overrides,
  };
}

describe('ListarSolicitudesElegiblesUseCase', () => {
  // tasks.md 4b.1 — the constructor-inspection test (D13's structural
  // guarantee, first half of core-api-ofertas' "The two read use cases have
  // no transaction manager injected").
  describe(
    'The two read use cases have no transaction manager injected (D13, core-api-ofertas ' +
      "'The two read use cases have no transaction manager injected' — first half; " +
      'obtenerBandeja is the other half, Phase 7a)',
    () => {
      it('el constructor inyecta EXACTAMENTE OFFER_OPPORTUNITY_REPOSITORY — nunca TRANSACTION_MANAGER', () => {
        const injectedTokens: Array<{ index: number; param: unknown }> =
          Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, ListarSolicitudesElegiblesUseCase) ?? [];

        expect(injectedTokens).toHaveLength(1);
        const tokens = injectedTokens.map((dep) => dep.param);
        expect(tokens).not.toContain(TRANSACTION_MANAGER);
        expect(tokens).toEqual(expect.arrayContaining([OFFER_OPPORTUNITY_REPOSITORY]));
      });
    },
  );

  // tasks.md 4b.1 — companyId derives only from the actor argument, no DTO.
  describe('companyId is the only input, and it is derived from the actor — never a DTO', () => {
    it('calls listarPorCompany(companyId) exactly once with the given companyId and returns its result unmodified', async () => {
      const { offerOpportunityRepository, useCase } = buildUseCase();
      const solicitudes = [solicitudFixture(), solicitudFixture({ refillRequestId: 'refill-2' })];
      offerOpportunityRepository.listarPorCompany.mockResolvedValue(solicitudes);

      const result = await useCase.execute('company-a');

      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenCalledTimes(1);
      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenCalledWith('company-a');
      expect(result).toBe(solicitudes);
    });

    it('a different companyId argument is passed through untouched — no transformation, no default', async () => {
      const { offerOpportunityRepository, useCase } = buildUseCase();
      offerOpportunityRepository.listarPorCompany.mockResolvedValue([]);

      await useCase.execute('company-b');

      expect(offerOpportunityRepository.listarPorCompany).toHaveBeenCalledWith('company-b');
    });
  });

  describe('an empty eligibility set returns [], never throws (core-api-ofertas Diagrama 3)', () => {
    it('returns [] when the company has zero currently-eligible solicitudes', async () => {
      const { offerOpportunityRepository, useCase } = buildUseCase();
      offerOpportunityRepository.listarPorCompany.mockResolvedValue([]);

      await expect(useCase.execute('company-a')).resolves.toEqual([]);
    });
  });
});
