import type { NuevoRefillItem, RefillRequestActiva } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import { SolicitudInvalidaError } from '../domain/refill.errors';
import type { RefillCreado } from '../events/refill-creado.event';
import type { RefillRepository } from '../ports-out/refill-repository.port';
import { CrearSolicitudUseCase } from './crear-solicitud.use-case';

// core-api-refill-matching spec: "The actor's profileId becomes the owner"
// (D13) + "crearSolicitud's manual path requires comuna as an explicit
// parameter" (D12) + "crearSolicitud persists the request and its items in
// one transaction; RefillCreado publishes only after commit" (D14). design.md
// Diagrama 1: `crearSolicitudActiva` (Phase 2) constructs+validates BEFORE
// `runInTransaction` opens, so a rejected call never touches the repository
// or the transaction manager at all.

const fakeTx = {} as TransactionContext;

function buildRefillRepository(): jest.Mocked<RefillRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findBorradorByConsumption: jest.fn(),
    actualizarEstado: jest.fn(),
  };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildUseCase() {
  const refillRepository = buildRefillRepository();
  const transactionManager = buildTransactionManager();
  const eventPublisher = buildEventPublisher();
  const useCase = new CrearSolicitudUseCase(refillRepository, transactionManager, eventPublisher);
  return { refillRepository, transactionManager, eventPublisher, useCase };
}

const items: readonly NuevoRefillItem[] = [
  {
    nombre: 'Alimento perro',
    categoria: 'mascotas',
    precioReferencia: 15990,
    catalogProductId: 'cat-1',
  },
  { nombre: 'Arena para gato', categoria: 'mascotas', precioReferencia: 4990 },
  { nombre: 'Shampoo antipulgas', categoria: 'mascotas', precioReferencia: 6990 },
];

describe('CrearSolicitudUseCase', () => {
  describe("the actor's profileId becomes the owner (D13, core-api-refill-matching 'The actor's profileId becomes the owner')", () => {
    it("the created RefillRequest.userId equals the caller-supplied profileId — the use case's signature has no other place userId could come from", async () => {
      const { refillRepository, useCase } = buildUseCase();

      const result = await useCase.execute(
        'profile-a',
        items,
        'Los Militares 1234',
        'Las Condes',
        'hoy',
      );

      expect(result.userId).toBe('profile-a');
      expect(refillRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'profile-a' }),
        fakeTx,
      );
    });
  });

  describe("request and items commit together (D14, core-api-refill-matching 'Request and items commit together')", () => {
    it('runInTransaction wraps exactly 1 save() call carrying the request and all 3 items', async () => {
      const { refillRepository, transactionManager, useCase } = buildUseCase();

      const result = await useCase.execute(
        'profile-a',
        items,
        'Los Militares 1234',
        'Las Condes',
        'hoy',
      );

      expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
      expect(refillRepository.save).toHaveBeenCalledTimes(1);
      expect(refillRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ items: expect.arrayContaining([expect.anything()]) }),
        fakeTx,
      );
      expect(result.items).toHaveLength(3);
      expect(result.estado).toBe('abierta');
    });

    it('publish(RefillCreado) fires only AFTER runInTransaction resolves, never before/inside the callback', async () => {
      const { transactionManager, eventPublisher, useCase } = buildUseCase();
      const callOrder: string[] = [];
      transactionManager.runInTransaction.mockImplementation(async (work) => {
        const result = await work(fakeTx);
        callOrder.push('transaction-committed');
        return result;
      });
      eventPublisher.publish.mockImplementation(async () => {
        callOrder.push('published');
      });

      await useCase.execute('profile-a', items, 'Los Militares 1234', 'Las Condes', 'hoy');

      expect(callOrder).toEqual(['transaction-committed', 'published']);
    });

    it('publishes RefillCreado with the exact D-C payload shape — no direccion field, catalogProductId null-coalesced', async () => {
      const { eventPublisher, useCase } = buildUseCase();

      const result = await useCase.execute(
        'profile-a',
        items,
        'Los Militares 1234',
        'Las Condes',
        'hoy',
      );

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      const [published] = eventPublisher.publish.mock.calls[0]! as [RefillCreado];
      expect(published.type).toBe('refill.creado');
      expect(published.payload).toEqual({
        refillRequestId: result.id,
        userId: 'profile-a',
        comuna: 'Las Condes',
        urgencia: 'hoy',
        items: [
          {
            refillItemId: result.items[0]!.id,
            nombre: 'Alimento perro',
            categoria: 'mascotas',
            precioReferencia: 15990,
            catalogProductId: 'cat-1',
          },
          {
            refillItemId: result.items[1]!.id,
            nombre: 'Arena para gato',
            categoria: 'mascotas',
            precioReferencia: 4990,
            catalogProductId: null,
          },
          {
            refillItemId: result.items[2]!.id,
            nombre: 'Shampoo antipulgas',
            categoria: 'mascotas',
            precioReferencia: 6990,
            catalogProductId: null,
          },
        ],
      });
      expect(published.payload).not.toHaveProperty('direccion');
    });
  });

  describe("an item failure leaves no partial request (D14, core-api-refill-matching 'An item failure leaves no partial request')", () => {
    it('a rejecting save() inside the transaction propagates the rejection and publish is never called', async () => {
      const { refillRepository, eventPublisher, useCase } = buildUseCase();
      refillRepository.save.mockRejectedValue(new Error('insert refill_items failed'));

      await expect(
        useCase.execute('profile-a', items, 'Los Militares 1234', 'Las Condes', 'hoy'),
      ).rejects.toThrow('insert refill_items failed');

      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe("a manual crearSolicitud call without comuna is rejected (D12, core-api-refill-matching 'A manual crearSolicitud call without comuna is rejected')", () => {
    it('rejects before any I/O — neither the transaction manager nor the repository nor the publisher is ever invoked', async () => {
      const { refillRepository, transactionManager, eventPublisher, useCase } = buildUseCase();

      await expect(
        useCase.execute('profile-a', items, 'Los Militares 1234', '', 'hoy'),
      ).rejects.toThrow(SolicitudInvalidaError);

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(refillRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('the use case never reads userId off anything other than its own profileId param', () => {
    it('the same items/direccion/comuna/urgencia produce different owners for different profileId callers', async () => {
      const { refillRepository, useCase } = buildUseCase();

      await useCase.execute('profile-a', items, 'Los Militares 1234', 'Las Condes', 'hoy');
      await useCase.execute('profile-b', items, 'Los Militares 1234', 'Las Condes', 'hoy');

      const calls = refillRepository.save.mock.calls as [RefillRequestActiva, TransactionContext][];
      expect(calls[0]![0].userId).toBe('profile-a');
      expect(calls[1]![0].userId).toBe('profile-b');
    });
  });
});
