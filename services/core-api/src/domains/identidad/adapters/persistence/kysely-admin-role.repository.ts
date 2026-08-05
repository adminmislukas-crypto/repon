import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import { DATABASE } from '../../../../shared/database/database.module';
import type { AdminRolesTable, DB } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { AdminRoleAssignment } from '../../domain/admin-role-assignment.entity';
import type { AdminRoleRepository } from '../../ports-out/admin-role-repository.port';

function toDomain(row: Selectable<AdminRolesTable>): AdminRoleAssignment {
  return {
    id: row.id,
    profileId: row.profile_id,
    rol: row.rol,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
  };
}

/** `UNIQUE(profile_id)` — `onConflict` replaces the row (spec: "a re-grant replaces, not duplicates"). */
@Injectable()
export class KyselyAdminRoleRepository implements AdminRoleRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  async upsert(assignment: AdminRoleAssignment, tx?: TransactionContext): Promise<void> {
    const update = { rol: assignment.rol, granted_by: assignment.grantedBy };
    await this.executor(tx)
      .insertInto('admin_roles')
      .values({ id: assignment.id, profile_id: assignment.profileId, ...update })
      .onConflict((oc) => oc.column('profile_id').doUpdateSet(update))
      .execute();
  }

  async findByProfileId(
    profileId: string,
    tx?: TransactionContext,
  ): Promise<AdminRoleAssignment | null> {
    const row = await this.executor(tx)
      .selectFrom('admin_roles')
      .selectAll()
      .where('profile_id', '=', profileId)
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  }
}
