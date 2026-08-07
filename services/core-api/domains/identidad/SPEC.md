# Dominio: Identidad

Fuente de verdad de quién es quién en el sistema: usuarios, empresas proveedoras y administradores. Ningún otro dominio guarda datos de perfil — solo referencian el `id`.

## Entidades que posee

- `Profile` (usuario, proveedor o admin)
- `Company` (empresa proveedora, con `status`: `pendiente` / `activo` / `suspendido`)
- `AdminRoleAssignment` (la fila `admin_roles`: `profileId`, `rol` (`AdminRole`: `super_admin` / `soporte` / `finanzas`), `grantedBy`, `createdAt`) — nombre corregido por `backend-core-api-foundation` (fase 5.4) para desambiguar del enum `AdminRole` de `@repon/types`; `identidad/SPEC.md` los listaba originalmente bajo el mismo nombre.

## Puertos de entrada (casos de uso)

```ts
interface IdentidadInboundPort {
  registrarUsuario(datos: RegistroUsuario): Promise<Profile>
  registrarEmpresa(datos: RegistroEmpresa): Promise<Company>       // queda en status 'pendiente'
  aprobarEmpresa(companyId: string, adminId: string): Promise<void>
  suspenderUsuario(profileId: string, adminId: string, motivo: string): Promise<void>
  suspenderEmpresa(companyId: string, adminId: string, motivo: string): Promise<void>
  reactivarEmpresa(companyId: string, adminId: string, motivo: string): Promise<void>   // delta D16 (backend-core-api-catalogo): agregado
  asignarRolAdmin(profileId: string, rol: AdminRole, adminId: string): Promise<void>   // delta 5.4: adminId agregado
}
```

`asignarRolAdmin` ahora recibe `adminId` explícito: `admin_roles.granted_by` es `NOT NULL REFERENCES profiles(id)`, y la firma original no tenía forma de satisfacer esa columna.

**Delta D16 (`backend-core-api-catalogo`)**: hasta este delta, `identidad` no tenía ningún caso de uso que transicionara `suspendido → activo` — `aprobarEmpresa` solo cubre `pendiente → activo`. `reactivarEmpresa` cierra ese hueco, puramente aditivo (ningún caso de uso existente cambia de firma ni de comportamiento). Espejo exacto de `suspenderEmpresa` (admin-mutante, auditado en la misma transacción vía `AuditLogPort`, mismos sub-roles `@AdminRoles('super_admin', 'soporte')`) con una diferencia deliberada: exige `company.status === 'suspendido'` como precondición — a diferencia de `suspenderEmpresa` (destino `suspendido`, alcanzable desde cualquier estado, falla-seguro por diseño), el destino de `reactivarEmpresa` (`activo`) es permisivo, así que sin la precondición reactivar una empresa `pendiente` la activaría saltándose la aprobación. Si la precondición no se cumple, lanza `CompanyNotSuspendedError` (mapeado a HTTP 409) antes de cualquier escritura. Motivación: cierra el lado de escritura de la proyección de visibilidad de `catalogo` (ver `catalogo/SPEC.md`, "Eventos que consume") — sin este caso de uso, una empresa suspendida no tenía ningún camino de vuelta a visible.

## Puertos de salida (lo que el dominio necesita, sin saber cómo se implementa)

```ts
interface ProfileRepository {
  insertIfAbsent(profile: Profile, tx?: TransactionContext): Promise<void>   // ON CONFLICT (id) DO NOTHING — retry-safe, nunca sobrescribe
  update(profile: Profile, tx?: TransactionContext): Promise<void>
  findById(id: string, tx?: TransactionContext): Promise<Profile | null>
}
interface CompanyRepository {
  save(company: Company, tx?: TransactionContext): Promise<void>   // sigue siendo un solo método — companies no tiene el mismo requisito de compensación-retry que Profile
  findById(id: string, tx?: TransactionContext): Promise<Company | null>
}
interface AdminRoleRepository {                                    // delta 5.4: puerto que faltaba — asignarRolAdmin no tenía dónde escribir admin_roles
  upsert(assignment: AdminRoleAssignment, tx?: TransactionContext): Promise<void>   // UNIQUE(profile_id) — un re-grant reemplaza, nunca duplica
  findByProfileId(profileId: string, tx?: TransactionContext): Promise<AdminRoleAssignment | null>
}
interface AuthProvider {          // adaptador hacia Supabase Auth — sin `tx?`: Auth vive fuera de la transacción SQL (design.md D-A)
  createAccount(email: string, password: string): Promise<string>
  deleteAccount(id: string): Promise<void>      // única eliminación física permitida (design.md D-1)
  findAccountByEmail(email: string): Promise<{ id: string } | null>
}
interface EventPublisher {        // implementado por el shared kernel (`EVENT_PUBLISHER`, design.md §"Convenciones de DI"), no un adaptador propio de identidad
  publish(event: DomainEvent): Promise<void>
}
```

**Delta 5.4 (`backend-core-api-foundation`, design.md D-A): todo método de `ProfileRepository`/`CompanyRepository`/`AdminRoleRepository` lleva un `tx?: TransactionContext` final opcional** — permite que `aprobarEmpresa`/`suspenderUsuario`/`suspenderEmpresa`/`asignarRolAdmin` escriban su mutación y su entrada de `AuditLogPort` (ver más abajo) dentro de la misma transacción SQL. `AuthProvider` y `EventPublisher` quedan afuera de esta regla a propósito: Auth es un sistema externo sin transacción SQL que compartir, y publicar un evento nunca debe revertirse junto con un rollback de base de datos.

