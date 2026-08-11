import type { ProviderCatalogItem, RefillRequestActiva, RefillRequestBorrador } from '@repon/types';
import {
  CATALOG_QUERY_PORT,
  CatalogQueryUnavailableError,
  type CatalogQueryPort,
} from '../../catalogo/contracts/catalog-query.port';
import { TRANSACTION_MANAGER } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { RefillRequestNotFoundError, SolicitudEnBorradorError } from '../domain/refill.errors';
import { MatchEncontrado } from '../events/match-encontrado.event';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';
import { BuscarProveedoresCompatiblesUseCase } from './buscar-proveedores-compatibles.use-case';

// core-api-refill-matching spec: "buscarProveedoresCompatibles is
// owner-scoped; cross-tenant access is 404, never 403" (D13) + "buscarProveedoresCompatibles
// never runs inside a transaction; infra failures map to 503, never an empty
// array" (D14/D15) + "buscarProveedoresCompatibles on a 'borrador' request
// fails explicitly, never []" (D-F) + "RefillCreado and MatchEncontrado carry
// only this domain's own facts..." (D-C) + "MatchEncontrado publishes even
// when zero providers match" (D-C). design.md Diagrama 2 is the exact flow
// this spec pins down: findById (no tx) -> not-found/not-owner check (4/5)
// -> borrador check (6) -> buscarCoincidencias OUTSIDE any transaction (8) ->
// dedup (9) -> publish(MatchEncontrado).
//
// Written in tasks.md's literal order: 5a.3 (the first negative, written
// FIRST per D17/R2) through 5a.9, THEN the one GREEN implementation (5a.10).

// NestJS stores every `@Inject(TOKEN)`-decorated constructor parameter's
// token under this Reflect metadata key (`SELF_DECLARED_DEPS_METADATA` in
// `@nestjs/common/constants.ts`). Same technique `consumo`'s
// `ProcesarConsumosVencidosUseCase` spec uses for its own D2/D14-class
// structural guarantee (no `TRANSACTION_MANAGER`) — hardcoded here rather
// than importing the package's internal subpath, to stay decoupled from an
// undocumented Nest internal import path while still proving the real DI
// wiring structurally (tasks.md 5a.6).
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

function buildRefillRepository(): jest.Mocked<RefillRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findBorradorByConsumption: jest.fn(),
    actualizarEstado: jest.fn(),
  };
}

