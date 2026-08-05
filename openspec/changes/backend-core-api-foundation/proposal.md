# Proposal: `core-api` — fundación ejecutable (NestJS hexagonal + toolchain del monorepo)

## Intent

`services/core-api/` es hoy **solo documentación**: 7 `SPEC.md` sin una línea de código. No existe `package.json` en ningún punto del repo — no hay toolchain, ni test runner, ni forma de ejecutar nada.

La DB está terminada (17 tablas, RLS deny-all, service-role bypassea RLS). Eso significa que **`core-api` es el único escritor de todo el sistema y hoy no existe**. Las apps no pueden dejar de ser mockups HTML hasta que haya una API que consumir; la DB no tiene quién le escriba.

Este cambio hace dos cosas que solo se hacen una vez: **levanta el toolchain del monorepo** y **materializa la convención hexagonal** que los 5 dominios restantes van a copiar. Éxito = `core-api` arranca, los 6 casos de uso de `identidad` responden por HTTP con guards reales, `@repon/types` es importable, y `pnpm test` corre verde.

## Decisiones ya tomadas (no re-abrir)

| # | Decisión | Consecuencia directa |
|---|---|---|
| D1 | **pnpm workspaces**, sin Turborepo/Nx | La regla "ningún dominio importa el repositorio de otro" se enforcea por convención de carpetas + review, no por boundary tags. Nx queda como adición futura no destructiva. |
| D2 | **Shared kernel + `identidad` completos**; los otros 5 dominios como módulos placeholder | `identidad` es la implementación de referencia. Los 5 restantes se registran en `app.module.ts` y declaran sus tokens DI reales — sin casos de uso, sin adaptadores, sin lógica. |
| D3 | **`packages/types` promovido a código `.ts` en este cambio** | El dominio de `core-api` importa formas de entidad desde `@repon/types`. **Cero re-declaración** de tipos. |
| D4 | **Node 24.x LTS**, pinneado en `.tool-versions` **y** `.nvmrc` | Primera entrada Node del repo. |
| D5 | **Swagger dev-only** (`/api/docs` montado solo fuera de producción) | La superficie de API y las formas de DTO no se publican en prod. |
| D6 | **Librería de acceso a datos: diferida a `sdd-design`** | `supabase-js` solo vs. `supabase-js` (Auth/Storage) + Kysely/`pg` (repositorios, por transacciones multi-statement reales que `aceptarOferta`/`crearPedidoDesdeOferta` van a necesitar). **Debe resolverse antes del slice 4.** |
| **D7** | **`strict_tdd`: NO en este cambio, SÍ a partir del siguiente** (decisión nueva, ver abajo) | El flip es la **última tarea** de este cambio, no una precondición. |

### D7 — Recomendación explícita sobre `strict_tdd`

`openspec/config.yaml` dice `strict_tdd: false` con `testing.status: not_configured` porque *no había nada sobre lo cual ser estricto*. Este cambio elimina esa precondición y debe resolverla, no heredarla.

**Para ESTE cambio: NO activar strict TDD.** Razones técnicas, no de comodidad:

1. **Paradoja de bootstrap**: la primera tarea de este cambio *es crear el test runner*. No se puede hacer red-green-refactor antes de que exista `pnpm test`.
2. La mayor parte de los entregables no es testeable por TDD: `package.json`, `tsconfig`, workspace config, cableado DI, convención de carpetas, un paquete de tipos. Escribir un test que falle para "`SupabaseModule` expone `SUPABASE_CLIENT`" antes de que el módulo exista es teatro, no diseño.

**Pero este cambio SÍ entrega un piso de testing obligatorio** (Standard Mode: test en el mismo PR slice que el código, no "después"). Tres piezas — las únicas que cargan lógica real — no se aceptan sin tests:

| Pieza | Por qué es innegociable |
|---|---|
| Casos de uso de `identidad` con ports-out mockeados | Es la implementación de referencia; si no está testeada, los 5 dominios copian un patrón sin tests |
| `AuthGuard` + `RolesGuard` (incl. escenarios negativos) | Con RLS bypasseada, **esta ES la capa de autorización**. Sin backstop en DB |
| Contrato de compensación de `AuthProvider` (3 ramas) | Es spec ya finalizada (`auth-provisioning`); una implementación ingenua la pierde en silencio |

