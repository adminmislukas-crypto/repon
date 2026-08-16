import type {
  DatosEntrega,
  NuevoOfferItemReactiva,
  ProviderCatalogItem,
  RefillItem,
} from '@repon/types';
import {
  CatalogQueryUnavailableError,
  type CatalogQueryPort,
} from '../../catalogo/contracts/catalog-query.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { NotificationPort } from '../../../shared/notifications/notification.port';
import {
  OfertaInvalidaError,
  OportunidadCerradaError,
  SolicitudNoElegibleError,
} from '../domain/oferta.errors';
import { OfertaEnviada } from '../events/oferta-enviada.event';
import type {
  OfferOpportunityRepository,
  OportunidadElegible,
} from '../ports-out/offer-opportunity-repository.port';
import type { OfferRepository } from '../ports-out/offer-repository.port';
import { EnviarOfertaUseCase } from './enviar-oferta.use-case';

// design.md Diagrama 2 (D8 + D11 + D13 + R3) — this use case's exact
// execution order, tasks.md Phase 5a: findElegible (sin tx) -> 404/409
// checks -> item-membership check -> buscarCoincidencias FUERA de toda
// transaccion -> regla dura + techo de precio -> total (dentro de la
// factory) -> runInTransaction{save} -> COMMIT -> publish + push. Written
// per D18: all RED first (tasks.md 5a.2-5a.8), one GREEN implementation
// (5a.9) afterward — genuinely strict TDD, not 7 separate RED/GREEN pairs.

const fakeTx = {} as TransactionContext;

function buildOpportunityRepository(): jest.Mocked<OfferOpportunityRepository> {
  return {
    reemplazar: jest.fn(),
    findElegible: jest.fn(),
    listarPorCompany: jest.fn(),
    existeRelacion: jest.fn(),
    cerrar: jest.fn(),
  };
}

function buildOfferRepository(): jest.Mocked<OfferRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findByUser: jest.fn(),
    findByRefillRequest: jest.fn(),
    findById: jest.fn(),
    marcarAceptada: jest.fn(),
    desplazarHermanas: jest.fn(),
  };
}

