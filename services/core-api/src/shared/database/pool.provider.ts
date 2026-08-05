import { Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

const logger = new Logger('DatabasePool');

/**
 * Builds the `pg.Pool` every `Kysely<DB>` instance runs on top of
 * (design.md D-A). The single non-negotiable property of this pool: every
 * connection it hands out operates under `service_role`'s grants, never the
 * `postgres` table-owner's.
 *
 * Why this matters (D-A risk #1, closed by this PR's integration test,
 * `test/database.integration-spec.ts`): `audit_log`'s (and later
 * `order_items`'s) append-only guarantee is enforced by
 * `REVOKE UPDATE, DELETE ... FROM service_role` — grants, not RLS. Both
 * `anon`/`authenticated` AND `service_role` have RLS bypass irrelevant here
 * because grants are checked independently of RLS. A connection
 * authenticated as the table owner (`postgres`) ignores every REVOKE in the
 * migrations and silently regains UPDATE/DELETE — exactly the failure mode
 * design.md warns about.
 *
 * Closed decision (verified against the local Supabase stack, `\du` +
 * `pg_auth_members`): `service_role` itself has `rolcanlogin = false` — it
 * is a *grant-holding* role, not a login role, by Supabase's own design.
 * The login role every Postgres connection actually authenticates as must
 * be a *member* of `service_role`. Locally that's `authenticator`
 * (Supabase's own PostgREST connects the exact same way). `authenticator`
 * is `NOINHERIT` (verified: connecting as `authenticator` with no `SET
 * ROLE` gets `permission denied` on every table), so membership alone is
 * not enough — every physical connection must explicitly `SET ROLE
 * service_role` after authenticating. That's what this file does.
 *
 * `DATABASE_URL` (`.env.example`) MUST therefore resolve to a login role
 * that is a member of `service_role` — `authenticator` locally. A hosted
 * Supabase project does not expose `authenticator`'s credentials for
 * direct external connections; provisioning a dedicated login role granted
 * membership in `service_role` (design.md's other open-question
 * alternative) is a follow-up migration, out of this change's scope — see
 * this PR's return report for the explicit risk callout.
 */
export function createDatabasePool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    // design.md D-B ("Un timeout finito es parte del contrato, no un
    // detalle operativo"): today's defaults wait forever on both pool
    // exhaustion and a slow query — the exact failure mode that would make
    // `CatalogQueryPort.buscarCoincidencias` "throw on infra failure"
    // (D-B's contract) meaningless, since an infinite hang never reaches
    // the throw. Applies process-wide, not just to catalogo's new query
    // path — it also corrects the same peligroso default identidad already
    // runs on.
    connectionTimeoutMillis: 2_000, // pool exhaustion -> error, never hang
    options: '-c statement_timeout=5000', // slow query -> error, never hang
  });

  // A `pg.Pool` is lazy — it opens a physical connection on first use, not
  // at construction. This hook fires once per NEW physical connection
  // (not once per checkout), so `SET ROLE` set here persists for that
  // connection's whole lifetime in the pool, correctly applying to every
  // query any later checkout runs on it.
  pool.on('connect', (client: PoolClient) => {
    client.query('SET ROLE service_role').catch((error: unknown) => {
      // `client.query()` here is deliberately not awaited by the pool
      // itself (node-postgres's 'connect' event does not await listeners)
      // — but the query is still queued synchronously on this client
      // ahead of whatever query the caller who triggered this connection
      // issues next, because a single pg connection processes queries in
      // call order. If SET ROLE itself fails (e.g. the connecting role
      // isn't a member of service_role), surface it loudly through the
      // pool's own 'error' channel instead of leaving a client silently
      // running as the wrong role.
      pool.emit('error', error as Error, client);
    });
  });

  // node-postgres gotcha: an idle pooled client that errors (e.g. the
  // backend restarts, network drop) emits 'error' on the pool; an
  // unhandled 'error' event is a Node `EventEmitter` fatal that would
  // crash the whole process on a transient blip. Registering a handler
  // (node-postgres's own documented recommendation) logs it and lets the
  // pool open a fresh connection for the next query instead. This also
  // catches a failed `SET ROLE` re-emitted above — `authenticator` itself
  // carries zero direct grants (verified against the local stack), so a
  // connection stuck without `service_role` fails CLOSED (every query on
  // it gets `permission denied`, loud and visible), never open.
  pool.on('error', (error: Error) => {
    logger.error('Postgres pool error', error.stack);
  });

  return pool;
}
