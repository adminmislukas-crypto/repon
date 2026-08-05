import { Module } from '@nestjs/common';

/**
 * Thin placeholder module (exploration.md D2). See `catalogo.module.ts` for
 * the full rationale — `ports-out/` declares `REFILL_REPOSITORY`, this
 * module binds nothing (no `useValue: {}`, design.md).
 */
@Module({})
export class RefillMatchingModule {}