**Para los dominios 2-6 y todo cambio posterior: SÍ, `strict_tdd: true`.** Se flipea como última tarea de este cambio, una vez que `pnpm test` está verde y `openspec/config.yaml` tiene comandos reales. Razón: los dominios 2-6 son lógica de negocio pura contra puertos ya diseñados — exactamente la forma donde TDD paga. Y con RLS bypasseada, un check de autorización sin test en `ofertas` o `pedidos-pagos` no es un bug: es una fuga de datos cross-tenant.

## Scope

### In Scope

1. **Toolchain del repo** — `package.json` raíz, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc` + línea `nodejs` en `.tool-versions` (D4), ESLint + Prettier, `.env.example`.
2. **`@repon/types`** — `packages/types/SPEC.md` promovido a `.ts` real y exportable (D3). Fuente única de las formas de entidad.
3. **`core-api` arrancable** — `main.ts`, `app.module.ts`, `ValidationPipe` global, Swagger dev-only (D5), validación de env con **fail-fast al boot** si falta `SUPABASE_SERVICE_ROLE_KEY` (sin esa key no hay ninguna capa de autorización, no una degradada).
4. **Shared kernel** — `SupabaseModule` (token `SUPABASE_CLIENT`, service-role), `EventBusModule` (EventEmitter2 + tipo base `DomainEvent`), `AuthModule` (`AuthGuard`, `RolesGuard`, `@Roles()`, mecanismo de verificación JWT **configurable** HS256/JWKS), `ConfigModule`.
5. **`identidad` completo y vertical** — `domain/`, `ports-in/` (6 casos de uso **implementados**), `ports-out/` (4 interfaces + tokens DI), `adapters/http|persistence|events`, `identidad.module.ts`.
6. **Los otros 5 dominios: placeholder, in-scope pero mínimo** — `<dominio>.module.ts` registrado en `app.module.ts`, esqueleto de carpetas, y **constantes de token DI con los nombres reales de su propio `SPEC.md`** (`CATALOG_REPOSITORY`, `CATALOG_QUERY_PORT`, `CONSUMPTION_REPOSITORY`, `CONSUMPTION_LOG_REPOSITORY`, `REFILL_REPOSITORY`, `OFFER_REPOSITORY`, `ORDER_REPOSITORY`, `PAYMENT_GATEWAY_PORT`, `NOTIFICATION_PORT`, `EVENT_PUBLISHER`). Cero casos de uso, cero controladores, cero repositorios, cero lógica.
7. **Test runner** — Jest + `@nestjs/testing` + supertest, con los tests obligatorios de D7.
8. **CI mínima** — un workflow: install → lint → typecheck → test → build en PR. *Es in-scope a propósito*: flipear `strict_tdd: true` sin un gate es una promesa, no un invariante, y este es el momento más barato de la vida del repo para agregarlo (un package manager, un workspace, un comando de test).
9. **`openspec/config.yaml`** — `testing.status: configured`, comandos reales, `strict_tdd: true` (efectivo desde el próximo cambio).

### Out of Scope

- **Toda lógica de negocio de los dominios 2-6** — ningún cuerpo de caso de uso, controlador ni repositorio. Solo el placeholder de D2.
- **Adaptadores concretos de `NotificationPort` (Expo Push) y `PaymentGatewayPort` (Webpay/MercadoPago)** — se declaran interfaz + token en el shared kernel; el cuerpo pertenece al cambio que entrega su dominio consumidor.
- **Integración real con Auth (valores JWKS/HS256) y proyecto Supabase provisionado** — el guard se construye configurable por env; el modo de firma real se fija cuando exista el proyecto. **Sin tests de integración contra Auth en vivo en este cambio.**
- **Edge Functions y jobs** — cron de `consumo`, job de reconciliación de huérfanos (`v_auth_orphans`, ya diferido explícitamente en `identidad/SPEC.md`).
- **Deploy pipelines, entornos preview, matrices de build, tests de integración en CI (requieren proyecto provisionado + secrets), branch protection** — la CI de este cambio es un gate de calidad local, no una plataforma.
- **Turborepo/Nx y boundary tags** (D1). **`packages/ui`** y cualquier cambio en las 3 apps cliente.
- **Endpoint de bootstrap de admin** — prohibido por `auth-provisioning` (Q5); es runbook manual. No es "diferido", es una restricción permanente.

## Capabilities

### New Capabilities

- `repo-toolchain`: pnpm workspaces, pin de Node 24, TS base, lint/format, test runner, gate de CI, y la política `strict_tdd` (D7)
- `core-api-bootstrap`: proceso runtime, validación de env con fail-fast, Swagger dev-only, pipes globales, composición de módulos
- `core-api-hexagonal-layout`: convención de carpetas por dominio + **regla de import cross-dominio** (solo `contracts/` es importable desde otro dominio; `ports-out/`, `adapters/persistence/` y `domain/` nunca)
- `core-api-auth-guard`: verificación JWT, resolución `sub` → `profiles.id`, carga de `role` + sub-rol de `admin_roles`, enforcement de `@Roles()` — la capa de autorización que reemplaza a RLS en la conexión de `core-api`
- `core-api-identidad`: los 6 casos de uso, su superficie HTTP, eventos publicados y el comportamiento de compensación de provisioning
- `shared-types-package`: `@repon/types` como fuente única de formas de entidad + las reglas de validación de `packages/types/SPEC.md` que deben vivir en el tipo/DTO, no en el formulario

### Modified Capabilities

- `auth-provisioning`: **aclarar qué capa es dueña de la orquestación de la compensación.** `identidad/SPEC.md` dice "el adaptador debe llamar `deleteAccount`", pero estructuralmente solo el **caso de uso** sostiene simultáneamente `AuthProvider` y `ProfileRepository` — un adaptador de `AuthProvider` no conoce el repositorio de perfiles. Es una ambigüedad real que hay que cerrar antes de implementar, no durante.
- `db-access-control`: sin cambio de requisitos. Se referencia como la razón por la que existe `core-api-auth-guard`.

SPEC.md de producto actualizados de forma **declarada, no silenciosa**: `packages/types/SPEC.md`, `services/core-api/SPEC.md`, `services/core-api/domains/identidad/SPEC.md`.

## Approach

Bottom-up, 6 slices, cada uno revisable de forma independiente y terminando con `pnpm test` verde:

```
0. toolchain     pnpm workspace, Node 24, tsconfig base, lint/format, CI
1. tipos         packages/types/SPEC.md -> @repon/types (.ts real)
2. boot          main.ts, app.module.ts, config fail-fast, Swagger dev-only,
                 Jest cableado, smoke e2e (GET /health -> 200)
