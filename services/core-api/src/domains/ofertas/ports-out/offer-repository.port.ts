import type { Offer } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `ofertas/SPEC.md`, "Puertos de salida" — thin placeholder (exploration.md
 * D2). Interface + DI token only. `NotificationPort`/`EventPublisher`, also
 * listed in `SPEC.md`'s ports-out block, are shared-kernel infrastructure
 * (design.md's DI-wiring convention) and not redeclared here.
 */
export interface OfferRepository {
  save(offer: Offer, tx?: TransactionContext): Promise<void>;
  findByUser(userId: string, tx?: TransactionContext): Promise<Offer[]>;
  findByRefillRequest(refillRequestId: string, tx?: TransactionContext): Promise<Offer[]>;
}

export const OFFER_REPOSITORY = Symbol('OFFER_REPOSITORY');
