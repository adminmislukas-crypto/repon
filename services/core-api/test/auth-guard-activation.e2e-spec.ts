import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// core-api-auth-guard spec / tasks.md 4a.7: proves `AuthGuard`/`RolesGuard`
// are genuinely mounted as `APP_GUARD` on the real `AppModule` (not merely
// unit-tested in isolation, PR 5). `ProbeController` isn't a real route
// (Phase 4c ships identidad's HTTP surface) — added only to this testing
// module so a request `AuthGuard` rejects pre-token needs no DB/Supabase.
@Controller('__probe')
class ProbeController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('AuthGuard activation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-@Public() route with no Authorization header', () => {
    return request(app.getHttpServer())
      .get('/__probe')
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ statusCode: 401, code: 'MISSING_BEARER_TOKEN' });
      });
  });

  it('GET /health still returns 200 unauthenticated (regression, task 2.6)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
