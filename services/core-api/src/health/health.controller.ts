import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/auth/decorators/public.decorator';

// core-api-bootstrap spec, "Health check is unauthenticated": GET /health MUST
// be reachable without a bearer token. `@Public()` now exists (PR 5,
// shared/auth) and is added here on purpose, ahead of `AuthGuard` actually
// being mounted as `APP_GUARD` (PR 6) — this turns the route from "open
// because unguarded" into "open on purpose despite a guard" the moment that
// guard lands. test/health.e2e-spec.ts (task 2.6) is the regression detector
// that PR 6 must keep this green.
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
