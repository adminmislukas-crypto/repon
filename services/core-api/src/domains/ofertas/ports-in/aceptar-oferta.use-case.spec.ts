import type { Offer, OfferStatus } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import {
  OfertaYaAceptadaError,
  OfferNotFoundError,
  TransicionInvalidaError,
} from '../domain/oferta.errors';
import { OfertaAceptada } from '../events/oferta-aceptada.event';
import type { OfferOpportunityRepository } from '../ports-out/offer-opportunity-repository.port';
import type { OfferRepository } from '../ports-out/offer-repository.port';
import { AceptarOfertaUseCase } from './aceptar-oferta.use-case';

// design.md D-D — `aceptarOferta`: TRES escrituras, UNA transacción
// (findById -> 404/409 checks -> marcarAceptada -> [reactiva: desplazarHermanas
// + cerrar]), TODO dentro de un único `runInTransaction`, a diferencia del
// patrón "catálogo afuera, tx adentro" de `EnviarOfertaUseCase` (PR5a): acá
// no hay ningún puerto ajeno que resolver antes de abrir la transacción, así
// que no existe una razón estructural para dejar nada afuera. Written per
// D18: tasks.md 7a.2 (D18-2, mandatory) is RED first, then 7a.3-7a.6 extend
// the same spec file, one GREEN implementation (7a.7) afterward.

const fakeTx = {} as TransactionContext;

type OfferReactiva = Extract<Offer, { kind: 'reactiva' }>;
type OfferProactiva = Extract<Offer, { kind: 'proactiva' }>;

function buildOfferRepository(): jest.Mocked<OfferRepository> {
  return {
    save: jest.fn(),
    findByUser: jest.fn(),
    findByRefillRequest: jest.fn(),
    findById: jest.fn(),
    marcarAceptada: jest.fn().mockResolvedValue(undefined),
    desplazarHermanas: jest.fn().mockResolvedValue([]),
  };
}

