import type { Offer } from '@repon/types';
import { TRANSACTION_MANAGER } from '../../../shared/database/transaction';
import { OFFER_REPOSITORY, type OfferRepository } from '../ports-out/offer-repository.port';
import { ObtenerBandejaUseCase } from './obtener-bandeja.use-case';

// core-api-ofertas spec: "obtenerBandeja never returns another user's
// offers" + "The bandeja includes items without a second request" + D13
// ("The two read use cases have no transaction manager injected" --
// `listarSolicitudesElegibles` is the other half, PR4b). `profileId` is the
// ONLY input, and it always comes from `actor.profileId` at the controller
// boundary (D11) -- this use case has no DTO of its own to accept one.
//
// Written in tasks.md's literal order: 7a.8 (RED) before 7a.9 (GREEN).

const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

function buildOfferRepository(): jest.Mocked<OfferRepository> {
  return {
    save: jest.fn(),
    findByUser: jest.fn(),
    findByRefillRequest: jest.fn(),
    findById: jest.fn(),
    marcarAceptada: jest.fn(),
    desplazarHermanas: jest.fn(),
  };
}

function buildUseCase() {
  const offerRepository = buildOfferRepository();
  const useCase = new ObtenerBandejaUseCase(offerRepository);
  return { offerRepository, useCase };
}

function offerFixture(overrides: Partial<Extract<Offer, { kind: 'reactiva' }>> = {}): Offer {
  return {
    id: 'offer-a',
    userId: 'user-a',
    companyId: 'company-a',
    status: 'pendiente',
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    total: 13990,
    kind: 'reactiva',
    refillRequestId: 'refill-request-a',
    items: [{ refillItemId: 'item-a', precio: 11990, isAlt: false }],
    ...overrides,
  };
}

describe('ObtenerBandejaUseCase', () => {
  // tasks.md 7a.8 — completes D13's Scenario, second half of 4b.1.
  describe(
    'The two read use cases have no transaction manager injected (D13, core-api-ofertas ' +
      "'The two read use cases have no transaction manager injected' -- second half; " +
      'listarSolicitudesElegibles is the other half, PR4b)',
    () => {
      it('el constructor inyecta EXACTAMENTE OFFER_REPOSITORY — nunca TRANSACTION_MANAGER', () => {
        const injectedTokens: Array<{ index: number; param: unknown }> =
          Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, ObtenerBandejaUseCase) ?? [];

        expect(injectedTokens).toHaveLength(1);
        const tokens = injectedTokens.map((dep) => dep.param);
        expect(tokens).not.toContain(TRANSACTION_MANAGER);
        expect(tokens).toEqual(expect.arrayContaining([OFFER_REPOSITORY]));
      });
    },
  );

  // tasks.md 7a.8 — returns only the actor's own offers.
  describe("obtenerBandeja never returns another user's offers", () => {
    it('calls findByUser(profileId) exactly once with the given profileId and returns its result unmodified', async () => {
      const { offerRepository, useCase } = buildUseCase();
      const offers = [offerFixture(), offerFixture({ id: 'offer-b' })];
      offerRepository.findByUser.mockResolvedValue(offers);

      const result = await useCase.execute('user-a');

      expect(offerRepository.findByUser).toHaveBeenCalledTimes(1);
      expect(offerRepository.findByUser).toHaveBeenCalledWith('user-a');
      expect(result).toBe(offers);
    });

    it('a different profileId argument is passed through untouched — no transformation, no default', async () => {
      const { offerRepository, useCase } = buildUseCase();
      offerRepository.findByUser.mockResolvedValue([]);

      await useCase.execute('user-b');

      expect(offerRepository.findByUser).toHaveBeenCalledWith('user-b');
    });
  });

  // tasks.md 7a.8 — items inline, no second request.
  describe('The bandeja includes items without a second request', () => {
    it("returns Offer[] with items already inline — findByUser's own contract (Phase 3a), no per-offer follow-up call", async () => {
      const { offerRepository, useCase } = buildUseCase();
      const offers = [
        offerFixture({ items: [{ refillItemId: 'item-a', precio: 11990, isAlt: false }] }),
      ];
      offerRepository.findByUser.mockResolvedValue(offers);

      const result = await useCase.execute('user-a');

      expect(result[0].items).toEqual(offers[0].items);
      expect(offerRepository.findByUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('an empty tray returns [], never throws', () => {
    it('returns [] when the actor has zero offers', async () => {
      const { offerRepository, useCase } = buildUseCase();
      offerRepository.findByUser.mockResolvedValue([]);

      await expect(useCase.execute('user-a')).resolves.toEqual([]);
    });
  });
});
