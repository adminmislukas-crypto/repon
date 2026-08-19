import { MODULE_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ConsumoController } from '../src/domains/consumo/adapters/http/consumo.controller';
import { ConsumptionCheckJob } from '../src/domains/consumo/adapters/scheduling/consumption-check.job';
import { ConsumoModule } from '../src/domains/consumo/consumo.module';
import { ProcesarConsumosVencidosUseCase } from '../src/domains/consumo/ports-in/procesar-consumos-vencidos.use-case';

// core-api-consumo spec, "procesarConsumosVencidos has no HTTP surface"
// (design.md D2/R4, tasks.md 6c.9). There is no existing precedent in this
// repo for walking the live Express router stack (verified: grep across
// `test/` and `src/` for `router.stack`/`getRouterPathes`/etc. found zero
// matches, and Express 5's internal router shape is undocumented/private
// API not worth depending on for a test). The approach below instead reads
// the SAME decorator metadata Nest's own `RoutesResolver` reads to build the
// Express route table in the first place (`PATH_METADATA`/`METHOD_METADATA`,
// set by `@Get`/`@Post`, and `MODULE_METADATA.CONTROLLERS`/`.PROVIDERS`, set
// by `@Module()`) — a genuine route-enumeration proof, not a guess at
// Express internals, and it is exhaustive: every one of `ConsumoController`'s
// own methods is walked, not a hand-picked subset.
describe('Consumo — procesarConsumosVencidos / ConsumptionCheckJob have no HTTP surface (e2e)', () => {
  it('ConsumoModule registers exactly one controller — ConsumoController — never ConsumptionCheckJob', () => {
    const controllers: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ConsumoModule) ?? [];

    expect(controllers).toEqual([ConsumoController]);
  });

  it("ConsumoModule registers ConsumptionCheckJob and ProcesarConsumosVencidosUseCase as plain providers (Nest discovers @Cron() by reflection over providers, same mechanism catalogo's @OnEvent listener already uses — no HTTP route is ever created for a provider)", () => {
    const providers: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConsumoModule) ?? [];

    expect(providers).toContain(ConsumptionCheckJob);
    expect(providers).toContain(ProcesarConsumosVencidosUseCase);
  });

  it("enumerates ConsumoController's ENTIRE real route table — exactly the 7 routes design.md's Superficie HTTP table names (usuario-mobile-consumo D-1 added the 2 GET list routes + GET mi-adherencia), none of them cron-related", () => {
    const handlerNames = Object.getOwnPropertyNames(ConsumoController.prototype).filter(
      (name) => name !== 'constructor',
    );
    const prototype = ConsumoController.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    const routes = handlerNames
      .map((handlerName) => ({
        handlerName,
        path: Reflect.getMetadata(PATH_METADATA, prototype[handlerName]) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, prototype[handlerName]) as number | undefined,
      }))
      .filter((route) => route.path !== undefined); // only Nest-decorated HTTP handlers

    expect(routes).toHaveLength(7);
    const byMethodAndPath = routes
      .map((route) => `${RequestMethod[route.method!]} ${route.path}`)
      .sort();
    expect(byMethodAndPath).toEqual(
      [
        'GET mis-mascotas',
        'POST mis-mascotas',
        'GET mis-consumos',
        'POST mis-consumos',
        'GET mis-consumos/:consumptionId/dias-restantes',
        'POST mis-consumos/:consumptionId/dosis',
        'GET mi-adherencia',
      ].sort(),
    );
    for (const route of routes) {
      expect(route.handlerName.toLowerCase()).not.toMatch(/vencid|cron|schedul/);
      expect(String(route.path).toLowerCase()).not.toMatch(/vencid|cron|schedul/);
    }
  });

  it('ConsumptionCheckJob carries NO @Get/@Post path metadata on any of its own methods — it cannot become an HTTP handler by accident', () => {
    const jobMethodNames = Object.getOwnPropertyNames(ConsumptionCheckJob.prototype).filter(
      (name) => name !== 'constructor',
    );
    const jobPrototype = ConsumptionCheckJob.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    expect(jobMethodNames.length).toBeGreaterThan(0); // sanity: `ejecutar()` exists
    for (const name of jobMethodNames) {
      expect(Reflect.getMetadata(PATH_METADATA, jobPrototype[name])).toBeUndefined();
    }
  });
});

describe('Consumo — the cron registers for real once the app boots (proves the wiring is live, not only declared)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("SchedulerRegistry holds design.md D-F's named cron job once ScheduleModule.forRoot() + ConsumptionCheckJob are wired end to end", () => {
    const registry = app.get(SchedulerRegistry);

    expect(registry.doesExist('cron', 'consumo.chequeo-stock-diario')).toBe(true);
  });
});
