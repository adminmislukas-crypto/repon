# Design: `core-api` — fundación ejecutable

Cierra las 4 preguntas que `proposal.md` difirió (Q1–Q4) y fija los tres mecanismos que los 5 dominios restantes van a copiar: el guard de autorización, las convenciones de DI, y la forma en que un caso de uso expresa atomicidad sin conocer la librería de acceso a datos.

No re-abre D1–D5 ni D7. No define escenarios Given/When/Then (eso es `sdd-spec`). Diagramas en ASCII: convención existente del repo (`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `archive/…-backend-supabase-migrations/design.md`); no hay mermaid en ninguna parte.

---

## D-A · Acceso a datos (Q1 / D6)

**Choice**: **`supabase-js` para Auth Admin y Storage; Kysely sobre `pg` para todos los repositorios.** Dos tokens distintos en el shared kernel, dos conexiones distintas, cero solapamiento.

**Alternatives considered**

| Opción | Por qué se descarta |
|---|---|
| Solo `supabase-js` (PostgREST) | PostgREST no tiene transacciones multi-statement. **Ya falla en `identidad`**, no en el dominio 4: con D-C, 4 de los 6 casos de uso son `UPDATE tabla` + `INSERT audit_log`. Dos round-trips sin transacción producen mutación-sin-auditoría o auditoría-sin-mutación — exactamente lo que `db-schema-auditoria` existe para impedir |
| `supabase-js` + funciones Postgres (RPC) para lo multi-statement | Una llamada RPC sí es una transacción, pero mete lógica de negocio en la DB: contradice `docs/ARCHITECTURE.md` ("Supabase = infraestructura pura") y es la misma razón por la que el archivado D-1 rechazó el trigger `on auth.users insert`. Además es intesteable con ports-out mockeados (D7) |
| `pg` con SQL a mano, sin query builder | Sin chequeo de columnas en compilación empeora R4 (deriva esquema ↔ tipos). Kysely compila a SQL plano y `kysely-codegen` da tipos generados desde la DB — que es justamente el follow-up que R4 ya anticipaba |
| Prisma / TypeORM | ORM con su propio sistema de migraciones, que competiría con `supabase/migrations` (ya dueño del esquema). Kysely es query builder, no ORM: cero mapeo de entidades, cero migraciones |

**Cómo un caso de uso expresa atomicidad sin conocer Kysely** — puerto `TransactionManager` en el shared kernel con un handle opaco:

```ts
// src/shared/database/transaction.ts
declare const txBrand: unique symbol
export interface TransactionContext { readonly [txBrand]: true }   // opaco para el dominio
export interface TransactionManager {
  runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>
}
export const TRANSACTION_MANAGER = Symbol('TRANSACTION_MANAGER')
```

**Todo método de todo ports-out repository lleva un `tx?: TransactionContext` como último parámetro opcional.** Se paga hoy, con 4 interfaces, y no cuando `aceptarOferta` lo necesite con 6 dominios encima (el rollback plan lista los ports-out como "caro de cambiar después"). El cast `Transaction<DB> ⇄ TransactionContext` vive **solo** en `shared/database` y `adapters/persistence`.

Se descartó la alternativa de transacción ambiente vía `AsyncLocalStorage` (que dejaría las firmas de SPEC.md intactas): "olvidé abrir la transacción" sería un fallo invisible y autocommitado, y R1 de la proposal ya fijó la postura del repo — contexto explícito, nunca ambiente. Con `tx` explícito un test con mocks puede afirmar que el repositorio lo recibió.

**Regla de borde no negociable**: los tipos de fila generados (`snake_case`, `src/shared/database/schema.ts`) **nunca** cruzan el borde de `adapters/persistence/`. El dominio habla `@repon/types` (`camelCase`). `schema.ts` no vive en `@repon/types`.

**Consequences / riesgo nuevo**: el append-only de `audit_log` y la inmutabilidad de `order_items` **no** los enforcea RLS — los enforcean los `revoke update, delete … from service_role`. Una conexión `pg` como `postgres` (dueño de las tablas) ignora esos grants y esa garantía desaparece en silencio. Por lo tanto: **el pool de `core-api` DEBE ejecutar bajo un rol con los grants de `service_role`** (`SET ROLE service_role` al adquirir conexión, o un rol de login dedicado creado por migración). El mecanismo concreto se verifica contra el proyecto provisionado en el slice 3 con un test de integración que afirma que `UPDATE audit_log` **es rechazado**. Sin ese test, la decisión es una suposición.

Env nueva: `DATABASE_URL` (fail-fast al boot, misma clase que `SUPABASE_SERVICE_ROLE_KEY`).

---

## D-B · Quién orquesta la compensación de provisioning (Q2)

**Choice**: **el caso de uso `RegistrarUsuarioUseCase` es dueño del saga completo.** El adaptador de `AuthProvider` no orquesta nada; su única responsabilidad adicional es **clasificar el fallo**.

**Rationale**: estructuralmente solo el caso de uso sostiene `AuthProvider` y `ProfileRepository` a la vez. Darle al adaptador de `AuthProvider` una referencia al repositorio invierte el hexágono (un adaptador de salida dependiendo de otro puerto de salida), lo vuelve no sustituible y lo hace intesteable en aislamiento. Además el propio diagrama de `archive/…/design.md` D-1 pone la columna orquestadora en `core-api / identidad → registrarUsuario()`, no en el adaptador: la prosa de `identidad/SPEC.md` ("el adaptador **debe** llamar `deleteAccount`") contradice al diagrama que ella misma cita. **Es un bug de documentación, no una opción de diseño.**

**Lo que sí es del adaptador**: distinguir determinista de ambiguo requiere conocer códigos HTTP de Supabase Auth — eso es infraestructura. El puerto declara dos errores y el adaptador los produce:

```ts
// domains/identidad/ports-out/auth-provider.port.ts
export class AuthProviderDeterministicError extends Error {   // 4xx claro (p.ej. email ya registrado)
  constructor(readonly reason: 'email_taken' | 'invalid_credentials' | 'other', cause?: unknown) { … }
}
export class AuthProviderAmbiguousError extends Error {}       // timeout / 5xx: no se sabe si creó
```

**Insight que no debe perderse**: el paso (2) —`profiles`— **no** necesita clasificación de fallos. Se compensa **siempre**, ambiguo o no, porque `profiles.id → auth.users.id ON DELETE RESTRICT` hace la compensación segura por construcción: si la fila realmente se escribió, `deleteAccount` falla y no destruye un registro válido. Agregar clasificación al paso (2) sería redundante e introduciría un camino que deja un huérfano real sin compensar.

```
 IdentidadController   RegistrarUsuarioUseCase     AuthProvider      ProfileRepository   EventPublisher
                        (ports-in, dueño del saga)  (ports-out)       (ports-out)         (shared)
        |                        |                       |                  |                 |
  POST /identidad/usuarios       |                       |                  |                 |
        |--- execute(cmd) ------>|                       |                  |                 |
        |                   (1)  |--- createAccount ---->|                  |                 |
        |                        |<-- uid ---------------|                  |                 |
        |                   (2)  |--- insertIfAbsent(Profile{id:uid}) ----->|                 |
        |                        |    (ON CONFLICT (id) DO NOTHING)         |                 |
        |                        |<-- ok -----------------------------------|                 |
        |                   (3)  |--- publish(UsuarioRegistrado) -------------------------->   |
        |<-- Profile ------------|                                                    ==> 201
        |
  ==== RAMA A: (2) lanza cualquier error (constraint, red, timeout) ======================
        |                   (A1) |--- deleteAccount(uid) ->|  RESTRICT no bloquea: no hay fila
        |                        |<-- ok ------------------|
        |                   (A2) |  throw RegistroFallidoError   (el email queda libre)  ==> 503
        |                   (A3) |  si (A1) falla: logger.error({ orphanUid }) + throw.
        |                        |  NO se reintenta. v_auth_orphans lo detecta a los 15 min.
        |
  ==== RAMA B: (1) lanza AuthProviderAmbiguousError (timeout / 5xx) ======================
        |                   (B1) |--- findAccountByEmail(email) -->|
        |                        |<-- null ------------------------|  fallo limpio, reintentable
        |                        |    throw RegistroFallidoError                        ==> 503
        |                        |<-- { id } ----------------------|  RECUPERACION HACIA ADELANTE:
        |                        |    uid = id  ->  volver a (2).   NUNCA deleteAccount aqui.
        |
  ==== RAMA C: (1) lanza AuthProviderDeterministicError =================================
        |                        |  nada que compensar (no se creó cuenta)
        |                        |  reason='email_taken' ==> 409 ; resto ==> 502
```

`registrarUsuario` **no** escribe `audit_log`: es auto-servicio, no hay admin actor y `audit_log.actor_profile_id` es `NOT NULL` (ver D-C).

---

## D-C · Puerto de auditoría (Q3)

**Choice**: **servicio transversal del shared kernel** — `AuditLogPort` + token `AUDIT_LOG_PORT` en `src/shared/audit/`, no un ports-out de `identidad`.

**Rationale**

| Alternativa | Por qué se descarta |
|---|---|
| `ports-out/AuditLogRepository` en `identidad` | Cuando `pedidos-pagos` audite un reembolso, tendría que (i) importar los ports-out de `identidad` — prohibido explícitamente por `core-api/SPEC.md` — o (ii) declarar un segundo puerto duplicado sobre la misma tabla física, volviendo ambigua la propiedad de `audit_log` entre 6 adaptadores |
| Interceptor/decorador de Nest que audita solo | El payload `cambios` (antes/después) solo se conoce dentro del caso de uso, no en la capa HTTP. Y un interceptor escribiría la fila **fuera** de la transacción de la mutación, rompiendo exactamente la atomicidad que motivó D-A |

`AuditLog` no es entidad de `identidad`: ningún SPEC.md la declara como entidad poseída, no tiene casos de uso, ni ciclo de vida, ni eventos. `entity_type` es polimórfico por diseño. Encaja en la categoría que `core-api/SPEC.md` **ya tiene**: "Infraestructura compartida (no es un dominio de negocio)", junto a Auth, Notificaciones y Pasarela de pago.

```ts
// src/shared/audit/audit-log.port.ts
export interface AuditEntry {
  actorProfileId: string                      // SIEMPRE un admin autenticado
  accion: string                              // snake_case = nombre del caso de uso: 'aprobar_empresa'
  entityType: string                          // singular snake_case: 'company' | 'profile' | 'admin_role'
  entityId: string
  cambios: Record<string, { antes: unknown; despues: unknown }>   // forma fijada HOY
  motivo?: string
}
export interface AuditLogPort { record(entry: AuditEntry, tx?: TransactionContext): Promise<void> }
export const AUDIT_LOG_PORT = Symbol('AUDIT_LOG_PORT')
```

- **Solo `record`.** Sin métodos de lectura: la superficie de lectura de admin-web está fuera de alcance, y agregar un método después es aditivo, no breaking. Sin `update`/`delete` jamás: la tabla los rechaza incluso para service-role.
- **La forma de `cambios` se fija ahora** (`{ campo: { antes, despues } }`). Seis dominios la van a copiar; una `jsonb` con formas mixtas es inconsultable después y no hay migración barata.
- **Regla de atomicidad**: toda mutación auditada escribe su entrada **dentro de la misma transacción** que la mutación. Ese es el motivo de existir de `tx?`.

**Mapa de transacciones de `identidad`** (cierra qué contiene realmente el slice 4):

| Caso de uso | ¿Transacción? | Sentencias |
|---|---|---|
| `registrarUsuario` | No — saga cross-sistema (D-B) | Auth + 1 insert |
| `registrarEmpresa` | No | 1 insert |
| `aprobarEmpresa` | **Sí** | `UPDATE companies` + `INSERT audit_log` |
| `suspenderUsuario` | **Sí** | `UPDATE profiles` + `INSERT audit_log` |
| `suspenderEmpresa` | **Sí** | `UPDATE companies` + `INSERT audit_log` |
| `asignarRolAdmin` | **Sí** | `UPSERT admin_roles` + `INSERT audit_log` |

---

## D-D · Verificación JWT configurable (Q4)

No re-decide el modo (la proposal ya lo dejó "configurable, valores reales después). Fija el **mecanismo**.

```
AUTH_JWT_MODE=hs256|jwks        # default de desarrollo: hs256 (supabase start trae un secret estático)
SUPABASE_JWT_SECRET=…           # requerido sii mode=hs256
SUPABASE_JWKS_URL=…             # requerido sii mode=jwks
AUTH_JWT_ISSUER=…               # https://<ref>.supabase.co/auth/v1
AUTH_JWT_AUDIENCE=authenticated
```

El schema de config es una **unión discriminada por `AUTH_JWT_MODE`**: si falta la clave del modo elegido, el proceso sale con código distinto de cero al boot — misma clase de fallo que `SUPABASE_SERVICE_ROLE_KEY` (proposal §3), no una degradación silenciosa a "no verificar".

```ts
export interface JwtVerifier { verify(token: string): Promise<{ sub: string }> }  // lanza InvalidTokenError
// Hs256JwtVerifier  → jose.jwtVerify(token, secretKey, { issuer, audience })
// JwksJwtVerifier   → jose.jwtVerify(token, createRemoteJWKSet(url), { issuer, audience })
{ provide: JWT_VERIFIER, inject: [AppConfig],
  useFactory: (c) => c.authJwtMode === 'jwks' ? new JwksJwtVerifier(c) : new Hs256JwtVerifier(c) }
```

**La estrategia se elige una vez al boot, nunca por request.** Librería: `jose` — `createRemoteJWKSet` trae caché y rotación de llaves de fábrica y deja los dos modos simétricos (misma llamada `jwtVerify`, distinto resolvedor de llave). `@nestjs/jwt`/`jsonwebtoken` no soportan JWKS sin pegar `jwks-rsa` encima. Cambiar de modo = variable de entorno + restart, cero código. Supabase está migrando a llaves asimétricas con JWKS: por eso `jwks` es el destino esperado en producción, y por eso el default de prod se fija cuando el proyecto exista, no ahora.

---

## D-E · `AuthGuard` / `RolesGuard` — la única capa de autorización (R1)

**Choice**: dos guards globales (`APP_GUARD`), **fail-closed por defecto**, con opt-out explícito `@Public()`. Un endpoint nuevo del dominio 4 nace protegido; olvidar un decorador lo vuelve *más* estricto, nunca menos.

**El actor no se resuelve leyendo `profiles` desde el kernel.** `shared/auth` declara el contrato y `identidad` lo cumple (inversión de dependencia):

```ts
// src/shared/auth/ports/actor.port.ts        ← el kernel NO importa ningún dominio
export interface AuthenticatedActor {
  readonly profileId: string                  // = auth.uid() = profiles.id
  readonly role: Role                         // 'user' | 'provider' | 'admin'
  readonly status: ProfileStatus              // siempre 'activo' si el guard dejó pasar
  readonly companyId: string | null           // no-null sii role === 'provider'
  readonly companyStatus: CompanyStatus | null
  readonly adminRole: AdminRole | null        // no-null sii role === 'admin' y existe fila admin_roles
}
export interface ActorPort { findActorById(profileId: string): Promise<AuthenticatedActor | null> }
export const ACTOR_PORT = Symbol('ACTOR_PORT')
```

`IdentidadModule` provee `ACTOR_PORT` con `IdentidadActorAdapter` (`domains/identidad/contracts/`) — **un solo JOIN** `profiles ⋈ admin_roles ⋈ companies`, no tres round-trips — y lo exporta. Es la implementación de referencia de la regla "solo `contracts/` es importable cruzando el borde" (R3): cuando `ofertas` consuma `CatalogQueryPort`, copia este patrón.

**El actor nunca cruza el borde de ports-in.** El controlador lo lee con `@Actor()` y pasa **escalares** al caso de uso (`actor.profileId` → `adminId`). Esto satisface R1 ("actorId explícito, nunca un caller ambiente") y deja intactas las firmas de los 6 `SPEC.md` de dominio. `AuthenticatedActor` es `readonly` y **no** transporta el token ni los claims crudos: nada aguas abajo puede re-derivar autoridad de datos no verificados.

**Sin caché.** Es una query por request. Un actor cacheado es un bug de autorización rancia con blast radius cross-tenant (R1); si se agrega después, se agrega con invalidación diseñada, no de paso.

**`companyStatus` se carga pero el guard NO bloquea con él.** Un proveedor con empresa suspendida sigue autenticado y debe poder leer su propio estado; que no pueda ofertar es una regla de negocio de `ofertas`/`catalogo`, chequeada en el caso de uso. Instrucción explícita para los dominios 2-6.

```
 HTTP request        AuthGuard (APP_GUARD #1)      JwtVerifier      ActorPort (impl: identidad)
      |                       |                        |                      |
      |--- Authorization: Bearer <jwt> --------------->|                      |
      |                  [ @Public()? ] --- si --> allow, request.actor = undefined
      |                       |                        |                      |
      |                  (1)  |-- header ausente/malformado --> 401 MISSING_BEARER_TOKEN
      |                  (2)  |--- verify(token) ----->|                      |
      |                       |<-- InvalidTokenError --|  firma/exp/iss/aud   --> 401 INVALID_TOKEN
      |                       |<-- { sub } ------------|                      |
      |                  (3)  |  sub no es uuid ------------------------------> 401 INVALID_TOKEN
      |                  (4)  |--- findActorById(sub) ----------------------->|
      |                       |<-- throw (DB caida) -------------------------| --> 503 AUTH_BACKEND_UNAVAILABLE
      |                       |<-- null -------------------------------------| --> 401 PROFILE_NOT_PROVISIONED
      |                       |<-- AuthenticatedActor ----------------------- |
      |                  (5)  |  actor.status === 'suspendido' --------------> 403 PROFILE_SUSPENDED
      |                  (6)  |  request.actor = actor    ==> next
      |
      |               RolesGuard (APP_GUARD #2, Reflector: handler -> class)
      |                  (7)  |  sin metadata @Roles/@AdminRoles ==> allow
      |                  (8)  |  @Roles(...) y actor.role no está  --------> 403 ROLE_NOT_ALLOWED
      |                  (9)  |  @AdminRoles(...) y actor.role !== 'admin' -> 403 ROLE_NOT_ALLOWED
      |                 (10)  |  @AdminRoles(...) y actor.adminRole === null-> 403 ADMIN_SUBROLE_MISSING
      |                 (11)  |  @AdminRoles(...) y adminRole fuera de lista-> 403 ADMIN_SUBROLE_NOT_ALLOWED
      |                 (12)  |  ==> controller   @Actor() actor: AuthenticatedActor
```

Decisiones de estado HTTP, deliberadas:

- **`PROFILE_NOT_PROVISIONED` es 401, no 403**: el token es válido pero no hay identidad conocida que autorizar (es el caso huérfano de D-B). 403 implicaría una identidad conocida sin permiso.
- **`PROFILE_SUSPENDED` es 403, no 401**: la identidad sí es conocida. Un cliente interpreta 401 como "refrescá el token y reintentá" — devolver 401 a un suspendido lo mete en un loop de refresh infinito en vez de sacarlo de sesión.
- **Fallo de infraestructura es 503, jamás allow.** "Si no puedo verificar, dejo pasar" es la falla que R1 describe.
- **Dos decoradores, no uno**: `@Roles(...Role[])` y `@AdminRoles(...AdminRole[])`. Un `@Roles('super_admin')` único sería ambiguo sobre si además exige `role === 'admin'`; una omisión accidental ahí es escalación de privilegios.
- Un filtro de excepciones global emite `{ statusCode, code, message }` con `code` estable; nunca detalle interno.

**Orden de módulos (evita un ciclo de DI real)**: `AuthModule` exporta `JWT_VERIFIER`, los decoradores y las **clases** de guard; **no** registra `APP_GUARD`. El registro `APP_GUARD` vive en `AppModule`, que importa `AuthModule` e `IdentidadModule` (proveedor de `ACTOR_PORT`). Si `AuthModule` registrara el guard, `AuthModule ↔ IdentidadModule` sería circular.

---

## Convenciones de DI y wiring de módulos

**Tokens**: `Symbol('NOMBRE')`, `SCREAMING_SNAKE` derivado del nombre de la interfaz, **declarado exactamente una vez**, en el mismo archivo que su interfaz. Symbol y no string porque `EVENT_PUBLISHER` aparece en los ports-out de `identidad`, `ofertas` y `pedidos-pagos`: con strings, dos declaraciones del mismo literal colisionan en silencio; con symbols, el contenedor falla ruidosamente al boot.

**Shared kernel** (`SharedKernelModule`, `@Global()` — sin boilerplate de import en 6 módulos, pero la dependencia sigue siendo explícita en cada constructor vía `@Inject`):

| Token | Interfaz | Ubicación |
|---|---|---|
| `SUPABASE_CLIENT` | `SupabaseClient` (solo Auth Admin + Storage) | `shared/supabase/` |
| `DATABASE` | `Kysely<DB>` | `shared/database/` |
| `TRANSACTION_MANAGER` | `TransactionManager` | `shared/database/` |
| `EVENT_PUBLISHER` | `EventPublisher` | `shared/event-bus/` |
| `AUDIT_LOG_PORT` | `AuditLogPort` | `shared/audit/` |
| `NOTIFICATION_PORT` | `NotificationPort` | `shared/notifications/` (declarado, sin cuerpo) |
| `PAYMENT_GATEWAY_PORT` | `PaymentGatewayPort` | `shared/payments/` (declarado, sin cuerpo) |
| `JWT_VERIFIER` | `JwtVerifier` | `shared/auth/` |
| `ACTOR_PORT` | `ActorPort` | `shared/auth/` (lo implementa `identidad`) |

`EVENT_PUBLISHER`, `NOTIFICATION_PORT` y `PAYMENT_GATEWAY_PORT` viven en el kernel aunque los `SPEC.md` de dominio los listen entre sus puertos de salida: `core-api/SPEC.md` **ya** clasifica notificaciones y pasarela como "Infraestructura compartida (no es un dominio de negocio)". La interfaz sigue siendo la dependencia declarada del dominio; al extraerlo como microservicio se lleva la interfaz y la liga a su propio adaptador (broker externo). No hay contradicción que resolver.

**Ports-out por dominio** (declarados en el slice 5 para los 5 placeholder, sin implementación):

| Dominio | Tokens |
|---|---|
| `identidad` | `PROFILE_REPOSITORY`, `COMPANY_REPOSITORY`, `ADMIN_ROLE_REPOSITORY`, `AUTH_PROVIDER` |
| `catalogo` | `CATALOG_REPOSITORY`, `CATALOG_QUERY_PORT` |
| `consumo` | `CONSUMPTION_REPOSITORY`, `CONSUMPTION_LOG_REPOSITORY` |
| `refill-matching` | `REFILL_REPOSITORY` |
| `ofertas` | `OFFER_REPOSITORY` |
| `pedidos-pagos` | `ORDER_REPOSITORY` |

```ts
@Module({
  controllers: [IdentidadController],
  providers: [
    RegistrarUsuarioUseCase, RegistrarEmpresaUseCase, AprobarEmpresaUseCase,
    SuspenderUsuarioUseCase, SuspenderEmpresaUseCase, AsignarRolAdminUseCase,
    { provide: PROFILE_REPOSITORY,    useClass: KyselyProfileRepository },
    { provide: COMPANY_REPOSITORY,    useClass: KyselyCompanyRepository },
    { provide: ADMIN_ROLE_REPOSITORY, useClass: KyselyAdminRoleRepository },
    { provide: AUTH_PROVIDER,         useClass: SupabaseAuthProvider },
    { provide: ACTOR_PORT,            useClass: IdentidadActorAdapter },
  ],
  exports: [ACTOR_PORT],
})
export class IdentidadModule {}
```

**Los 5 módulos placeholder declaran tokens e interfaces pero NO los bindean.** Nada los inyecta todavía, así que un token sin proveedor es correcto. Prohibido `useValue: {}`: un stub que no-opea en silencio es peor que un proveedor faltante, que falla ruidosamente al boot.

**Nombres de archivo**: `ports-out/profile-repository.port.ts` (interfaz + token), `ports-in/registrar-usuario.use-case.ts`, `adapters/persistence/kysely-profile.repository.ts`, `adapters/http/identidad.controller.ts` · `dto/*.dto.ts` · `identidad.mapper.ts`, `domain/profile.entity.ts` · `events/usuario-registrado.event.ts`.

---

## Superficie HTTP de `identidad`

| Método + ruta | Guard | Caso de uso |
|---|---|---|
| `POST /identidad/usuarios` | `@Public()` | `registrarUsuario` |
| `POST /identidad/empresas` | `@Public()` | `registrarEmpresa` |
| `POST /identidad/empresas/:id/aprobacion` | `@AdminRoles('super_admin','soporte')` | `aprobarEmpresa` |
| `POST /identidad/empresas/:id/suspension` | `@AdminRoles('super_admin','soporte')` | `suspenderEmpresa` |
| `POST /identidad/usuarios/:id/suspension` | `@AdminRoles('super_admin','soporte')` | `suspenderUsuario` |
| `PUT /identidad/usuarios/:id/rol-admin` | `@AdminRoles('super_admin')` | `asignarRolAdmin` |

Sub-recurso `POST` en vez de un `PATCH` genérico: con service-role escribiendo, un `PATCH /empresas/:id` abierto es una superficie de mass-assignment. `asignarRolAdmin` es `super_admin`-only porque es escalación de privilegios. **La matriz definitiva de sub-roles la escribe `sdd-spec`**; esto es el default recomendado.

---

## Secuencia de implementación (detalle que `sdd-tasks` necesita)

Los slices 0, 1 y 5 no cambian respecto de la proposal. Los slices 2-4 sí:

**Slice 2 (boot)** — el schema de env ya incluye `DATABASE_URL` y la unión discriminada de `AUTH_JWT_MODE` (D-D), aunque nada los consuma todavía. `GET /health` queda abierto porque aún no hay guard; su test e2e es el detector de regresión de "¿lo cerramos sin querer?" en el slice 4.

**Slice 3 (kernel)**, en este orden: 3.1 `shared/database` (pool `pg` + Kysely + `TRANSACTION_MANAGER` + test de integración del rol/grants) → 3.2 `shared/supabase` → 3.3 `shared/event-bus` → 3.4 `shared/audit` → 3.5 `shared/auth` (verifiers, `AuthenticatedActor`, `ActorPort` **solo interfaz**, decoradores, ambos guards + matriz negativa completa con `ActorPort` mockeado, sin DB) → 3.6 `shared/notifications` + `shared/payments` (interfaz + token, sin cuerpo).

**El registro `APP_GUARD` NO va en el slice 3.** `ACTOR_PORT` no tiene proveedor hasta el slice 4 y la app no arrancaría. Los guards se entregan testeados y sin montar.

**Slice 4 (identidad)**, sub-sliceado por R6:

- **4a — dominio + persistencia + actor**: `domain/` (entidades y factories, invariante `role='provider' ⇒ companyId`), los 4 `ports-out/*.port.ts` con `tx?`, `adapters/persistence/kysely-*.repository.ts`, `contracts/IdentidadActorAdapter`, `IdentidadModule` exportando `ACTOR_PORT`, **registro `APP_GUARD` en `AppModule`**, e2e: ruta protegida → 401 sin token, `/health` sigue 200.
- **4b — casos de uso + tests**: los 6 con ports-out mockeados; las 3 ramas de compensación de D-B; los 4 que abren transacción y escriben `audit_log` dentro (D-C); errores de dominio.
- **4c — adaptador HTTP**: controller, DTOs (`class-validator` + `@ApiProperty`), mappers, filtro de excepciones, `@AdminRoles` en las 4 rutas admin, adaptador de eventos, e2e.

---

## Deltas de `SPEC.md` que `sdd-spec` debe absorber (declarados, no silenciosos)

| Archivo | Delta | Motivo |
|---|---|---|
| `identidad/SPEC.md` | La compensación la orquesta el **caso de uso**, no el adaptador | D-B: la prosa contradice al diagrama D-1 que ella cita |
| `identidad/SPEC.md` | `ProfileRepository.save` → **`insertIfAbsent` + `update`** | Un solo `save` no puede expresar a la vez "creación idempotente que jamás sobrescribe" (D-1) y "mutación de fila existente". Conflatarlos vuelve el contrato de compensación inimplementable como está escrito |
| `identidad/SPEC.md` | **Falta `AdminRoleRepository`** (`upsert`, `findByProfileId`) | `asignarRolAdmin` no tiene puerto para escribir `admin_roles`. Con `EVENT_PUBLISHER` movido al kernel, `identidad` sigue teniendo 4 ports-out propios |
| `identidad/SPEC.md` | **`asignarRolAdmin(profileId, rol)` necesita `adminId`** | `admin_roles.granted_by` es `NOT NULL REFERENCES profiles(id)`. La firma documentada no puede satisfacer el esquema |
| `identidad/SPEC.md` | Todo método de ports-out lleva `tx?: TransactionContext` | D-A |
| `identidad/SPEC.md` | Consume `AuditLogPort` del kernel; los 4 casos de uso admin auditan | D-C |
| `core-api/SPEC.md` | Agregar **Auditoría** a "Infraestructura compartida"; convención de carpetas; regla de import cross-dominio; `AuthenticatedActor` nunca cruza ports-in | D-C, D-E, R3 |
| `packages/types/SPEC.md` | Los tipos de fila de DB (`schema.ts`) **no** viven acá | D-A |

---

## Estrategia de testing

| Capa | Qué se prueba | Cómo | ¿CI? |
|---|---|---|---|
| Unit | 6 casos de uso con ports-out mockeados; 3 ramas de compensación; auditoría dentro de la transacción | Jest + mocks planos (los casos de uso son clases planas, no necesitan el contenedor de Nest) | Sí |
| Unit | `AuthGuard`/`RolesGuard`: matriz negativa completa (11 ramas del diagrama) | Jest + `JwtVerifier` y `ActorPort` mockeados + `ExecutionContext` falso | Sí |
| Unit | Entidades e invariantes de dominio | Jest puro | Sí |
| Integración | Repositorios Kysely, rollback de `TransactionManager`, y **`UPDATE audit_log` rechazado** | `supabase start` local (54322), opt-in por env | **No** — requiere DB, fuera de alcance |
| E2E | `/health` 200; ruta protegida 401 sin token; `/api/docs` 404 en modo producción | `supertest` + `Test.createTestingModule` con `ACTOR_PORT`/`JWT_VERIFIER` sobreescritos | Sí |

---

## Preguntas abiertas

- [ ] **Rol de conexión de `pg`**: `SET ROLE service_role` por conexión vs. rol de login dedicado por migración. Se cierra contra el proyecto provisionado, con el test de grants como criterio de aceptación (D-A).
- [ ] **`registrarEmpresa` y `company_dispatch_zones`**: ningún `SPEC.md` declara un caso de uso que escriba zonas de despacho. Este cambio solo escribe `companies`. No se inventa.
- [ ] **Relación `registrarUsuario` ↔ `registrarEmpresa` para un proveedor**: quién crea primero y quién setea `profiles.company_id`. Lo cierra `sdd-spec`.
- [ ] Matriz definitiva de sub-roles admin por ruta (default recomendado arriba).
- [ ] Modo JWT de producción (`hs256` vs `jwks`): requiere el proyecto real; el mecanismo ya no bloquea (D-D).
