import type { RefillRequestActiva, RefillRequestBorrador } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import type { CompletarInput } from '../domain/refill-request.entity';
import {
  RefillItemDesconocidoError,
  RefillRequestNotFoundError,
  TransicionInvalidaError,
} from '../domain/refill.errors';
import type { RefillCreado } from '../events/refill-creado.event';
import type { RefillRepository } from '../ports-out/refill-repository.port';
import { CompletarBorradorUseCase } from './completar-borrador.use-case';

// core-api-refill-matching spec: "completarBorrador enforces direccion +
// comuna + every item's categoria + precioReferencia before transitioning to
// 'abierta'" (D3/D4, delegated to Phase 2's `completar()`) + "RefillCreado
// publishes only when a request becomes 'abierta'; a borrador publishes
// nothing" (D-C Decisión 1: "completarBorrador publishes RefillCreado after
// commit"). design.md Diagrama 1's closing note: same shape as
// `crearSolicitud`, except `findById` runs INSIDE the transaction (tasks.md
// 6b.2: "same pattern as marcarDosisTomada") and rejects on ownership (404)
// or non-borrador state (409 `TRANSICION_INVALIDA`) before `completar()` is
// ever called.
//
// Written in tasks.md 6b.2's literal order: cross-tenant 404 FIRST (same
// shape as 5a.3), then the non-borrador 409, then ONE test proving the
// unknown-`refillItemId` 400 is DELEGATED to `completar()` (Phase 2) rather
// than re-implemented here — Phase 2's own 3 negative completeness
// scenarios (`refill-request.entity.spec.ts`) are NOT duplicated in this
// file — then the happy path / transactional-wiring / publish-after-commit
// group.

const fakeTx = {} as TransactionContext;

