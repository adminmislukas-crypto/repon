import { Module } from '@nestjs/common';

/**
 * Thin placeholder module (exploration.md D2). See `catalogo.module.ts` for
 * the full rationale — same rule applies here: `ports-out/` declares
 * `CONSUMPTION_REPOSITORY`/`CONSUMPTION_LOG_REPOSITORY`, this module binds
 * neither (no `useValue: {}`, design.md).
 */
@Module({})
export class ConsumoModule {}