function buildCatalogQueryPort(): jest.Mocked<CatalogQueryPort> {
  return { buscarCoincidencias: jest.fn().mockResolvedValue([]) };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildUseCase() {
  const refillRepository = buildRefillRepository();
  const catalogQueryPort = buildCatalogQueryPort();
  const eventPublisher = buildEventPublisher();
  const useCase = new BuscarProveedoresCompatiblesUseCase(
    refillRepository,
    catalogQueryPort,
    eventPublisher,
  );
  return { refillRepository, catalogQueryPort, eventPublisher, useCase };
}

function activaFixture(overrides: Partial<RefillRequestActiva> = {}): RefillRequestActiva {
  return {
    id: 'refill-1',
    userId: 'profile-a',
    urgencia: 'hoy',
    estado: 'abierta',
    direccion: 'Los Militares 1234',
    comuna: 'Las Condes',
    items: [
      {
        id: 'item-1',
        nombre: 'Alimento perro',
        categoria: 'mascotas',
        precioReferencia: 15990,
        catalogProductId: 'cat-1',
      },
      { id: 'item-2', nombre: 'Arena para gato', categoria: 'mascotas', precioReferencia: 4990 },
    ],
    ...overrides,
  };
}

function borradorFixture(overrides: Partial<RefillRequestBorrador> = {}): RefillRequestBorrador {
  return {
    id: 'refill-borrador-1',
    userId: 'profile-a',
    urgencia: 'lo_antes_posible',
    estado: 'borrador',
    items: [{ id: 'item-1', nombre: 'Alimento perro' }],
    ...overrides,
  };
}

function providerItem(overrides: Partial<ProviderCatalogItem> = {}): ProviderCatalogItem {
  return {
    id: 'pc-1',
    companyId: 'company-1',
    nombre: 'Alimento perro',
    categoria: 'mascotas',
    precioBase: 15000,
    precioMaximo: 17000,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

describe('BuscarProveedoresCompatiblesUseCase', () => {
  // tasks.md 5a.3 — the first negative, written FIRST per D17/R2.
  describe(
    'Cross-tenant read returns 404, not 403 (D13, core-api-refill-matching ' +
      "'Cross-tenant read returns 404, not 403')",
    () => {
      it('the request does not exist -> RefillRequestNotFoundError', async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(null);

        await expect(useCase.execute('profile-a', 'refill-1')).rejects.toThrow(
          RefillRequestNotFoundError,
        );
      });

      it('the request belongs to another user -> byte-for-byte the SAME error (class, message) as "does not exist"', async () => {
        const { refillRepository, useCase } = buildUseCase();

        refillRepository.findById.mockResolvedValueOnce(null);
        let notFoundError: unknown;
        try {
          await useCase.execute('profile-a', 'refill-1');
        } catch (error) {
          notFoundError = error;
        }

        refillRepository.findById.mockResolvedValueOnce(
          activaFixture({ id: 'refill-1', userId: 'profile-b' }),
        );
        let crossTenantError: unknown;
        try {
          await useCase.execute('profile-a', 'refill-1');
        } catch (error) {
          crossTenantError = error;
        }

        expect(notFoundError).toBeInstanceOf(RefillRequestNotFoundError);
        expect(crossTenantError).toBeInstanceOf(RefillRequestNotFoundError);
        expect((crossTenantError as Error).name).toBe((notFoundError as Error).name);
        expect((crossTenantError as Error).message).toBe((notFoundError as Error).message);
      });
    },
  );

  // tasks.md 5a.4.
  describe(
    'Ownership is still checked before state, on a borrador request too (D-F ordering rule, ' +
      "core-api-refill-matching 'Ownership is still checked before state, on a borrador request too')",
    () => {
      it("another user's borrador request -> RefillRequestNotFoundError, NEVER SolicitudEnBorradorError", async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture({ userId: 'profile-b' }));

        await expect(useCase.execute('profile-a', 'refill-borrador-1')).rejects.toThrow(
          RefillRequestNotFoundError,
        );
      });
    },
  );

  // tasks.md 5a.5.
  describe(
    'Matching on a borrador request is rejected explicitly (D-F, core-api-refill-matching ' +
      "'Matching on a borrador request is rejected explicitly')",
    () => {
      it("the caller's OWN borrador -> SolicitudEnBorradorError, never [] and never a call to the catalog port", async () => {
        const { refillRepository, catalogQueryPort, eventPublisher, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture({ userId: 'profile-a' }));

        await expect(useCase.execute('profile-a', 'refill-borrador-1')).rejects.toThrow(
          SolicitudEnBorradorError,
        );

        // TypeScript's discriminated union (design.md D-B) makes a
        // borrador's `RefillItemBorrador[]` items structurally impossible
        // to reach `buscarCoincidencias(itemsSolicitados: RefillItem[])`
        // from past this point — a compile-time backstop the runtime 409
        // asserted above is the HTTP-observable half of.
        expect(catalogQueryPort.buscarCoincidencias).not.toHaveBeenCalled();
        expect(eventPublisher.publish).not.toHaveBeenCalled();
      });
    },
  );

  // tasks.md 5a.6 — constructor-inspection test.
  describe(
    'The matching use case has no transaction manager injected (D14/R3, core-api-refill-matching ' +
      "'The matching use case has no transaction manager injected')",
    () => {
      it('el constructor inyecta EXACTAMENTE REFILL_REPOSITORY, CATALOG_QUERY_PORT y EVENT_PUBLISHER — nunca TRANSACTION_MANAGER', () => {
        const injectedTokens: Array<{ index: number; param: unknown }> =
          Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, BuscarProveedoresCompatiblesUseCase) ??
          [];

        expect(injectedTokens).toHaveLength(3);
        const tokens = injectedTokens.map((dep) => dep.param);
        expect(tokens).not.toContain(TRANSACTION_MANAGER);
        expect(tokens).toEqual(
          expect.arrayContaining([REFILL_REPOSITORY, CATALOG_QUERY_PORT, EVENT_PUBLISHER]),
        );
      });
    },
  );

  // tasks.md 5a.7.
  describe(
    'A catalog outage maps to 503, not an empty result (core-api-refill-matching ' +
      "'A catalog outage maps to 503, not an empty result' — the 503 mapping itself is Phase " +
      '5b, this test only proves the use case never swallows it into [])',
    () => {
      it('CatalogQueryUnavailableError propagates UNCAUGHT out of execute(), and MatchEncontrado never publishes', async () => {
        const { refillRepository, catalogQueryPort, eventPublisher, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(activaFixture());
        const outage = new CatalogQueryUnavailableError();
        catalogQueryPort.buscarCoincidencias.mockRejectedValue(outage);

        await expect(useCase.execute('profile-a', 'refill-1')).rejects.toBe(outage);

        expect(eventPublisher.publish).not.toHaveBeenCalled();
      });
    },
  );

  // tasks.md 5a.8.
  describe(
    'happy path: 2+ items match across multiple companies -> companyIds deduplicated in ' +
      'first-appearance order, providerCatalogItemIds the full matched set',
    () => {
      it('publishes MatchEncontrado with both arrays correctly populated, and returns the raw matches', async () => {
        const { refillRepository, catalogQueryPort, eventPublisher, useCase } = buildUseCase();
        const entity = activaFixture();
        refillRepository.findById.mockResolvedValue(entity);
        const matches = [
          providerItem({ id: 'pc-1', companyId: 'company-b' }),
          providerItem({ id: 'pc-2', companyId: 'company-a' }),
          providerItem({ id: 'pc-3', companyId: 'company-b' }), // repeat company: dedup, not re-appended
        ];
        catalogQueryPort.buscarCoincidencias.mockResolvedValue(matches);

        const result = await useCase.execute('profile-a', entity.id);

        expect(result).toBe(matches);
        expect(refillRepository.findById).toHaveBeenCalledWith(entity.id);
        expect(catalogQueryPort.buscarCoincidencias).toHaveBeenCalledTimes(1);
        expect(catalogQueryPort.buscarCoincidencias).toHaveBeenCalledWith(entity.items);
        expect(eventPublisher.publish).toHaveBeenCalledTimes(1);

        const [published] = eventPublisher.publish.mock.calls[0]! as [MatchEncontrado];
        expect(published.type).toBe('refill.match_encontrado');
        // First-appearance order, deduplicated — NOT sorted, NOT arbitrary.
        expect(published.payload.companyIds).toEqual(['company-b', 'company-a']);
        expect(published.payload.providerCatalogItemIds).toEqual(['pc-1', 'pc-2', 'pc-3']);
        expect(published.payload).toEqual({
          refillRequestId: entity.id,
          userId: entity.userId,
          comuna: entity.comuna,
          urgencia: entity.urgencia,
          items: entity.items.map((item) => ({
            refillItemId: item.id,
            nombre: item.nombre,
            categoria: item.categoria,
            precioReferencia: item.precioReferencia,
            catalogProductId: item.catalogProductId ?? null,
          })),
          companyIds: ['company-b', 'company-a'],
          providerCatalogItemIds: ['pc-1', 'pc-2', 'pc-3'],
        });
        expect(published.payload).not.toHaveProperty('direccion');
      });
    },
  );

  // tasks.md 5a.9.
  describe(
    'A zero-match search still publishes MatchEncontrado (D-C, core-api-refill-matching ' +
      "'A zero-match search still publishes MatchEncontrado')",
    () => {
      it('publishes with companyIds: [] and providerCatalogItemIds: [] — NEVER suppressed', async () => {
        const { refillRepository, catalogQueryPort, eventPublisher, useCase } = buildUseCase();
        const entity = activaFixture();
        refillRepository.findById.mockResolvedValue(entity);
        catalogQueryPort.buscarCoincidencias.mockResolvedValue([]);

        const result = await useCase.execute('profile-a', entity.id);

        expect(result).toEqual([]);
        expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
        const [published] = eventPublisher.publish.mock.calls[0]! as [MatchEncontrado];
        expect(published.payload.companyIds).toEqual([]);
        expect(published.payload.providerCatalogItemIds).toEqual([]);
      });
    },
  );
});
