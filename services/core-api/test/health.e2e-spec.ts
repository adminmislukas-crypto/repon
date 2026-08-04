import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// core-api-bootstrap spec, "Health check is unauthenticated" + "A fully
// valid env starts cleanly" (task 2.6). This is also the regression
// detector design.md §"Slice 2 (boot)" calls out: once PR 5/6 register
// `AuthGuard` as `APP_GUARD`, this same test must still pass unmodified.
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Required env vars are set by test/env.e2e-setup.ts (a Jest `setupFiles`
    // entry, which runs before this file's `import { AppModule }` above —
    // see that file's comment for why it can't happen here instead.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with no Authorization header', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
