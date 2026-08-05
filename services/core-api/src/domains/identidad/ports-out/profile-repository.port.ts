import type { Profile } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * core-api-identidad spec, "Ports-out carry a trailing optional transaction
 * context" — `save` is REMOVED: a single method cannot express both
 * "idempotent creation that never overwrites" (registrarUsuario's
 * compensation-retry safety, Phase 4b) and "mutate an existing row" at once.
 */
export interface ProfileRepository {
  /** `ON CONFLICT (id) DO NOTHING` — retry-safe, never overwrites. */
  insertIfAbsent(profile: Profile, tx?: TransactionContext): Promise<void>;
  update(profile: Profile, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Profile | null>;
}

export const PROFILE_REPOSITORY = Symbol('PROFILE_REPOSITORY');
