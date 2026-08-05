import { Module } from '@nestjs/common';
import { ACTOR_PORT } from '../../shared/auth/ports/actor.port';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyAdminRoleRepository } from './adapters/persistence/kysely-admin-role.repository';
import { KyselyCompanyRepository } from './adapters/persistence/kysely-company.repository';
import { KyselyProfileRepository } from './adapters/persistence/kysely-profile.repository';
import { IdentidadActorAdapter } from './contracts/identidad-actor.adapter';
import { ADMIN_ROLE_REPOSITORY } from './ports-out/admin-role-repository.port';
import { COMPANY_REPOSITORY } from './ports-out/company-repository.port';
import { PROFILE_REPOSITORY } from './ports-out/profile-repository.port';

// design.md's DI wiring table + tasks.md 4a.5: binds the 3 Kysely-backed
// repositories and provides `ACTOR_PORT`. `AUTH_PROVIDER`/use cases land in
// Phase 4b — `auth-provider.port.ts` only declares the interface for now.
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: PROFILE_REPOSITORY, useClass: KyselyProfileRepository },
    { provide: COMPANY_REPOSITORY, useClass: KyselyCompanyRepository },
    { provide: ADMIN_ROLE_REPOSITORY, useClass: KyselyAdminRoleRepository },
    { provide: ACTOR_PORT, useClass: IdentidadActorAdapter },
  ],
  exports: [ACTOR_PORT],
})
export class IdentidadModule {}
