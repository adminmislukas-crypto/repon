import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../../../shared/database/database.module';
import type { DB } from '../../../shared/database/schema';
import type { ActorPort, AuthenticatedActor } from '../../../shared/auth/ports/actor.port';

/**
 * `IdentidadModule`'s `ACTOR_PORT` binding (core-api-auth-guard spec,
 * "Actor resolution is a single query") — one `leftJoin` chain across
 * `profiles ⋈ admin_roles ⋈ companies`, never a per-field round-trip.
 * Reference implementation of "only contracts/ is importable across a
 * domain boundary" (core-api-hexagonal-layout).
 */
@Injectable()
export class IdentidadActorAdapter implements ActorPort {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async findActorById(profileId: string): Promise<AuthenticatedActor | null> {
    const row = await this.db
      .selectFrom('profiles')
      .leftJoin('admin_roles', 'admin_roles.profile_id', 'profiles.id')
      .leftJoin('companies', 'companies.id', 'profiles.company_id')
      .select([
        'profiles.id as profileId',
        'profiles.role as role',
        'profiles.status as status',
        'profiles.company_id as companyId',
        'companies.status as companyStatus',
        'admin_roles.rol as adminRole',
      ])
      .where('profiles.id', '=', profileId)
      .executeTakeFirst();

    if (!row) return null;

    return {
      profileId: row.profileId,
      role: row.role,
      status: row.status,
      companyId: row.companyId ?? null,
      companyStatus: row.companyStatus ?? null,
      adminRole: row.adminRole ?? null,
    };
  }
}
