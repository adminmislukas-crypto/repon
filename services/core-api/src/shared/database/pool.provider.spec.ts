import { Pool } from 'pg';
import { createDatabasePool } from './pool.provider';

// design.md D-B ("Un timeout finito es parte del contrato, no un detalle
// operativo"): today's default `pg.Pool` has no `connectionTimeoutMillis`
// (waits forever on pool exhaustion) and no `statement_timeout` (waits
// forever on a slow query). This test asserts both finite timeouts are
// wired into the `Pool` constructor call — `pg` itself is mocked so no
// real connection is attempted.
jest.mock('pg', () => {
  const actual = jest.requireActual<typeof import('pg')>('pg');
  return { ...actual, Pool: jest.fn() };
});

const MockedPool = Pool as unknown as jest.Mock;

describe('createDatabasePool', () => {
  beforeEach(() => {
    MockedPool.mockClear();
    MockedPool.mockImplementation(() => ({ on: jest.fn() }));
  });

  it('constructs Pool with a finite connectionTimeoutMillis and statement_timeout (design.md D-B)', () => {
    createDatabasePool('postgresql://user:pass@localhost:5432/db');

    expect(MockedPool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://user:pass@localhost:5432/db',
        connectionTimeoutMillis: 2000,
        options: '-c statement_timeout=5000',
      }),
    );
  });
});