function buildRefillRepository(): jest.Mocked<RefillRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findBorradorByConsumption: jest.fn(),
    actualizarEstado: jest.fn(),
  };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildUseCase() {
  const refillRepository = buildRefillRepository();
  const transactionManager = buildTransactionManager();
  const eventPublisher = buildEventPublisher();
  const useCase = new CompletarBorradorUseCase(
    refillRepository,
    transactionManager,
    eventPublisher,
  );
  return { refillRepository, transactionManager, eventPublisher, useCase };
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

function activaFixture(overrides: Partial<RefillRequestActiva> = {}): RefillRequestActiva {
  return {
    id: 'refill-1',
    userId: 'profile-a',
    urgencia: 'hoy',
    estado: 'abierta',
    direccion: 'Los Militares 1234',
    comuna: 'Las Condes',
    items: [
      { id: 'item-1', nombre: 'Alimento perro', categoria: 'mascotas', precioReferencia: 15990 },
    ],
    ...overrides,
  };
}

const validInput: CompletarInput = {
  direccion: 'Los Militares 1234',
  comuna: 'Las Condes',
  items: [{ refillItemId: 'item-1', categoria: 'mascotas', precioReferencia: 15990 }],
};

describe('CompletarBorradorUseCase', () => {
  describe(
    "Cross-tenant read returns 404, not 403 (D13, same shape as 5a.3's " +
      'buscarProveedoresCompatibles — checked BEFORE state)',
    () => {
      it('the request does not exist -> RefillRequestNotFoundError, and save() is never called', async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(null);

        await expect(useCase.execute('profile-a', 'refill-borrador-1', validInput)).rejects.toThrow(
          RefillRequestNotFoundError,
        );
        expect(refillRepository.save).not.toHaveBeenCalled();
      });

      it('the borrador belongs to another user -> byte-for-byte the SAME error as "does not exist"', async () => {
        const buildFor = (repo: jest.Mocked<RefillRepository>) =>
          new CompletarBorradorUseCase(repo, buildTransactionManager(), buildEventPublisher());
        const captureError = async (useCase: CompletarBorradorUseCase): Promise<Error> => {
          try {
            await useCase.execute('profile-a', 'refill-borrador-1', validInput);
            throw new Error('expected execute() to reject, but it resolved');
          } catch (error) {
            return error as Error;
          }
        };

        const notFoundRepo = buildRefillRepository();
        notFoundRepo.findById.mockResolvedValue(null);
        const notFoundError = await captureError(buildFor(notFoundRepo));

        const crossTenantRepo = buildRefillRepository();
        crossTenantRepo.findById.mockResolvedValue(borradorFixture({ userId: 'profile-b' }));
        const crossTenantError = await captureError(buildFor(crossTenantRepo));

        expect(notFoundError).toBeInstanceOf(RefillRequestNotFoundError);
        expect(crossTenantError).toBeInstanceOf(RefillRequestNotFoundError);
        expect(crossTenantError.name).toBe(notFoundError.name);
        expect(crossTenantError.message).toBe(notFoundError.message);
      });
    },
  );

  describe(
    'A request that is not a borrador is rejected via TransicionInvalidaError (409) — a check ' +
      "THIS use case makes, never completar() (completar()'s parameter type is already narrowed " +
      'to RefillRequestBorrador, D-B)',
    () => {
      it.each(['abierta', 'ofertada', 'confirmada'] as const)(
        "estado '%s' -> TransicionInvalidaError, and save()/completar() are never reached",
        async (estado) => {
          const { refillRepository, useCase } = buildUseCase();
          refillRepository.findById.mockResolvedValue(activaFixture({ id: 'refill-1', estado }));

          await expect(useCase.execute('profile-a', 'refill-1', validInput)).rejects.toThrow(
            TransicionInvalidaError,
          );
          expect(refillRepository.save).not.toHaveBeenCalled();
        },
      );

      it('a cross-tenant borrador returns 404, NEVER TransicionInvalidaError — ownership is still checked first', async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture({ userId: 'profile-b' }));

        await expect(useCase.execute('profile-a', 'refill-borrador-1', validInput)).rejects.toThrow(
          RefillRequestNotFoundError,
        );
      });
    },
  );

  describe(
    'An unknown refillItemId is delegated to completar() (Phase 2) — not re-implemented here, ' +
      "and Phase 2's own 3 negative completeness scenarios are NOT duplicated in this file",
    () => {
      it('a refillItemId that does not belong to the borrador surfaces RefillItemDesconocidoError, and save() is never called', async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture());

        await expect(
          useCase.execute('profile-a', 'refill-borrador-1', {
            ...validInput,
            items: [
              { refillItemId: 'item-desconocido', categoria: 'mascotas', precioReferencia: 100 },
            ],
          }),
        ).rejects.toThrow(RefillItemDesconocidoError);
        expect(refillRepository.save).not.toHaveBeenCalled();
      });
    },
  );

  describe(
    'Happy path — runInTransaction wraps findById (inside tx) + save (same tx), same shape as ' +
      'marcarDosisTomada (tasks.md 6b.2); RefillCreado publishes after commit (D-C Decisión 1, ' +
      "core-api-refill-matching 'completarBorrador publishes RefillCreado after commit')",
    () => {
      it('findById and save both receive the identical tx object, inside ONE runInTransaction call', async () => {
        const { refillRepository, transactionManager, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture());

        await useCase.execute('profile-a', 'refill-borrador-1', validInput);

        expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
        expect(refillRepository.findById).toHaveBeenCalledWith('refill-borrador-1', fakeTx);
        expect(refillRepository.save).toHaveBeenCalledTimes(1);
        expect(refillRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'refill-borrador-1', estado: 'abierta' }),
          fakeTx,
        );
      });

      it("transitions estado to 'abierta' and returns completar()'s output verbatim", async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture());

        const result = await useCase.execute('profile-a', 'refill-borrador-1', validInput);

        expect(result.estado).toBe('abierta');
        expect(result.direccion).toBe(validInput.direccion);
        expect(result.comuna).toBe(validInput.comuna);
        expect(result.items).toEqual([
          expect.objectContaining({ id: 'item-1', categoria: 'mascotas', precioReferencia: 15990 }),
        ]);
      });

      it('publish(RefillCreado) fires only AFTER runInTransaction resolves, never before/inside the callback', async () => {
        const { refillRepository, transactionManager, eventPublisher, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture());
        const callOrder: string[] = [];
        transactionManager.runInTransaction.mockImplementation(async (work) => {
          const result = await work(fakeTx);
          callOrder.push('transaction-committed');
          return result;
        });
        eventPublisher.publish.mockImplementation(async () => {
          callOrder.push('published');
        });

        await useCase.execute('profile-a', 'refill-borrador-1', validInput);

        expect(callOrder).toEqual(['transaction-committed', 'published']);
      });

      it('publishes RefillCreado with the exact D-C payload shape reused from crearSolicitud — no direccion field', async () => {
        const { refillRepository, eventPublisher, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture());

        const result = await useCase.execute('profile-a', 'refill-borrador-1', validInput);

        expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
        const [published] = eventPublisher.publish.mock.calls[0]! as [RefillCreado];
        expect(published.type).toBe('refill.creado');
        expect(published.payload).toEqual({
          refillRequestId: result.id,
          userId: result.userId,
          comuna: result.comuna,
          urgencia: result.urgencia,
          items: [
            {
              refillItemId: 'item-1',
              nombre: 'Alimento perro',
              categoria: 'mascotas',
              precioReferencia: 15990,
              catalogProductId: null,
            },
          ],
        });
        expect(published.payload).not.toHaveProperty('direccion');
      });

      it('a rejecting save() inside the transaction propagates, and RefillCreado never publishes', async () => {
        const { refillRepository, eventPublisher, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture());
        refillRepository.save.mockRejectedValue(new Error('update refill_requests failed'));

        await expect(useCase.execute('profile-a', 'refill-borrador-1', validInput)).rejects.toThrow(
          'update refill_requests failed',
        );
        expect(eventPublisher.publish).not.toHaveBeenCalled();
      });

      it('urgencia is omissible: an input without urgencia keeps the borrador own urgencia (D-G.1)', async () => {
        const { refillRepository, useCase } = buildUseCase();
        refillRepository.findById.mockResolvedValue(borradorFixture({ urgencia: 'en_2_3_dias' }));
        const inputSinUrgencia: CompletarInput = {
          direccion: validInput.direccion,
          comuna: validInput.comuna,
          items: validInput.items,
        };

        const result = await useCase.execute('profile-a', 'refill-borrador-1', inputSinUrgencia);

        expect(result.urgencia).toBe('en_2_3_dias');
      });
    },
  );
});
