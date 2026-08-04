import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// core-api-bootstrap spec, "Health check is unauthenticated": GET /health MUST
// be reachable without a bearer token and MUST stay 200 once `AuthGuard` is
// registered globally (slice 4a). There is no global guard yet in this PR —
// `AuthGuard`/`@Public()` land in PR 5 (design.md, shared/auth) — so this
// route is open by construction today; nothing needs bypassing. `@Public()`
// gets added here in PR 5 once it exists, turning this from "open because
// unguarded" into "open on purpose despite a guard". test/health.e2e-spec.ts
// (task 2.6) is the regression detector that PR 5/6 must keep this green.
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
