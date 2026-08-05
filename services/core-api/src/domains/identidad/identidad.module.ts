import { Module } from '@nestjs/common';
import { ACTOR_PORT } from '../../shared/auth/ports/actor.port';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyAdminRoleRepository } from './adapters/persistence/kysely-admin-role.repository';
import { KyselyCompanyRepository } from './adapters/persistence/kysely-company.repository';
import { KyselyProfileRepository } from './adapters/persistence/kysely-profile.repository';
import { IdentidadActorAdapter } from './contracts/identidad-actor.adapter';
import { AprobarEmpresaUseCase } from './ports-in/aprobar-empresa.use-case';
import { AsignarRolAdminUseCase } from './ports-in/asignar-rol-admin.use-case';
import { RegistrarEmpresaUseCase } from './ports-in/registrar-empresa.use-case';
import { SuspenderEmpresaUseCase } from './ports-in/suspender-empresa.use-case';
import { SuspenderUsuarioUseCase } from './ports-in/suspender-usuario.use-case';
import { ADMIN_ROLE_REPOSITORY } from './ports-out/admin-role-repository.port';
import { COMPANY_REPOSITORY } from './ports-out/company-repository.port';
import { PROFILE_REPOSITORY } from './ports-out/profile-repository.port';

// design.md's DI wiring table + tasks.md 4a.5/4b.3-4b.5: binds the 3
// Kysely-backed repositories, provides `ACTOR_PORT`, and wires the 5 use
// cases that need no `AUTH_PROVIDER`. `RegistrarUsuarioUseCase` and its
// `AUTH_PROVIDER` binding land in the next commit (4b.1's saga needs a real
// `SupabaseAuthProvider` bound before it's safe to eagerly instantiate in
// this module — see that commit for why). `TRANSACTION_MANAGER`,
// `AUDIT_LOG_PORT`, and `EVENT_PUBLISHER` are injected straight from the
// `@Global()` shared kernel (design.md's DI-token table) — nothing to bind
// here for those three.
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: PROFILE_REPOSITORY, useClass: KyselyProfileRepository },
    { provide: COMPANY_REPOSITORY, useClass: KyselyCompanyRepository },
    { provide: ADMIN_ROLE_REPOSITORY, useClass: KyselyAdminRoleRepository },
    { provide: ACTOR_PORT, useClass: IdentidadActorAdapter },
    RegistrarEmpresaUseCase,
    AprobarEmpresaUseCase,
    SuspenderUsuarioUseCase,
    SuspenderEmpresaUseCase,
    AsignarRolAdminUseCase,
  ],
  exports: [ACTOR_PORT],
})
export class IdentidadModule {}
