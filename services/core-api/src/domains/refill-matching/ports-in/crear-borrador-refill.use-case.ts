import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import { crearBorrador } from '../domain/refill-request.entity';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';

/**
 * design.md D-G.1's 6th (internal) use case — `RefillAutoSolicitadoListener`'s
 * (Phase 6a) own entry point, never `crearSolicitud`. Under D3 + D12,
 * `crearSolicitud(userId, items, direccion, comuna, urgencia)` requires
 * `direccion`/`comuna` (the event does not carry them) and always produces
 * `estado: 'abierta'` (which D3 forbids for this path) — there is no
 * "borrador path" reachable through that signature. Same class of use case
 * as `consumo`'s `ProcesarConsumosVencidosUseCase`: internal-only, no HTTP
 * surface, no human actor, never registered on `RefillController`.
 */
export interface CrearBorradorRefillInput {
  readonly consumptionId: string;
  readonly userId: string;
  readonly nombre: string;
}

/**
 * design.md Diagrama 3, steps 3a-3f. Constructor injects ONLY
 * `REFILL_REPOSITORY` and `TRANSACTION_MANAGER` — deliberately no
 * `EVENT_PUBLISHER`: a borrador insert publishes NOTHING, on either branch
 * (D-C Decisión 1, `core-api-refill-matching` spec "The listener's borrador
 * creation publishes no event"). Publishing `RefillCreado` here would make
 * `ofertas` notify providers about a request with no `direccion`, no
 * `comuna`, and no item `categoria` — exactly the silent failure D3 exists
 * to prevent. There is no token to call `publish` through, so this is a
 * structural guarantee, not a convention to remember.
 *
 * Dedup (D-D.3, `db-schema-refill-matching` spec "A second RefillAutoSolicitado
 * for the same consumption while a borrador is open is skipped"): the two
 * borradores a repeated event would produce are byte-for-byte identical
 * except for `id` (the listener can only ever fill `nombre` — no `categoria`,
 * no price, no `catalogProductId`), so a second `RefillAutoSolicitado` for a
 * consumption that already has an OPEN borrador is a clean no-op: log
 * `refill.borrador_omitido` and return. Once a borrador transitions out of
 * `'borrador'` (via `completarBorrador`, Phase 6b), the predicate no longer
 * matches and a fresh episode creates a fresh borrador — the correct
 * behavior falls out of the predicate, no special case needed.
 *
 * The dedup READ (`findBorradorByConsumption`) and the insert (`save`)
 * share the SAME `tx`, opened by ONE `runInTransaction` call — read-then-
 * write atomicity against the TOCTOU that migration 15's partial unique
 * index (`refill_requests_borrador_por_consumo_uidx`, design.md D-A) is the
 * real defense against: two concurrent listener invocations for the same
 * `(userId, consumptionId)` both passing the read can still only produce
 * one committed row, the index rejects the second insert.
 */
@Injectable()
export class CrearBorradorRefillUseCase {
  private readonly logger = new Logger(CrearBorradorRefillUseCase.name);

  constructor(
    @Inject(REFILL_REPOSITORY) private readonly refillRepository: RefillRepository,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute({ consumptionId, userId, nombre }: CrearBorradorRefillInput): Promise<void> {
    await this.transactionManager.runInTransaction(async (tx) => {
      const borradorExistente = await this.refillRepository.findBorradorByConsumption(
        userId,
        consumptionId,
        tx,
      );

      if (borradorExistente !== null) {
        this.logger.log({ evento: 'refill.borrador_omitido', userId, consumptionId });
        return;
      }

      const borrador = crearBorrador({
        id: randomUUID(),
        userId,
        consumptionId,
        // D-G.1: valor de arranque — la columna es NOT NULL y D4 no la
        // relaja. El usuario la confirma o la cambia al completar el
        // borrador (Phase 6b, `urgencia?` opcional en ese input).
        urgencia: 'lo_antes_posible',
        items: [{ id: randomUUID(), nombre }],
      });

      await this.refillRepository.save(borrador, tx);
    });
  }
}
