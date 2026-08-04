import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AUDIT_LOG_PORT } from './audit-log.port';
import { KyselyAuditLogAdapter } from './kysely-audit-log.adapter';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: AUDIT_LOG_PORT, useClass: KyselyAuditLogAdapter }],
  exports: [AUDIT_LOG_PORT],
})
export class AuditModule {}