3. kernel        SupabaseModule, EventBus, AuthGuard/RolesGuard (+ sus tests),
                 NotificationPort/PaymentGatewayPort declarados sin cuerpo
4. identidad     domain, 6 casos de uso (+ tests con ports-out mockeados),
                 repositorios Supabase, controller + DTOs, eventos,
                 compensación de AuthProvider (+ tests de sus 3 ramas)
5. cierre        5 módulos placeholder, flip de strict_tdd, config.yaml
```

Los slices 0-3 se aterrizan **antes** de cualquier código de dominio: si las convenciones están mal, están mal sobre 0 dominios en vez de 6.

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| Raíz del repo | New | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, eslint/prettier, `.env.example` |
| `.tool-versions` | Modified | Agregar línea `nodejs 24.x` (hoy solo pinea `supabase`) |
| `.github/workflows/ci.yml` | New | install → lint → typecheck → test → build |
| `packages/types/src/**` | New | Código `.ts` real derivado de su `SPEC.md` |
| `packages/types/SPEC.md` | Modified | Deja de ser la fuente ejecutable; documenta el código |
| `services/core-api/src/**` | New | Todo el runtime (bootstrap, kernel, `identidad`, 5 placeholders) |
| `services/core-api/test/**` | New | Jest + supertest |
| `services/core-api/SPEC.md` | Modified | Convención de carpetas, regla de import cross-dominio, política de testing |
| `services/core-api/domains/identidad/SPEC.md` | Modified | Capa dueña de la compensación; puerto de auditoría (ver preguntas abiertas) |
| `openspec/config.yaml` | Modified | `testing.status`, comandos, `strict_tdd: true` |

## Risks

| Riesgo | Prob. / Impacto | Mitigación |
|---|---|---|
| **R1 — `AuthGuard` es la ÚNICA capa de autorización.** RLS está bypasseada en la conexión service-role: un bug en el guard o en un check manual tiene blast radius cross-tenant total, sin backstop en DB | Media / **Crítico** | Guard y carga de roles son testing obligatorio (D7); todo caso de uso recibe el `actorId` **explícito**, nunca un caller ambiente; `sdd-spec` escribe escenarios negativos (tenant equivocado, perfil suspendido, sub-rol admin faltante) |
| **R2 — Compensación de `AuthProvider` implementada de forma ingenua**: omitir forward-recovery, o compensar ante fallo *ambiguo* y borrar una cuenta válida | Media / Alto | Tests de las 3 ramas (éxito / fallo determinista → `deleteAccount` / fallo ambiguo → `findAccountByEmail`); `ON DELETE RESTRICT` es el backstop estructural; cerrar la ambigüedad de capa en `sdd-design` |
| **R3 — La convención hexagonal es barata hoy y carísima con 5 dominios encima** | Media / Alto | Slice 4 es la implementación de referencia; la convención se escribe como requisito de spec (`core-api-hexagonal-layout`), no como conocimiento tribal |
| **R4 — Deriva `@repon/types` ↔ esquema real** (3 fuentes: 17 tablas, `.ts`, `SPEC.md`) | Alta / Medio | Dirección única de verdad: esquema DB → `packages/types/src` → `SPEC.md` documenta. Follow-up: tipos generados de Supabase cuando D6 se resuelva |
| **R5 — D6 se resuelve hacia Kysely/`pg` DESPUÉS de escribir los repositorios** → reescritura de `adapters/persistence` | Media / Bajo | Los repositorios viven detrás de ports-out y solo existen los 2 de `identidad`. Ningún tipo del cliente cruza el borde del adaptador. **D6 debe cerrarse antes del slice 4** |
| **R6 — Presupuesto de review**: el slice 4 (`identidad` vertical + tests) supera holgadamente 400 líneas | Alta / Medio | `sdd-tasks` debe encadenar PRs; el slice 4 se sub-slicea (domain+repositorios / casos de uso+tests / adaptador HTTP) |
| **R7 — Node 24 + NestJS 11 + supabase-js: sorpresa de compatibilidad** | Baja / Medio | Node 24 es Active LTS; se verifica arrancando en el slice 2, el punto de detección más barato posible |
| **R8 — `strict_tdd: true` activado pero evitable localmente** | Baja / Medio | El check de CI es requerido y el flip es la última tarea, después de tener `pnpm test` verde |

## Rollback Plan

Greenfield: no hay deploy, ni datos, ni consumidores. Operacionalmente el rollback es `git revert` de la cadena de PRs y el repo vuelve a ser docs-only — costo prácticamente nulo. La pregunta real es **qué queda barato y qué queda caro de cambiar una vez que los dominios 2-6 estén construidos encima**:

| Barato de cambiar después | Caro de cambiar después |
|---|---|
| **Package manager (D1)**: pnpm → npm/yarn es un lockfile y una línea de CI | **Convención hexagonal de carpetas**: con 5 dominios espejándola, renombrar `ports-in`/`ports-out`/`adapters` es una refactor de 6 dominios con cero valor de negocio |
| Adoptar Turborepo/Nx (aditivo sobre pnpm workspaces) | **Regla de import cross-dominio**: si un dominio importa el repositorio de otro y no se detecta, el acoplamiento se propaga y re-dibujar el borde después es exactamente lo que hace fracasar la historia de extracción a microservicios de `core-api/SPEC.md` |
| Node minor/patch; bump de `.nvmrc` | **`@repon/types` como fuente única**: si `core-api` re-declara tipos aunque sea una vez, la deriva arranca ahí y reconciliar N copias después es manual |
| Exposición de Swagger (D5): una condición de env | **Modelo de autorización del guard**: cada caso de uso se escribe asumiendo una forma del actor autenticado; cambiarla toca todos los controladores y todas las firmas |
| **Librería de acceso a datos (D6)**: confinada detrás de ports-out, hoy solo con los adaptadores de `identidad` | **Nombres/ubicación de los tokens DI**: son las costuras; renombrarlos con 6 dominios referenciándolos es mecánico pero ancho |
| Agregar jobs de CI (coverage, matriz) | **`strict_tdd` activado y luego revertido**: una suite que fue opcional para 3 dominios no se vuelve obligatoria para el cuarto |

El seguro más barato: aterrizar los slices 0-3 como PRs propios **antes** de cualquier código de dominio.

## Dependencies

- Proyecto Supabase provisionado con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y configuración de firma JWT accesible. **El modo de firma real (HS256 vs. JWKS) debe leerse del proyecto antes de fijar el default del guard.** El stack local (`supabase start`, PR 0) cubre el desarrollo.
- Migraciones de `backend-supabase-migrations` aplicadas (ya archivado).
- Node 24.x + pnpm (vía corepack) disponibles en las máquinas de desarrollo.
- **D6 resuelto en `sdd-design` antes del slice 4.**

## Preguntas abiertas (para `sdd-spec` / `sdd-design`)

| # | Pregunta | Dueño |
|---|---|---|
| Q1 | D6: `supabase-js` solo vs. `supabase-js` + Kysely/`pg` | `sdd-design` |
| Q2 | Qué capa orquesta la compensación de provisioning: caso de uso o adaptador de `AuthProvider` | `sdd-design` |
| Q3 | **Falta un puerto de auditoría.** `aprobarEmpresa`, `suspenderUsuario`, `suspenderEmpresa` y `asignarRolAdmin` reciben `adminId` + `motivo` — exactamente la forma de una fila de `audit_log` (`actor_profile_id`, `accion`, `entity_type`, `entity_id`, `cambios`, `motivo`). `db-schema-auditoria` declara la tabla append-only y dice explícitamente "core-api writes", pero **ningún `SPEC.md` de dominio declara un `AuditLogRepository`**. O se agrega como ports-out de `identidad`, o es un servicio transversal del shared kernel. Hay que decidirlo con `identidad`, no con el cuarto dominio | `sdd-design` |
| Q4 | Modo de verificación JWT por defecto (HS256 secret vs. JWKS RS256) | Requiere el proyecto real; se construye configurable |

## Success Criteria

- [ ] `pnpm install && pnpm --filter core-api start:dev` arranca; el proceso sale con código distinto de cero y mensaje claro si falta `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `/api/docs` responde en dev y da 404 en modo producción (D5)
- [ ] `@repon/types` es importable desde `core-api` y la capa de dominio re-declara **cero** formas de entidad
- [ ] Los 6 casos de uso de `identidad` responden por HTTP con validación de DTO y cada uno tiene test unitario con ports-out mockeados
- [ ] `AuthGuard` resuelve `sub` → `profiles.id`, carga `role` + sub-rol admin, y tiene tests negativos (token inválido, perfil suspendido, sub-rol faltante)
- [ ] `registrarUsuario` tiene tests de las 3 rutas de provisioning (éxito, fallo determinista → borrado compensatorio, fallo ambiguo → recuperación hacia adelante)
- [ ] Ningún endpoint crea una fila de `admin_roles` sin un admin autenticado como caller (`auth-provisioning` Q5)
- [ ] No existe ningún DELETE físico salvo `AuthProvider.deleteAccount` como compensación in-request
- [ ] Los 5 módulos placeholder están registrados en `app.module.ts`, la app arranca con ellos, cada uno declara sus tokens DI con los nombres de su propio `SPEC.md`, y contienen cero lógica de negocio
- [ ] CI corre lint + typecheck + test + build en PR y está verde
- [ ] `openspec/config.yaml` tiene `testing.status: configured`, comandos reales y `strict_tdd: true`
