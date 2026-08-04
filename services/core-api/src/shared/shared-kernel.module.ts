import { Global, Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { EventBusModule } from './event-bus/event-bus.module';
import { SupabaseModule } from './supabase/supabase.module';

/**
 * Aggregates every shared-kernel module with a real provider (design.md's DI
 * token table) behind one `@Global()` import — `AppModule` imports this
 * instead of each module individually (task 3.10, the follow-up PR 4's
 * `app.module.ts` flagged). `shared/notifications` and `shared/payments`
 * declare tokens but bind no provider yet (task 3.9), so there is nothing
 * for a Nest module to aggregate there until a domain implements them —
 * they are intentionally not wired here.
 */
@Global()
@Module({
  imports: [DatabaseModule, SupabaseModule, EventBusModule, AuditModule, AuthModule],
  exports: [DatabaseModule, SupabaseModule, EventBusModule, AuditModule, AuthModule],
})
export class SharedKernelModule {}
