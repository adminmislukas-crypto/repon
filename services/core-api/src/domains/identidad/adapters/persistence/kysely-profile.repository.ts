import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Selectable } from 'kysely';
import type { Profile } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB, ProfilesTable } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { ProfileRepository } from '../../ports-out/profile-repository.port';

function toRow(profile: Profile) {
  return {
    id: profile.id,
    role: profile.role,
    status: profile.status,
    nombre: profile.nombre,
    email: profile.email,
    telefono: profile.telefono ?? null,
    company_id: profile.companyId ?? null,
  };
}

function toDomain(row: Selectable<ProfilesTable>): Profile {
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    nombre: row.nombre,
    email: row.email,
    telefono: row.telefono ?? undefined,
    companyId: row.company_id ?? undefined,
  };
}

/** design.md D-A: `snake_case` row types never leave this file's boundary. */
@Injectable()
export class KyselyProfileRepository implements ProfileRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  async insertIfAbsent(profile: Profile, tx?: TransactionContext): Promise<void> {
    await this.executor(tx)
      .insertInto('profiles')
      .values(toRow(profile))
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  async update(profile: Profile, tx?: TransactionContext): Promise<void> {
    await this.executor(tx)
      .updateTable('profiles')
      .set(toRow(profile))
      .where('id', '=', profile.id)
      .execute();
  }

  async findById(id: string, tx?: TransactionContext): Promise<Profile | null> {
    const row = await this.executor(tx)
      .selectFrom('profiles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  }
}