function buildCatalogQueryPort(): jest.Mocked<CatalogQueryPort> {
  return {
    buscarCoincidencias: jest.fn().mockResolvedValue([]),
    // PR6a additive delta (D-B) — unused by this use case, present only to
    // satisfy the interface's strict `jest.Mocked<CatalogQueryPort>` shape.
    obtenerItemsDeProveedor: jest.fn().mockResolvedValue([]),
  };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildNotificationPort(): jest.Mocked<NotificationPort> {
  return { sendPush: jest.fn().mockResolvedValue(undefined) };
}

function buildUseCase() {
  const opportunityRepository = buildOpportunityRepository();
  const offerRepository = buildOfferRepository();
  const catalogQueryPort = buildCatalogQueryPort();
  const transactionManager = buildTransactionManager();
  const eventPublisher = buildEventPublisher();
  const notificationPort = buildNotificationPort();
  const useCase = new EnviarOfertaUseCase(
    opportunityRepository,
    offerRepository,
    catalogQueryPort,
    transactionManager,
    eventPublisher,
    notificationPort,
  );
  return {
    opportunityRepository,
    offerRepository,
    catalogQueryPort,
    transactionManager,
    eventPublisher,
    notificationPort,
    useCase,
  };
}

function refillItemFixture(overrides: Partial<RefillItem> = {}): RefillItem {
  return {
    id: 'refill-item-a',
    nombre: 'Alimento perro',
    categoria: 'alimento',
    precioReferencia: 12990,
    catalogProductId: 'catalog-product-a',
    ...overrides,
  };
}

function oportunidadFixture(overrides: Partial<OportunidadElegible> = {}): OportunidadElegible {
  return {
    refillRequestId: 'refill-request-a',
    userId: 'user-a',
    comuna: 'Providencia',
    urgencia: 'hoy',
    cerradaAt: null,
    items: [refillItemFixture()],
    ...overrides,
  };
}

function nuevoItemFixture(overrides: Partial<NuevoOfferItemReactiva> = {}): NuevoOfferItemReactiva {
  return {
    refillItemId: 'refill-item-a',
    precio: 11990,
    isAlt: false,
    ...overrides,
  } as NuevoOfferItemReactiva;
}

function providerCatalogItemFixture(
  overrides: Partial<ProviderCatalogItem> = {},
): ProviderCatalogItem {
  return {
    id: 'catalog-item-a',
    companyId: 'company-a',
    catalogProductId: 'catalog-product-a',
    nombre: 'Alimento perro',
    categoria: 'alimento',
    precioBase: 10990,
    precioMaximo: 12990,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

const entrega: DatosEntrega = { tiempoEntregaHoras: 24, costoDespacho: 2000 };

describe('EnviarOfertaUseCase', () => {
  // tasks.md 5a.2 — D18-1, one of the 5 mandatory D18 negative tests.
  describe('D18-1: a non-eligible company is rejected with 404, byte-identical to a nonexistent refillRequestId (design.md D11)', () => {
    it('throws SolicitudNoElegibleError when findElegible resolves null', async () => {
      const { opportunityRepository, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(null);

      await expect(
        useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(SolicitudNoElegibleError);
    });

    it(
      'produces the byte-identical error whether findElegible returns null because the ' +
        'solicitud does not exist or because this company is not eligible — the repository ' +
        '(PR3b) already collapses both causes into the same null return, so the use case has ' +
        'only ONE branch, never two divergent ones that happen to produce the same output',
      async () => {
        const { opportunityRepository, useCase } = buildUseCase();
        opportunityRepository.findElegible.mockResolvedValue(null);

        const call = () =>
          useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega);
        const [errorA, errorB] = await Promise.all([
          call().catch((e) => e),
          call().catch((e) => e),
        ]);

        expect(errorA).toBeInstanceOf(SolicitudNoElegibleError);
        expect(errorA).toEqual(errorB);
      },
    );

    it('never calls buscarCoincidencias, runInTransaction, or offerRepository.save when not eligible', async () => {
      const {
        opportunityRepository,
        catalogQueryPort,
        transactionManager,
        offerRepository,
        useCase,
      } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(null);

      await expect(
        useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(SolicitudNoElegibleError);

      expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
    });
  });

  // tasks.md 5a.3 — Q4, checked AFTER eligibility (design.md Diagrama 2, paso 5).
  describe('Q4: a closed opportunity is rejected with 409, checked AFTER eligibility', () => {
    it('throws OportunidadCerradaError when the opportunity is eligible but cerradaAt is set', async () => {
      const { opportunityRepository, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ cerradaAt: '2026-08-01T12:00:00.000Z' }),
      );

      await expect(
        useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(OportunidadCerradaError);
    });

    it(
      'a non-eligible company on a closed opportunity still gets 404, never 409 — a 409 would ' +
        'confirm the solicitud exists to a company that was never eligible for it',
      async () => {
        const { opportunityRepository, useCase } = buildUseCase();
        // findElegible ya devuelve null para una empresa no elegible,
        // independiente de si la oportunidad esta cerrada (PR3b filtra por
        // company_id ANTES de exponer cerrada_at) — el 409 solo es
        // alcanzable por una empresa que SI es/fue elegible.
        opportunityRepository.findElegible.mockResolvedValue(null);

        await expect(
          useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
        ).rejects.toThrow(SolicitudNoElegibleError);
      },
    );

    it('never calls buscarCoincidencias or runInTransaction when the opportunity is closed', async () => {
      const { opportunityRepository, catalogQueryPort, transactionManager, useCase } =
        buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ cerradaAt: '2026-08-01T12:00:00.000Z' }),
      );

      await expect(
        useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(OportunidadCerradaError);

      expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
    });
  });

  // tasks.md 5a.4 — validated against the projection, never trusted from the client.
  describe('A refillItemId from another solicitud is rejected before any write', () => {
    it('throws OfertaInvalidaError when an item references a refillItemId absent from the eligible oportunidad', async () => {
      const { opportunityRepository, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ items: [refillItemFixture({ id: 'refill-item-a' })] }),
      );
      const itemAjeno = nuevoItemFixture({ refillItemId: 'refill-item-ajeno' });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [itemAjeno], entrega),
      ).rejects.toThrow(OfertaInvalidaError);
    });

    it('never calls buscarCoincidencias or runInTransaction when an item does not belong to the solicitud', async () => {
      const { opportunityRepository, catalogQueryPort, transactionManager, useCase } =
        buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ items: [refillItemFixture({ id: 'refill-item-a' })] }),
      );
      const itemAjeno = nuevoItemFixture({ refillItemId: 'refill-item-ajeno' });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [itemAjeno], entrega),
      ).rejects.toThrow(OfertaInvalidaError);

      expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
    });
  });

  // Code-review finding on PR5a: nothing previously rejected the same
  // refillItemId submitted twice in one offer — both lines would pass the
  // membership/catalog checks independently and total() would silently
  // double the sum. Written standalone, mirrors the "another solicitud"
  // block's style above.
  describe('A duplicate refillItemId within the same offer is rejected before any write', () => {
    it('throws OfertaInvalidaError when the same refillItemId appears twice', async () => {
      const { opportunityRepository, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ items: [refillItemFixture({ id: 'refill-item-a' })] }),
      );
      const itemRepetido = nuevoItemFixture({ refillItemId: 'refill-item-a' });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [itemRepetido, itemRepetido], entrega),
      ).rejects.toThrow(OfertaInvalidaError);
    });

    it('never calls buscarCoincidencias or runInTransaction when an item is duplicated', async () => {
      const { opportunityRepository, catalogQueryPort, transactionManager, useCase } =
        buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ items: [refillItemFixture({ id: 'refill-item-a' })] }),
      );
      const itemRepetido = nuevoItemFixture({ refillItemId: 'refill-item-a' });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [itemRepetido, itemRepetido], entrega),
      ).rejects.toThrow(OfertaInvalidaError);

      expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
    });
  });

  // tasks.md 5a.5 — D-C/Q7/R3: the single most important test in the
  // change. Written standalone, near-verbatim from design.md's own D-C
  // snippet: catches BOTH an un-awaited call to buscarCoincidencias AND a
  // call made from inside the transaction, with one assert.
  describe(
    'D-C/Q7/R3: buscarCoincidencias resolves before runInTransaction is invoked — ' +
      'the single most important test in this change',
    () => {
      it('records catalogo:resuelto strictly before tx:abierta', async () => {
        const { opportunityRepository, catalogQueryPort, transactionManager, useCase } =
          buildUseCase();
        opportunityRepository.findElegible.mockResolvedValue(oportunidadFixture());

        const orden: string[] = [];
        catalogQueryPort.buscarCoincidencias.mockImplementation(async () => {
          // Fuerza a que el caller tenga que AWAITEAR: si el use case
          // llamara buscarCoincidencias sin await, este push caería en un
          // microtask posterior y el array quedaría invertido.
          await Promise.resolve();
          orden.push('catalogo:resuelto');
          return [providerCatalogItemFixture()];
        });
        transactionManager.runInTransaction.mockImplementation(async (work) => {
          orden.push('tx:abierta');
          return work(fakeTx);
        });

        await useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega);

        expect(orden).toEqual(['catalogo:resuelto', 'tx:abierta']);
      });
    },
  );

  // tasks.md 5a.6 — C8: never captured, never degraded to a partial/empty offer.
  describe("A catalog outage propagates uncaught — the 503 mapping is Phase 5b's job", () => {
    it('CatalogQueryUnavailableError is not caught, and runInTransaction/save are never called', async () => {
      const {
        opportunityRepository,
        catalogQueryPort,
        transactionManager,
        offerRepository,
        useCase,
      } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(oportunidadFixture());
      catalogQueryPort.buscarCoincidencias.mockRejectedValue(new CatalogQueryUnavailableError());

      await expect(
        useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(CatalogQueryUnavailableError);

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
    });
  });

  // tasks.md 5a.7 — D-G.2: the catalog result authorizes and bounds the quote.
  describe('D-G.2: the live catalog result authorizes and bounds every item', () => {
    it('rejects an item with no live match in the catalog result (the hard rule)', async () => {
      const { opportunityRepository, catalogQueryPort, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({
          items: [
            refillItemFixture({ categoria: 'alimento', catalogProductId: 'catalog-product-a' }),
          ],
        }),
      );
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([
        providerCatalogItemFixture({ categoria: 'higiene', catalogProductId: undefined }),
      ]);

      await expect(
        useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(OfertaInvalidaError);
    });

    it("rejects a non-isAlt item priced above the matched item's precioMaximo", async () => {
      const { opportunityRepository, catalogQueryPort, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(oportunidadFixture());
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([
        providerCatalogItemFixture({ precioMaximo: 10000 }),
      ]);
      const item = nuevoItemFixture({ isAlt: false, precio: 10001 });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [item], entrega),
      ).rejects.toThrow(OfertaInvalidaError);
    });

    it('does NOT reject an isAlt item priced above precioMaximo — the residual risk, asserted explicitly', async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(oportunidadFixture());
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([
        providerCatalogItemFixture({ precioMaximo: 10000 }),
      ]);
      const item = nuevoItemFixture({
        isAlt: true,
        altNote: 'Saco de 25kg en vez de 15kg',
        precio: 50000,
      });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [item], entrega),
      ).resolves.toBeDefined();
      expect(offerRepository.save).toHaveBeenCalledTimes(1);
    });

    it('never opens a transaction when an item is rejected at this step', async () => {
      const { opportunityRepository, catalogQueryPort, transactionManager, useCase } =
        buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(oportunidadFixture());
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([
        providerCatalogItemFixture({ precioMaximo: 10000 }),
      ]);
      const item = nuevoItemFixture({ isAlt: false, precio: 10001 });

      await expect(
        useCase.execute('company-a', 'refill-request-a', [item], entrega),
      ).rejects.toThrow(OfertaInvalidaError);

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
    });
  });

  // tasks.md 5a.8 — the happy path (design.md Diagrama 2, pasos 9-12).
  describe('The happy path', () => {
    it('sets offers.user_id from oportunidad.userId, never a fresh join against refill_requests', async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ userId: 'user-x' }),
      );
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([providerCatalogItemFixture()]);

      const offer = await useCase.execute(
        'company-a',
        'refill-request-a',
        [nuevoItemFixture()],
        entrega,
      );

      expect(offer.userId).toBe('user-x');
      expect(offerRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-x' }),
        fakeTx,
      );
    });

    it('computes total in the domain (Σ item.precio + costoDespacho) before the transaction opens', async () => {
      const { opportunityRepository, catalogQueryPort, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(oportunidadFixture());
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([providerCatalogItemFixture()]);
      const item = nuevoItemFixture({ precio: 11990 });

      const offer = await useCase.execute('company-a', 'refill-request-a', [item], entrega);

      expect(offer.total).toBe(11990 + entrega.costoDespacho);
    });

    // backend-core-api-pedidos-pagos design.md D-B.2 (PR4): `nombre` viene
    // del RefillItem SOLICITADO (lo que el usuario pidió), nunca del
    // catálogo del proveedor — core-api-ofertas spec, "A reactive line's
    // nombre comes from the requested RefillItem, not the catalog".
    it("resolves each item's nombre from the matched RefillItem in oportunidad.items, not the catalog match", async () => {
      const { opportunityRepository, catalogQueryPort, useCase } = buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ items: [refillItemFixture({ nombre: 'Alimento perro 15kg' })] }),
      );
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([
        providerCatalogItemFixture({ nombre: 'Otro nombre del catálogo del proveedor' }),
      ]);

      const offer = await useCase.execute(
        'company-a',
        'refill-request-a',
        [nuevoItemFixture()],
        entrega,
      );

      expect(offer.items[0].nombre).toBe('Alimento perro 15kg');
    });

    it('publishes OfertaEnviada only AFTER offerRepository.save (commit) resolves', async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, eventPublisher, useCase } =
        buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ userId: 'user-x' }),
      );
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([providerCatalogItemFixture()]);

      const orden: string[] = [];
      offerRepository.save.mockImplementation(async () => {
        orden.push('save:resuelto');
      });
      eventPublisher.publish.mockImplementation(async () => {
        orden.push('publish:llamado');
      });

      const offer = await useCase.execute(
        'company-a',
        'refill-request-a',
        [nuevoItemFixture()],
        entrega,
      );

      expect(orden).toEqual(['save:resuelto', 'publish:llamado']);
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaEnviada];
      expect(publishedEvent).toBeInstanceOf(OfertaEnviada);
      expect(publishedEvent.type).toBe('ofertas.oferta_enviada');
      expect(publishedEvent.payload).toEqual({
        offerId: offer.id,
        kind: 'reactiva',
        companyId: 'company-a',
        userId: 'user-x',
        refillRequestId: 'refill-request-a',
        total: offer.total,
        tiempoEntregaHoras: entrega.tiempoEntregaHoras,
      });
    });

    it('sends the push best-effort, in this same use case body, after publish (D17)', async () => {
      const { opportunityRepository, catalogQueryPort, eventPublisher, notificationPort, useCase } =
        buildUseCase();
      opportunityRepository.findElegible.mockResolvedValue(
        oportunidadFixture({ userId: 'user-x' }),
      );
      catalogQueryPort.buscarCoincidencias.mockResolvedValue([providerCatalogItemFixture()]);

      const orden: string[] = [];
      eventPublisher.publish.mockImplementation(async () => {
        orden.push('publish:llamado');
      });
      notificationPort.sendPush.mockImplementation(async () => {
        orden.push('sendPush:llamado');
      });

      await useCase.execute('company-a', 'refill-request-a', [nuevoItemFixture()], entrega);

      expect(orden).toEqual(['publish:llamado', 'sendPush:llamado']);
      expect(notificationPort.sendPush).toHaveBeenCalledTimes(1);
      const [recipient] = notificationPort.sendPush.mock.calls[0] as [string, string];
      expect(recipient).toBe('user-x');
    });
  });
});