function buildOpportunityRepository(): jest.Mocked<OfferOpportunityRepository> {
  return {
    reemplazar: jest.fn(),
    findElegible: jest.fn(),
    listarPorCompany: jest.fn(),
    existeRelacion: jest.fn(),
    cerrar: jest.fn().mockResolvedValue(undefined),
  };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildUseCase() {
  const offerRepository = buildOfferRepository();
  const opportunityRepository = buildOpportunityRepository();
  const transactionManager = buildTransactionManager();
  const eventPublisher = buildEventPublisher();
  const useCase = new AceptarOfertaUseCase(
    offerRepository,
    opportunityRepository,
    transactionManager,
    eventPublisher,
  );
  return { offerRepository, opportunityRepository, transactionManager, eventPublisher, useCase };
}

function offerReactivaFixture(overrides: Partial<OfferReactiva> = {}): OfferReactiva {
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

function offerProactivaFixture(overrides: Partial<OfferProactiva> = {}): OfferProactiva {
  return {
    id: 'offer-b',
    userId: 'user-a',
    companyId: 'company-a',
    status: 'pendiente',
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    total: 13990,
    kind: 'proactiva',
    items: [{ providerCatalogItemId: 'catalog-item-a', precio: 11990, isAlt: false }],
    ...overrides,
  };
}

describe('AceptarOfertaUseCase', () => {
  // tasks.md 7a.2 — D18-2, mandatory negative, written FIRST.
  describe(
    "D18-2: user A cannot accept user B's offer -- 404 byte-identical to a nonexistent offerId " +
      '(design.md D-D paso 1, core-api-ofertas Scenarios "User A cannot accept user B\'s offer" / ' +
      '"A nonexistent offerId is rejected with the same 404")',
    () => {
      it('throws OfferNotFoundError when findById resolves null (nonexistent offerId)', async () => {
        const { offerRepository, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(null);

        await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(OfferNotFoundError);
      });

      it('throws OfferNotFoundError when the offer exists but belongs to another user', async () => {
        const { offerRepository, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerReactivaFixture({ userId: 'user-b' }));

        await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(OfferNotFoundError);
      });

      it(
        'produces the byte-identical error (class, message) whether the offer does not exist or ' +
          'belongs to another user -- ONE branch (found === null || found.userId !== profileId), ' +
          'never two divergent branches that happen to produce the same output',
        async () => {
          const { offerRepository, useCase } = buildUseCase();

          offerRepository.findById.mockResolvedValueOnce(null);
          let notFoundError: unknown;
          try {
            await useCase.execute('user-a', 'offer-a');
          } catch (error) {
            notFoundError = error;
          }

          offerRepository.findById.mockResolvedValueOnce(
            offerReactivaFixture({ id: 'offer-a', userId: 'user-b' }),
          );
          let crossTenantError: unknown;
          try {
            await useCase.execute('user-a', 'offer-a');
          } catch (error) {
            crossTenantError = error;
          }

          expect(notFoundError).toBeInstanceOf(OfferNotFoundError);
          expect(crossTenantError).toBeInstanceOf(OfferNotFoundError);
          expect((crossTenantError as Error).name).toBe((notFoundError as Error).name);
          expect((crossTenantError as Error).message).toBe((notFoundError as Error).message);
        },
      );

      it('never calls marcarAceptada/desplazarHermanas/cerrar/publish when the offer is not found or not owned', async () => {
        const { offerRepository, opportunityRepository, eventPublisher, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(null);

        await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(OfferNotFoundError);

        expect(offerRepository.marcarAceptada).not.toHaveBeenCalled();
        expect(offerRepository.desplazarHermanas).not.toHaveBeenCalled();
        expect(opportunityRepository.cerrar).not.toHaveBeenCalled();
        expect(eventPublisher.publish).not.toHaveBeenCalled();
      });
    },
  );

  // tasks.md 7a.3 — D-G.3, extend. `aceptar()` (Phase 2) is the state-machine
  // validator; the use case calls it BETWEEN findById and marcarAceptada.
  describe(
    "D-G.3: an owned, existing offer whose own status is not 'pendiente' is rejected with 409 " +
      '(via aceptar(), Phase 2) -- checked AFTER ownership, never before',
    () => {
      it.each<OfferStatus>(['aceptada', 'rechazada', 'expirada'])(
        "throws TransicionInvalidaError when the offer's own status is '%s'",
        async (status) => {
          const { offerRepository, useCase } = buildUseCase();
          offerRepository.findById.mockResolvedValue(offerReactivaFixture({ status }));

          await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(
            TransicionInvalidaError,
          );
        },
      );

      it('never calls marcarAceptada/desplazarHermanas/cerrar/publish when the transition is invalid -- rejected before any write', async () => {
        const { offerRepository, opportunityRepository, eventPublisher, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerReactivaFixture({ status: 'aceptada' }));

        await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(TransicionInvalidaError);

        expect(offerRepository.marcarAceptada).not.toHaveBeenCalled();
        expect(offerRepository.desplazarHermanas).not.toHaveBeenCalled();
        expect(opportunityRepository.cerrar).not.toHaveBeenCalled();
        expect(eventPublisher.publish).not.toHaveBeenCalled();
      });
    },
  );

  // tasks.md 7a.4 — D12, extend. A tested branch, not a dead one.
  describe(
    'D12: accepting a proactive offer (refillRequestId: null) displaces nothing and closes ' +
      'nothing (core-api-ofertas Scenario "Accepting a proactive offer displaces nothing and ' +
      'closes nothing")',
    () => {
      it('calls marcarAceptada but NEITHER desplazarHermanas NOR cerrar for a proactiva offer', async () => {
        const { offerRepository, opportunityRepository, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerProactivaFixture({ id: 'offer-b' }));

        await useCase.execute('user-a', 'offer-b');

        expect(offerRepository.marcarAceptada).toHaveBeenCalledWith('offer-b', fakeTx);
        expect(offerRepository.desplazarHermanas).not.toHaveBeenCalled();
        expect(opportunityRepository.cerrar).not.toHaveBeenCalled();
      });

      it('publishes OfertaAceptada with refillRequestId: null and desplazadas: [] for a proactiva offer', async () => {
        const { offerRepository, eventPublisher, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(
          offerProactivaFixture({
            id: 'offer-b',
            companyId: 'company-a',
            userId: 'user-a',
            total: 13990,
          }),
        );

        await useCase.execute('user-a', 'offer-b');

        expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
        const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaAceptada];
        expect(publishedEvent).toBeInstanceOf(OfertaAceptada);
        expect(publishedEvent.type).toBe('ofertas.oferta_aceptada');
        expect(publishedEvent.payload).toEqual({
          offerId: 'offer-b',
          companyId: 'company-a',
          userId: 'user-a',
          refillRequestId: null,
          total: 13990,
          desplazadas: [],
        });
      });
    },
  );

  // tasks.md 7a.5 — D12, extend.
  describe(
    'D12: accepting a reactive offer with 2 pending siblings displaces exactly those 2 and ' +
      'closes the opportunity (core-api-ofertas Scenario "Accepting a reactive offer displaces ' +
      'its siblings and closes the opportunity")',
    () => {
      it('calls desplazarHermanas(refillRequestId, offerId, tx) and cerrar(refillRequestId, tx) for a reactiva offer', async () => {
        const { offerRepository, opportunityRepository, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(
          offerReactivaFixture({ id: 'offer-a', refillRequestId: 'refill-request-a' }),
        );
        offerRepository.desplazarHermanas.mockResolvedValue(['sibling-b', 'sibling-c']);

        await useCase.execute('user-a', 'offer-a');

        expect(offerRepository.marcarAceptada).toHaveBeenCalledWith('offer-a', fakeTx);
        expect(offerRepository.desplazarHermanas).toHaveBeenCalledWith(
          'refill-request-a',
          'offer-a',
          fakeTx,
        );
        expect(opportunityRepository.cerrar).toHaveBeenCalledWith('refill-request-a', fakeTx);
      });

      it(
        "OfertaAceptada's desplazadas equals EXACTLY what desplazarHermanas returned " +
          '(core-api-ofertas Scenario "OfertaAceptada\'s desplazadas lists exactly the displaced ' +
          'offerIds") -- no separate computation in the use case',
        async () => {
          const { offerRepository, eventPublisher, useCase } = buildUseCase();
          offerRepository.findById.mockResolvedValue(
            offerReactivaFixture({
              id: 'offer-a',
              refillRequestId: 'refill-request-a',
              companyId: 'company-a',
              userId: 'user-a',
              total: 13990,
            }),
          );
          offerRepository.desplazarHermanas.mockResolvedValue(['sibling-b', 'sibling-c']);

          await useCase.execute('user-a', 'offer-a');

          const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaAceptada];
          expect(publishedEvent.payload).toEqual({
            offerId: 'offer-a',
            companyId: 'company-a',
            userId: 'user-a',
            refillRequestId: 'refill-request-a',
            total: 13990,
            desplazadas: ['sibling-b', 'sibling-c'],
          });
        },
      );
    },
  );

  // tasks.md 7a.6 — R4, extend. Translated in the ADAPTER (Phase 3a), never
  // in this use case: a domain error simply propagates uncaught.
  describe(
    'R4: OfertaYaAceptadaError propagates out of the transaction as a domain error, never ' +
      'wrapped or swallowed (core-api-ofertas Scenario "A double-tap race maps to 409, never 500" ' +
      "-- the HTTP mapping itself is Phase 7b's job)",
    () => {
      it('propagates OfertaYaAceptadaError uncaught when marcarAceptada rejects with it', async () => {
        const { offerRepository, eventPublisher, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerReactivaFixture());
        offerRepository.marcarAceptada.mockRejectedValue(new OfertaYaAceptadaError('offer-a'));

        await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(OfertaYaAceptadaError);

        expect(eventPublisher.publish).not.toHaveBeenCalled();
      });

      it('never calls desplazarHermanas/cerrar when marcarAceptada itself rejects', async () => {
        const { offerRepository, opportunityRepository, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerReactivaFixture());
        offerRepository.marcarAceptada.mockRejectedValue(new OfertaYaAceptadaError('offer-a'));

        await expect(useCase.execute('user-a', 'offer-a')).rejects.toThrow(OfertaYaAceptadaError);

        expect(offerRepository.desplazarHermanas).not.toHaveBeenCalled();
        expect(opportunityRepository.cerrar).not.toHaveBeenCalled();
      });
    },
  );

  // Non-tasks.md-numbered, added for parity with EnviarOfertaUseCase's own
  // "happy path" coverage (mirrors 5a.8's publish-after-commit assertion) --
  // flagged explicitly in apply-progress.md rather than silently absorbed.
  describe(
    'The transaction shape: everything (findById through the displacement) happens INSIDE ONE ' +
      'runInTransaction call, and publish only happens AFTER it resolves (commit)',
    () => {
      it('calls runInTransaction exactly once, and findById receives the SAME tx the transaction handed out', async () => {
        const { offerRepository, transactionManager, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerReactivaFixture());

        await useCase.execute('user-a', 'offer-a');

        expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
        expect(offerRepository.findById).toHaveBeenCalledWith('offer-a', fakeTx);
      });

      it('publishes OfertaAceptada only AFTER the transaction (marcarAceptada) resolves', async () => {
        const { offerRepository, eventPublisher, useCase } = buildUseCase();
        offerRepository.findById.mockResolvedValue(offerReactivaFixture());

        const orden: string[] = [];
        offerRepository.marcarAceptada.mockImplementation(async () => {
          orden.push('marcarAceptada:resuelto');
        });
        eventPublisher.publish.mockImplementation(async () => {
          orden.push('publish:llamado');
        });

        await useCase.execute('user-a', 'offer-a');

        expect(orden).toEqual(['marcarAceptada:resuelto', 'publish:llamado']);
      });
    },
  );
});
