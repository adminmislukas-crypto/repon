import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect } from 'kysely';
import { createDatabasePool } from './pool.provider';
import type { DB } from './schema';
import {
  KyselyTransactionManager,
  TRANSACTION_MANAGER,
  type TransactionManager,
} from './transaction';

// design.md's DI token table: `DATABASE | Kysely<DB> | shared/database/`.
// Declared here (not in schema.ts) because `Kysely<DB>` is a third-party
// type, not an interface this codebase owns — this module is the only
// file that constructs it, so this is its one declaration site.
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Kysely<DB> => {
        // `getOrThrow` is redundant with env.schema.ts's own fail-fast
        // validation (DATABASE_URL is required unconditionally, PR 3) —
        // kept anyway so this factory never silently constructs a pool
        // with `undefined` if it's ever wired without ConfigModule's
        // validation running first (e.g. a future isolated unit test).
        const connectionString = config.getOrThrow<string>('DATABASE_URL');
        const pool = createDatabasePool(connectionString);
        return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
      },
    },
    {
      provide: TRANSACTION_MANAGER,
      inject: [DATABASE],
      useFactory: (db: Kysely<DB>): TransactionManager => new KyselyTransactionManager(db),
    },
  ],
  exports: [DATABASE, TRANSACTION_MANAGER],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  // Closes the underlying `pg.Pool` on app shutdown — `Kysely#destroy()`
  // delegates to the dialect's driver, which ends the pool for us.
  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
