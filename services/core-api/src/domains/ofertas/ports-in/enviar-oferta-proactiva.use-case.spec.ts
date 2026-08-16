import type { DatosEntrega, NuevoOfferItemProactiva, ProviderCatalogItem } from '@repon/types';
import {
  CatalogQueryUnavailableError,
  type CatalogQueryPort,
} from '../../catalogo/contracts/catalog-query.port';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { NotificationPort } from '../../../shared/notifications/notification.port';
import { DestinatarioNoElegibleError, ItemsNoDisponiblesError } from '../domain/oferta.errors';
import { OfertaEnviada } from '../events/oferta-enviada.event';
import type { OfferOpportunityRepository } from '../ports-out/offer-opportunity-repository.port';
import type { OfferRepository } from '../ports-out/offer-repository.port';
import { EnviarOfertaProactivaUseCase } from './enviar-oferta-proactiva.use-case';

// design.md Diagrama 2's closing note (línea 662) — `enviarOfertaProactiva`
// tiene la MISMA FORMA que `enviarOferta`, con 3 diferencias: (a) el paso 3
// es `existeRelacion(companyId, userId)` y su negativo es
// `DestinatarioNoElegibleError` (404, D10); (b) el paso 7 es
// `obtenerItemsDeProveedor(companyId, ids)` y el 8 compara CARDINALIDADES,
// nunca correlación item-a-item (`ItemsNoDisponiblesError` → 400, D-B); (c)
// no hay oportunidad que consultar ni items de solicitud que validar —
// `refillRequestId` viaja `null` en el evento publicado. tasks.md Phase 6b:
// RED primero (6b.1-6b.3), un solo GREEN (6b.4) — misma forma "muchos RED,
// un GREEN" que PR5a, aunque acá no son los 5 negativos obligatorios de D18
// (esos ya se cerraron en PR4a/5a/7a/8a).

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
    // No usado por este caso de uso — presente solo para satisfacer la
    // forma estricta de `jest.Mocked<CatalogQueryPort>` (mismo patrón que
    // `enviar-oferta.use-case.spec.ts` usa a la inversa para
    // `obtenerItemsDeProveedor`).
    buscarCoincidencias: jest.fn(),
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
  const useCase = new EnviarOfertaProactivaUseCase(
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

function nuevoItemFixture(
  overrides: Partial<NuevoOfferItemProactiva> = {},
): NuevoOfferItemProactiva {
  return {
    providerCatalogItemId: 'catalog-item-a',
    precio: 11990,
    isAlt: false,
    ...overrides,
  } as NuevoOfferItemProactiva;
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

describe('EnviarOfertaProactivaUseCase', () => {
  // tasks.md 6b.1 — D10, written first.
  describe('D10: existeRelacion bounds who can be targeted proactively', () => {
    it('throws DestinatarioNoElegibleError when existeRelacion resolves false', async () => {
      const { opportunityRepository, useCase } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(false);

      await expect(
        useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(DestinatarioNoElegibleError);
    });

    it('never calls obtenerItemsDeProveedor, runInTransaction, or save when there is no qualifying relationship', async () => {
      const {
        opportunityRepository,
        catalogQueryPort,
        transactionManager,
        offerRepository,
        useCase,
      } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(false);

      await expect(
        useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(DestinatarioNoElegibleError);

      expect(catalogQueryPort.obtenerItemsDeProveedor).not.toHaveBeenCalled();
      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
    });

    it('a prior match (even without acceptance) qualifies as a recipient — the happy path continues', async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, useCase } = buildUseCase();
      // existeRelacion no distingue "hubo un match" de "esa oferta fue
      // aceptada" — la relación se prueba con la sola existencia de una
      // fila de `offer_opportunities` (design.md D10), nunca con el estado
      // de una `Offer`.
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([providerCatalogItemFixture()]);

      await expect(
        useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega),
      ).resolves.toBeDefined();
      expect(offerRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  // tasks.md 6b.2 — D-B cardinality (extends the RED file above).
  describe('D-B: obtenerItemsDeProveedor cardinality gate replaces per-item correlation', () => {
    it('throws ItemsNoDisponiblesError when fewer items come back than requested (a competitor id silently discarded)', async () => {
      const { opportunityRepository, catalogQueryPort, useCase } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([]); // 0 devueltos, 1 pedido

      await expect(
        useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(ItemsNoDisponiblesError);
    });

    it('never opens a transaction or persists when the cardinality does not match', async () => {
      const {
        opportunityRepository,
        catalogQueryPort,
        transactionManager,
        offerRepository,
        useCase,
      } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([]);

      await expect(
        useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(ItemsNoDisponiblesError);

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
    });

    it('rejects the WHOLE request even when only ONE of several items is a foreign/competitor id — never a smaller offer', async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, useCase } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      const items = [
        nuevoItemFixture({ providerCatalogItemId: 'catalog-item-a' }),
        nuevoItemFixture({ providerCatalogItemId: 'catalog-item-ajeno' }),
      ];
      // Solo vuelve el propio: el ajeno fue descartado en silencio por el
      // puerto (C9) — la cardinalidad (2 pedidos, 1 devuelto) es la única
      // señal, nunca una lista de "ids faltantes".
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([providerCatalogItemFixture()]);

      await expect(useCase.execute('company-a', 'user-a', items, entrega)).rejects.toThrow(
        ItemsNoDisponiblesError,
      );
      expect(offerRepository.save).not.toHaveBeenCalled();
    });

    it("creates a 'pendiente' offer when every requested item belongs to the offering company — the all-match happy path", async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, useCase } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([providerCatalogItemFixture()]);

      const offer = await useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega);

      expect(offer.status).toBe('pendiente');
      expect(offer.kind).toBe('proactiva');
      expect(offer.companyId).toBe('company-a');
      expect(offer.userId).toBe('user-a');
      expect(offer.refillRequestId).toBeUndefined();
      expect(offerRepository.save).toHaveBeenCalledTimes(1);
      expect(offerRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-a', companyId: 'company-a', kind: 'proactiva' }),
        fakeTx,
      );
    });
  });

  // tasks.md 6b.3 — this use case's own instance of the D13/C2 order
  // guarantee. Same shape as PR5a's D-C test (tasks.md 5a.5) — a NEW,
  // separate test, since there is no shared cross-class enforcement of this
  // ordering anywhere in the repo (design.md D-C).
  describe('D13/C2: obtenerItemsDeProveedor resolves strictly before runInTransaction is invoked', () => {
    it('records catalogo:resuelto strictly before tx:abierta', async () => {
      const { opportunityRepository, catalogQueryPort, transactionManager, useCase } =
        buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);

      const orden: string[] = [];
      catalogQueryPort.obtenerItemsDeProveedor.mockImplementation(async () => {
        // Fuerza a que el caller tenga que AWAITEAR: si el use case llamara
        // obtenerItemsDeProveedor sin await, este push caería en un
        // microtask posterior y el array quedaría invertido.
        await Promise.resolve();
        orden.push('catalogo:resuelto');
        return [providerCatalogItemFixture()];
      });
      transactionManager.runInTransaction.mockImplementation(async (work) => {
        orden.push('tx:abierta');
        return work(fakeTx);
      });

      await useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega);

      expect(orden).toEqual(['catalogo:resuelto', 'tx:abierta']);
    });
  });

  // C8, heredado por D-B término a término (design.md D-B: "Herencia de
  // C1-C8"): un CatalogQueryUnavailableError nunca se captura acá — mapearlo
  // a 503 es trabajo del filter (6b's own HTTP tasks). Misma disciplina que
  // 5a.6 estableció para el camino reactivo.
  describe('A catalog outage propagates uncaught (C8, inherited by D-B)', () => {
    it('CatalogQueryUnavailableError is not caught, and runInTransaction/save are never called', async () => {
      const {
        opportunityRepository,
        catalogQueryPort,
        transactionManager,
        offerRepository,
        useCase,
      } = buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockRejectedValue(
        new CatalogQueryUnavailableError(),
      );

      await expect(
        useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega),
      ).rejects.toThrow(CatalogQueryUnavailableError);

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(offerRepository.save).not.toHaveBeenCalled();
    });
  });

  // La cola del happy path — el payload del evento viaja con
  // `refillRequestId: null` (design.md línea 662, diferencia (c); D6/D18-3
  // — el negativo sobre el que rama el listener de refill-matching en la
  // Phase 8a), publish únicamente DESPUÉS del commit, y el push best-effort
  // (D17). No es un ítem numerado propio de tasks.md, pero es la misma
  // disciplina que 5a.8 estableció para `enviarOferta`, y es exactamente el
  // punto donde design.md's "misma forma" (línea 662) exige la prueba.
  // backend-core-api-pedidos-pagos design.md D-B.2 (PR4): `nombre` viene de
  // `ProviderCatalogItem.nombre` — core-api-ofertas spec, "A proactive
  // line's nombre comes from the provider's catalog listing".
  it("resolves each item's nombre from the matched ProviderCatalogItem", async () => {
    const { opportunityRepository, catalogQueryPort, useCase } = buildUseCase();
    opportunityRepository.existeRelacion.mockResolvedValue(true);
    catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([
      providerCatalogItemFixture({ nombre: 'Bidón 10L' }),
    ]);

    const offer = await useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega);

    expect(offer.items[0].nombre).toBe('Bidón 10L');
  });

  describe('The happy path — event/push (design.md D6/D17, diferencia (c): refillRequestId viaja null)', () => {
    it('publishes OfertaEnviada with refillRequestId: null, only AFTER save (commit) resolves', async () => {
      const { opportunityRepository, catalogQueryPort, offerRepository, eventPublisher, useCase } =
        buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([providerCatalogItemFixture()]);

      const orden: string[] = [];
      offerRepository.save.mockImplementation(async () => {
        orden.push('save:resuelto');
      });
      eventPublisher.publish.mockImplementation(async () => {
        orden.push('publish:llamado');
      });

      const offer = await useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega);

      expect(orden).toEqual(['save:resuelto', 'publish:llamado']);
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const [publishedEvent] = eventPublisher.publish.mock.calls[0] as [OfertaEnviada];
      expect(publishedEvent).toBeInstanceOf(OfertaEnviada);
      expect(publishedEvent.type).toBe('ofertas.oferta_enviada');
      expect(publishedEvent.payload).toEqual({
        offerId: offer.id,
        kind: 'proactiva',
        companyId: 'company-a',
        userId: 'user-a',
        refillRequestId: null,
        total: offer.total,
        tiempoEntregaHoras: entrega.tiempoEntregaHoras,
      });
    });

    it('sends the push best-effort, in this same use case body, after publish (D17)', async () => {
      const { opportunityRepository, catalogQueryPort, eventPublisher, notificationPort, useCase } =
        buildUseCase();
      opportunityRepository.existeRelacion.mockResolvedValue(true);
      catalogQueryPort.obtenerItemsDeProveedor.mockResolvedValue([providerCatalogItemFixture()]);

      const orden: string[] = [];
      eventPublisher.publish.mockImplementation(async () => {
        orden.push('publish:llamado');
      });
      notificationPort.sendPush.mockImplementation(async () => {
        orden.push('sendPush:llamado');
      });

      await useCase.execute('company-a', 'user-a', [nuevoItemFixture()], entrega);

      expect(orden).toEqual(['publish:llamado', 'sendPush:llamado']);
      expect(notificationPort.sendPush).toHaveBeenCalledTimes(1);
      const [recipient] = notificationPort.sendPush.mock.calls[0] as [string, string];
      expect(recipient).toBe('user-a');
    });
  });
});