**Delta 5.4: `identidad` consume `AuditLogPort`/`AUDIT_LOG_PORT` del shared kernel** (`shared/audit/`, design.md D-C) — no es un ports-out propio de este dominio, es infraestructura compartida (ver `core-api/SPEC.md`). Los 4 casos de uso que mutan con actor admin (`aprobarEmpresa`, `suspenderUsuario`, `suspenderEmpresa`, `asignarRolAdmin`) escriben su entrada de auditoría dentro del mismo `TransactionManager.runInTransaction` que la mutación — nunca fuera. `registrarUsuario`/`registrarEmpresa` NO auditan: son auto-servicio, sin actor admin, y `audit_log.actor_profile_id` es `NOT NULL`.

### Contrato de compensación de `AuthProvider` (design.md D-B, corrige D-1)

**Delta 5.4 — corrección de un bug de documentación**: la compensación la orquesta **`RegistrarUsuarioUseCase` (`ports-in`)**, nunca el adaptador de `AuthProvider`. La prosa original de esta sección decía "el adaptador **debe** llamar `deleteAccount`", pero el propio diagrama que cita (`archive/…/design.md` D-1) siempre puso la orquestación en `core-api / identidad → registrarUsuario()`. Estructuralmente solo el caso de uso sostiene `AuthProvider` y `ProfileRepository` a la vez — darle al adaptador de `AuthProvider` una referencia al repositorio invertiría el hexágono (un adaptador de salida dependiendo de otro puerto de salida) y lo volvería intesteable en aislamiento. Lo único que sí es responsabilidad del adaptador: clasificar el fallo (`AuthProviderDeterministicError` con `reason: 'email_taken' | 'invalid_credentials' | 'other'`, o `AuthProviderAmbiguousError` para timeout/5xx) — eso sí requiere conocer los códigos HTTP de Supabase Auth, que es infraestructura.

`registrarUsuario` es Auth-first: primero `createAccount`, luego el `INSERT` en `profiles` (`id = uid` de Auth, `ON CONFLICT (id) DO NOTHING` — idempotente ante reintentos). `profiles.id` referencia `auth.users.id` con `ON DELETE RESTRICT`, lo que hace la compensación segura por construcción: el borrado del usuario de Auth solo puede tener éxito cuando **no** existe fila `profiles`.

- **Fallo determinista** del paso `profiles` (constraint, red, timeout de DB con respuesta clara de fallo): el **caso de uso** llama `deleteAccount(uid)` como compensación in-request. Gracias al `ON DELETE RESTRICT`, este borrado nunca puede tener éxito si ya existe una fila `profiles` para ese `uid` — protege contra compensar por error un registro que en realidad sí se completó. Si la compensación misma falla, el caso de uso registra el `uid` huérfano y de todos modos lanza (nunca reintenta la compensación).
- **Fallo ambiguo** del paso `createAccount` (timeout, 5xx, clasificado por el adaptador como `AuthProviderAmbiguousError`): el caso de uso **nunca** borra. Se recupera hacia adelante llamando `findAccountByEmail(email)`: si no existe, el fallo fue limpio y reintentable; si existe (devuelve el `uid`), el dominio reintenta el `INSERT` de `profiles` con ese `uid` — la cuenta de Auth pudo haber quedado válida y borrarla sería destructivo.
- **Fallo determinista** del paso `createAccount` (`AuthProviderDeterministicError`): no hay nada que compensar (no se creó cuenta) — `reason === 'email_taken'` mapea a 409, el resto a 502.
- Si la compensación in-request (`deleteAccount`) falla, el `uid` queda huérfano: lo detecta `public.v_auth_orphans` (`supabase/migrations/20260803120110_01b_identidad_admin.sql`), service-role-only, ventana de gracia de 15 minutos. El job de reconciliación que consume esa vista se entrega en el cambio de Edge Functions, no en este — la política es siempre detectar y alertar, nunca auto-borrar (un huérfano de >15 min es estado histórico ambiguo).
- `deleteAccount` es la única eliminación física permitida en todo el sistema, y solo dentro de la ventana de la request que la originó.
- `registrarUsuario` **no** escribe `audit_log`: es auto-servicio, no hay actor admin y `audit_log.actor_profile_id` es `NOT NULL`.

## Eventos que publica

- `UsuarioRegistrado`
- `EmpresaRegistrada`
- `EmpresaAprobada` — habilita a `catalogo` y `refill-matching` a considerar esta empresa
- `EmpresaSuspendida` — obliga a `catalogo` a ocultar su catálogo (de lecturas cross-tenant, ver `catalogo/SPEC.md`) y a `refill-matching` a excluirla del matching
- `EmpresaReactivada` (delta D16, `backend-core-api-catalogo`) — reverso de `EmpresaSuspendida`; `catalogo` lo consume con el mismo handler que usa para `EmpresaAprobada`
- `UsuarioSuspendido`

## Eventos que consume

Ninguno. `Identidad` es la fuente de verdad, no reacciona a otros dominios.

## Al extraer como microservicio independiente

Es el mejor candidato para extraer primero: bajo acoplamiento (nadie escribe en sus tablas), y `AuthProvider` ya es un adaptador limpio hacia Supabase Auth. Su base de datos (`profiles`, `companies`, `admin_roles`) se separa sin fricción porque ningún otro dominio hace `JOIN` directo contra ella.
