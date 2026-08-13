import type { Offer } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `ofertas/SPEC.md`, "Puertos de salida" — final shape (design.md D-G.1,
 * backend-core-api-ofertas PR 1). `NotificationPort`/`EventPublisher`, also
 * listed in `SPEC.md`'s ports-out block, are shared-kernel infrastructure
 * (design.md D17) and not redeclared here.
 */
export interface OfferRepository {
  /** Insert de una oferta nueva + sus items, en una sola escritura atómica
   *  (`enviarOferta`/`enviarOfertaProactiva`, Phase 5/6). */
  save(offer: Offer, tx?: TransactionContext): Promise<void>;

  /** `obtenerBandeja`'s read (Phase 7a): las ofertas del actor, ítems
   *  inline. */
  findByUser(userId: string, tx?: TransactionContext): Promise<Offer[]>;

  /**
   * Existente, queda **declarado y sin caller** en este cambio (design.md
   * D-G.1) — se dice en voz alta en vez de fingir que se usa: el
   * displacement de `aceptarOferta` (D12) usa `desplazarHermanas`, una
   * sentencia con `RETURNING`, que es más correcta que leer-y-después-escribir.
   * Está en `ofertas/SPEC.md`, así que se conserva.
   */
  findByRefillRequest(refillRequestId: string, tx?: TransactionContext): Promise<Offer[]>;

  /**
   * D11 — dueño. NUEVO. No filtra por dueño: trae la fila y el caller
   * compara `entity.userId` contra `actor.profileId` (mismo patrón que
   * `RefillRepository.findById`).
   */
  findById(offerId: string, tx?: TransactionContext): Promise<Offer | null>;

  /**
   * D12 — transición angosta de 1 columna, nunca un `save()` que reescriba
   * ítems. NUEVO. **`tx` REQUERIDO, no opcional** (design.md D-G.5): la
   * atomicidad no es una optimización acá, es la definición de la
   * operación — llamarlo fuera de una transacción no debe compilar.
   */
  marcarAceptada(offerId: string, tx: TransactionContext): Promise<void>;

  /**
   * D12 — una sola sentencia `UPDATE ... RETURNING id`; devuelve exactamente
   * los ids que esta sentencia movió a `'rechazada'`, sin `SELECT` previo
   * (design.md D-D: un `SELECT` seguido de un `UPDATE` daría una lista que
   * puede no coincidir con lo efectivamente movido). NUEVO. **`tx`
   * REQUERIDO** (D-G.5), mismo motivo que `marcarAceptada`.
   */
  desplazarHermanas(
    refillRequestId: string,
    exceptoOfferId: string,
    tx: TransactionContext,
  ): Promise<readonly string[]>;
}

export const OFFER_REPOSITORY = Symbol('OFFER_REPOSITORY');
