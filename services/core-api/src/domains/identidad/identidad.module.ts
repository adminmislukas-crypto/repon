import { Module } from '@nestjs/common';
import { ACTOR_PORT } from '../../shared/auth/ports/actor.port';
import { DatabaseModule } from '../../shared/database/database.module';
import { KyselyAdminRoleRepository } from './adapters/persistence/kysely-admin-role.repository';
import { KyselyCompanyRepository } from './adapters/persistence/kysely-company.repository';
import { KyselyProfileRepository } from './adapters/persistence/kysely-profile.repository';
import { SupabaseAuthProvider } from './adapters/persistence/supabase-auth.provider';
import { IdentidadController } from './adapters/http/identidad.controller';
import { IdentidadActorAdapter } from './contracts/identidad-actor.adapter';
import { AprobarEmpresaUseCase } from './ports-in/aprobar-empresa.use-case';
import { AsignarRolAdminUseCase } from './ports-in/asignar-rol-admin.use-case';
import { ReactivarEmpresaUseCase } from './ports-in/reactivar-empresa.use-case';
import { RegistrarEmpresaUseCase } from './ports-in/registrar-empresa.use-case';
import { RegistrarUsuarioUseCase } from './ports-in/registrar-usuario.use-case';
import { SuspenderEmpresaUseCase } from './ports-in/suspender-empresa.use-case';
import { SuspenderUsuarioUseCase } from './ports-in/suspender-usuario.use-case';
import { ADMIN_ROLE_REPOSITORY } from './ports-out/admin-role-repository.port';
import { AUTH_PROVIDER } from './ports-out/auth-provider.port';
import { COMPANY_REPOSITORY } from './ports-out/company-repository.port';
import { PROFILE_REPOSITORY } from './ports-out/profile-repository.port';

// design.md's DI wiring table + tasks.md 4a.5/4b/4c: binds the 3
// Kysely-backed repositories, `AUTH_PROVIDER` (`SupabaseAuthProvider` —
// see its own file doc comment for why it lives under
// `adapters/persistence/`), the 6 identidad use cases, `IdentidadController`
// (this commit, `adapters/http/`), and provides `ACTOR_PORT`.
// `TRANSACTION_MANAGER`, `AUDIT_LOG_PORT`, and `EVENT_PUBLISHER` are
// injected straight from the `@Global()` shared kernel (design.md's
// DI-token table) — nothing to bind here for those three.
@Module({
  imports: [DatabaseModule],
  controllers: [IdentidadController],
  providers: [
    { provide: PROFILE_REPOSITORY, useClass: KyselyProfileRepository },
    { provide: COMPANY_REPOSITORY, useClass: KyselyCompanyRepository },
    { provide: ADMIN_ROLE_REPOSITORY, useClass: KyselyAdminRoleRepository },
    { provide: AUTH_PROVIDER, useClass: SupabaseAuthProvider },
    { provide: ACTOR_PORT, useClass: IdentidadActorAdapter },
    RegistrarUsuarioUseCase,
    RegistrarEmpresaUseCase,
    AprobarEmpresaUseCase,
    SuspenderUsuarioUseCase,
    SuspenderEmpresaUseCase,
    ReactivarEmpresaUseCase,
    AsignarRolAdminUseCase,
  ],
  exports: [ACTOR_PORT],
})
export class IdentidadModule {}
