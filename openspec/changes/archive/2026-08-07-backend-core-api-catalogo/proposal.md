# Proposal: `catalogo` — segundo vertical de dominio sobre la fundación hexagonal

## Intent

`services/core-api/src/domains/catalogo/` son hoy **3 archivos**: dos interfaces `ports-out` y un `@Module({})` vacío. Cero casos de uso, cero adaptadores, cero lógica. La DB (`catalog_products`, `provider_catalog`) está migrada y con RLS desde `backend-supabase-migrations`, pero **nadie le escribe**: sin `catalogo`, un proveedor no puede cargar un solo producto y `refill-matching`/`ofertas` no tienen contra qué hacer matching.

Este cambio hace tres cosas que solo se hacen una vez:

1. **Convierte `catalogo` en un vertical completo** siguiendo `identidad` como implementación de referencia.
2. **Estrena `contracts/` como borde cross-dominio real** — `CatalogQueryPort` es la primera interfaz *propiedad de un dominio* (no declarada por el kernel) que otro dominio va a importar. Hoy no la consume nadie: es el momento más barato de su vida para fijar su forma.
3. **Es el primer dominio construido bajo `strict_tdd: true`** (ver D11). `identidad` se construyó en Standard Mode por la paradoja de bootstrap que D7 del cambio anterior documentó explícitamente; esa excepción ya no aplica.

Éxito = los 5 casos de uso responden por HTTP con guards reales, ningún proveedor puede tocar el catálogo de otra empresa, y `pnpm test` corre verde con los escenarios negativos de autorización escritos **antes** que el código.

## Decisiones ya tomadas (no re-abrir)

| # | Decisión | Consecuencia directa |
|---|---|---|
| **D1** | **`CatalogQueryPort` se mueve `ports-out/` → `contracts/`** (cierra WARNING-3). La **interfaz + el token** viven en `contracts/`; la **clase concreta** que la implementa se queda en `adapters/persistence/`. `CatalogRepository`/`CATALOG_REPOSITORY` **no se mueve** — es persistencia interna, nunca cross-dominio. | Primer contrato cross-dominio *domain-owned* del repo. `ofertas`/`refill-matching` solo necesitan `@Inject(CATALOG_QUERY_PORT)` + el tipo de la interfaz; jamás importan la clase. Es una regla nueva de `core-api-hexagonal-layout`, no una excepción puntual. |
| **D2** | **`cargarCatalogoMasivo`: procesamiento fila por fila, SIN transacción envolvente.** `ResultadoCargaMasiva` reporta éxito/fallo **por fila**. | Una fila mal formada no aborta las otras 299. La existencia misma de `ResultadoCargaMasiva` (en vez de `void`) prueba que el spec de producto ya anticipaba el éxito parcial como resultado de primera clase. No hay invariante cross-fila que proteger (a diferencia del par mutación+auditoría de `identidad`). **Ver Q5: el reintento idempotente NO está garantizado hoy.** |
| **D3** | **`cargarCatalogoMasivo` emite SOLO `CatalogoCargaMasivaCompletada`** (`{ companyId, totalCargados, totalFallidos }`), **no** un `ProductoAgregado` por fila. | `EventEmitterPublisher.publish` usa `emitAsync` (espera a cada listener): N eventos = N fan-outs serializados dentro del mismo request HTTP. Ningún consumidor actual necesita granularidad por fila — `refill-matching`/`ofertas` usan `CatalogQueryPort` como *pull* síncrono, no *push*. `ProductoAgregado` queda acotado al caso de uso unitario `cargarProductoCatalogo`. |
| **D4** | **`ajustarPreciosPorCategoria`: el cálculo vive en el caso de uso; el puerto de escritura nace con forma de lote.** Semántica del enfoque A de la exploración (fetch → calcular en la capa de aplicación → escribir), pero con `saveMany(items, tx?)` en `ports-out` desde el día 1, cuyo **primer adaptador puede ser un loop**. | Rechaza el enfoque B (`UPDATE` con la matemática en SQL): `docs/ARCHITECTURE.md` y el `design.md` de la fundación ya rechazaron lógica de negocio en la DB, y bajo strict TDD la matemática debe ser testeable con ports-out mockeados y cero DB. Rechaza pagar hoy la complejidad de C (escritura batcheada): con un puerto ya *shaped* como lote, migrar loop → `UPDATE ... FROM (VALUES ...)` es un cambio confinado a `adapters/persistence/`, sin tocar el caso de uso ni sus tests. Se compra la testabilidad de A y la puerta de salida de C sin pagar C. |
| **D5** | **`porcentaje` escala `precio_base` Y `precio_maximo` proporcionalmente.** Regla adicional: `porcentaje <= -100` se rechaza como error de validación. | `precio_maximo` es el techo negociable del proveedor: escalar solo el piso estrecha en silencio su banda y termina chocando contra `CHECK (precio_maximo >= precio_base)`. Escalar ambos por el mismo factor positivo **preserva la desigualdad por construcción** — el `CHECK` deja de ser un descubrimiento en runtime. El redondeo a `numeric(12,2)` es monótono, así que tampoco puede invertir el orden. La invariante se valida en el dominio **antes** de tocar la DB, no se delega al constraint. |
| **D6** | **`ajustarPreciosPorCategoria` emite un evento resumen nuevo: `PreciosCategoriaAjustados`** (`{ companyId, categoria, porcentaje, totalActualizados }`). `PrecioActualizado` queda acotado a `actualizarPrecio` unitario. **Es un delta declarado sobre `catalogo/SPEC.md`** — su lista "Eventos que publica" no lo tiene. | Mismo riesgo de fan-out que D3, y la simetría la marca el propio spec de producto: para la carga masiva ya definió un evento resumen. Además, para el caché desnormalizado que `refill-matching` describe en su propia sección de extracción, `(companyId, categoria)` **invalida con más precisión** que N eventos por fila. |
| **D7** | **`actualizarPrecio` cambia de firma: `actualizarPrecio(companyId, itemId, precioBase, precioMaximo): Promise<void>`.** Se agrega `findById(itemId, tx?)` a `CatalogRepository`. Lógica: `findById` → si es `null` **o** `item.companyId !== companyId` → `CatalogItemNotFoundError` → **HTTP 404**; si no, `item.actualizarPrecio(precioBase, precioMaximo)` (valida la invariante en la entidad) → `repository.save(item)`. **Delta declarado sobre `catalogo/SPEC.md`**, que no tiene parámetro de empresa alguno. | La firma cruda es una vulnerabilidad de mutación cross-tenant: sin dueño, cualquier proveedor cambia precios de cualquier otro enumerando `itemId`. **404 y no 403 a propósito**: un 403 confirmaría que el ítem existe y es de otra empresa — filtra existencia cross-tenant. El 404 es indistinguible de "no existe". Mismo tratamiento explícito que la fundación le dio a los 4 arreglos de firma de `identidad` (`asignarRolAdmin` + `adminId`, etc.). |
| **D8** | **Los 4 casos de uso mutantes reciben `companyId` forzado por el controlador a `actor.companyId`.** Aplica a `cargarProductoCatalogo`, `cargarCatalogoMasivo`, `ajustarPreciosPorCategoria` y `actualizarPrecio` (D7). Ningún DTO acepta un `companyId` del cliente. | Es **una sola regla aplicada 4 veces**, no 4 decisiones. Es el patrón ya establecido en `core-api-auth-guard` ("el controlador pasa escalares derivados del actor, nunca el objeto actor ni campos de identidad del cliente"). Con RLS bypasseada en la conexión service-role, un `companyId` cliente-provisto no es un bug cosmético: es una fuga cross-tenant sin backstop en DB (R1 de la fundación). |
| **D9** | **Consumo de `EmpresaSuspendida`/`EmpresaAprobada`: lado escritura NO, lado lectura SÍ, por desnormalización event-driven.** El gate self-service de escritura se resuelve con `actor.companyStatus === 'activo'` (el `AuthGuard` lo resuelve fresco por request, sin caché) — cero eventos. El lado lectura (`buscarProductos` / `CatalogQueryPort.buscarCoincidencias` deben excluir el catálogo de una empresa suspendida) se resuelve con un listener `@OnEvent` en **`adapters/events/`** — primer uso real de esa carpeta en el repo, lo que **cierra WARNING-2 en la práctica**. | Consistente con la dirección que el propio `catalogo/SPEC.md` prescribe para la extracción a microservicio (proyección desnormalizada, no join cross-dominio). Evita que `CatalogRepository` acople sus queries a la tabla `companies` de `identidad`. **Default nombrado**: proyección como *deny-list* (solo empresas suspendidas), de modo que tabla vacía = nadie suspendido y **no hace falta backfill**. La forma exacta del esquema (columna vs. tabla, y qué migración la posee) se **difiere a `sdd-design`** — ver Q1. |
| **D10** | **Sin `AuditLogPort` en este dominio.** Decisión explícita, no ausencia silenciosa. | Los 5 casos de uso son acciones self-service de un proveedor sobre su propio inventario — más cerca de `registrarEmpresa`/`registrarUsuario` (sin auditoría) que de `aprobarEmpresa`/`suspenderEmpresa` (auditados). Fuera del alcance de `shared-audit-log`, que acota la auditoría a mutaciones administrativas. Si producto quiere trazabilidad de disputas de precio, es un cambio propio, no un agregado tácito acá. |
| **D11** | **`ArchivoCarga`: el parseo (CSV/XLSX) vive en `adapters/http/`.** El caso de uso `ports-in` recibe una estructura ya parseada y plana; **nunca** un `Express.Multer.File` ni ningún tipo de framework HTTP. | Regla ya finalizada en `core-api-hexagonal-layout`: "DTOs y decoradores de framework se quedan en `adapters/http`". Se fija acá para que `sdd-design` no lo re-litigue. |
| **D12** | **Los 3 tipos faltantes se promueven a código real en `@repon/types`**: `ArchivoCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` → `packages/types/src/catalogo.ts`. In-scope. | Hoy existen solo como nombres sin resolver en la prosa de `catalogo/SPEC.md`. Precedente D3 de la fundación: `shared-types-package` ya hizo exactamente esta promoción para los otros 7 archivos. Cero re-declaración de tipos en la capa de dominio. |
| **D13** | **Los row types de Kysely son groundwork del slice 0**: `CatalogProductsTable` y `ProviderCatalogTable` en `services/core-api/src/shared/database/schema.ts`, extendiendo `DB`. | No existen: `schema.ts` hoy solo tipa `companies`, `profiles`, `admin_roles`, `audit_log`, y su propio header dice que cada tabla "se tipa cuando aterriza el cambio de su dominio dueño". **Bloquea todo trabajo de adaptador de persistencia**, independientemente de qué enfoque gane en cualquier otra decisión. |
| **D14** | **`strict_tdd: true` está ACTIVO y sin excepciones en este cambio.** Primer dominio del repo construido así. | La excepción de D7 de la fundación era la paradoja de bootstrap (*"la primera tarea es crear el test runner"*); esa precondición ya no existe: `pnpm test` corre verde con 111 unit + 17 e2e y la CI gatea. Los escenarios negativos de autorización de D7/D8 son **tests obligatorios escritos primero**, no cobertura opcional. |
| **D15** | **Q5 resuelta (decisión de producto): índice único parcial nuevo en `provider_catalog`.** Migración nueva, fix-forward (nunca editando una aplicada, convención `20260804090500_10_grants_domain_tables_service_role.sql`). **Las columnas exactas del índice quedan para `sdd-design`**: el candidato natural es `(company_id, catalog_product_id) WHERE catalog_product_id IS NOT NULL` para ítems ligados al catálogo de referencia; falta definir el target de conflicto para ítems sin `catalog_product_id` (producto propio del proveedor, no listado) — probablemente `(company_id, nombre, categoria)`. | Cierra R5: hoy `provider_catalog` no tiene ninguna UNIQUE fuera de la PK, así que un "upsert" no tiene target de conflicto y re-subir el mismo archivo duplica filas. Con el índice, `cargarCatalogoMasivo` (D2) puede hacer un upsert real por fila; sin él, la carga masiva no es segura de reintentar. |
| **D16** | **Q3 resuelta (decisión de producto): se crea el evento `EmpresaReactivada`.** Verificado en código: `identidad` hoy solo tiene `aprobarEmpresa` (`pendiente → activo`) y `suspenderEmpresa` (`activo → suspendido`) — **no existe ningún caso de uso que transicione `suspendido → activo`**. Este cambio agrega `reactivarEmpresa(companyId, adminId, motivo): Promise<void>` a `identidad` (espejo exacto de `suspenderEmpresa`: admin-mutante, auditado en la misma transacción vía `AuditLogPort`, publica `EmpresaReactivada`). Es el **5º caso de uso admin-mutante auditado** de identidad. | `core-api-identidad` (ya archivado) pasa a ser **Modified Capability** de este cambio — mismo tratamiento que la fundación le dio a `auth-provisioning` mientras construía `identidad` por primera vez. Sin esto, una empresa suspendida no tenía ningún camino de vuelta a visible, lo que dejaba el modelo deny-list de D9 incompleto: el listener de visibilidad de `catalogo` consume `EmpresaReactivada` para remover la empresa de su proyección. **Riesgo de regresión**: ver R9 — la suite completa de `identidad` (111 unit + 17 e2e) debe seguir verde. |

## Scope

### In Scope

1. **Groundwork** — row types de Kysely (D13), los 3 tipos de `@repon/types` (D12), creación de `contracts/` y movimiento de `CatalogQueryPort` (D1).
2. **`catalogo` vertical completo** — `domain/` (entidades + invariante de precios), `ports-in/` (los 5 casos de uso implementados), `ports-out/` (`CatalogRepository` extendido con `findById` y `saveMany`), `contracts/`, `adapters/http|persistence|events`, providers reales en `catalogo.module.ts`.
3. **Cierre de autorización** — D7 + D8 aplicados a los 4 casos de uso mutantes, con escenarios negativos Given/When/Then en `sdd-spec`.
4. **Implementación de `CatalogQueryPort`** — adaptador Kysely en `adapters/persistence/`, con el filtro de visibilidad de D9 aplicado.
5. **Listener de eventos** — `adapters/events/` consumiendo `EmpresaSuspendida`/`EmpresaAprobada` (D9), con la proyección que `sdd-design` defina (Q1).
6. **Deltas de SPEC.md declarados** — `services/core-api/domains/catalogo/SPEC.md` (firma de `actualizarPrecio`, evento nuevo `PreciosCategoriaAjustados`), `services/core-api/domains/identidad/SPEC.md` (nuevo caso de uso `reactivarEmpresa` + evento `EmpresaReactivada`, D16) y `packages/types/SPEC.md`.
7. **Extensión de `identidad`** — caso de uso `reactivarEmpresa` (D16), con su test unitario espejando `suspenderEmpresa` y su ruta HTTP/controller/DTO correspondiente; no se toca ningún caso de uso existente.
8. **Índice único parcial en `provider_catalog`** (D15) vía migración nueva, con las columnas exactas fijadas en `sdd-design`.
9. **Tests** — unitarios con ports-out mockeados para los 5 casos de uso, negativos de autorización, matemática de ajuste de precios, reporte de fallo parcial de la carga masiva, `reactivarEmpresa`, y regresión completa de la suite existente de `identidad`.

### Out of Scope

- **Los 4 dominios restantes** (`consumo`, `refill-matching`, `ofertas`, `pedidos-pagos`) — siguen como placeholders de D2 de la fundación. En particular, **no se implementa ningún consumidor de `CatalogQueryPort`**.
- **Seed / ETL de `catalog_products`** (el catálogo de referencia). Este cambio escribe `provider_catalog`; poblar el catálogo general es un cambio de datos, no de API.
- **Optimización de escritura batcheada** (`UPDATE ... FROM (VALUES ...)`) — el puerto nace con forma de lote (D4), pero el primer adaptador puede ser un loop. Optimizar sin una medición es adivinar.
- **Reconciliación de la proyección de visibilidad** ante un evento perdido — ver R4; es follow-up nombrado, no parte de este cambio.
- **`AuditLogPort` en `catalogo`** (D10). **Búsqueda avanzada** (facetas, ranking, paginación por cursor) más allá del trigram GIN que ya existe. **Realtime/WebSocket** sobre cambios de catálogo.
- **Cambiar `catalogo/SPEC.md` en silencio** — todo delta va declarado (regla `rules.specs` de `openspec/config.yaml`).

## Capabilities

### New Capabilities

- `core-api-catalogo`: los 5 casos de uso, su superficie HTTP, reglas de autorización (D7/D8), invariante de precios (D5), semántica de fallo parcial de la carga masiva (D2), eventos publicados y consumidos, y el contrato cross-dominio `CatalogQueryPort` (D1).

### Modified Capabilities

- `core-api-hexagonal-layout`: agregar la regla de que una interfaz cross-dominio *propiedad del dominio* declara **interfaz + token en `contracts/`** mientras su clase concreta se queda en `adapters/persistence/` (D1), y que **`adapters/events/` es obligatoria cuando un dominio consume eventos** y opcional cuando solo publica (D9, cierra WARNING-2).
- `shared-types-package`: agregar `ArchivoCarga`, `ResultadoCargaMasiva` y `NuevoProductoProveedor` como formas canónicas, con sus reglas de validación en la capa de tipo/DTO (D12).
- `db-schema-catalogo`: cambia con certeza — D15 ya confirma una migración nueva (índice único parcial en `provider_catalog`); si D9/Q1 elige tabla-proyección en vez de columna desnormalizada, es una segunda migración. `sdd-design` fija ambas.
- `core-api-identidad`: agrega el caso de uso `reactivarEmpresa` (espejo de `suspenderEmpresa`: admin-mutante, auditado en la misma transacción) y el evento `EmpresaReactivada` (D16, cierra Q3). Es el 5º caso de uso admin-mutante auditado de identidad. **No modifica ningún caso de uso existente** — puramente aditivo.

## Approach

Bottom-up, 6 slices, cada uno revisable de forma independiente y terminando con `pnpm test` verde. Bajo D14, **cada slice arranca por los tests**.

```
0. groundwork   schema.ts (row types), @repon/types (3 tipos),
                contracts/ + movimiento de CatalogQueryPort
1. lectura      domain/ + invariante de precios, KyselyCatalogRepository,
                buscarProductos, implementacion de CatalogQueryPort
2. escritura    cargarProductoCatalogo, actualizarPrecio (+ findById, 404 cross-tenant),
                controller + DTOs + mapper, ProductoAgregado / PrecioActualizado
3. lotes        cargarCatalogoMasivo (parser en adapters/http + fila-a-fila),
                ajustarPreciosPorCategoria (+ saveMany), eventos resumen
4. visibilidad  adapters/events/ listener + proyeccion + filtro en el path de lectura,
                identidad.reactivarEmpresa + EmpresaReactivada (D16)
5. cierre       cableado del modulo, deltas declarados de SPEC.md, docs
```

El slice 0 aterriza **antes** de cualquier lógica: `contracts/` y los row types son costuras, y una costura mal puesta con 5 casos de uso encima ya no es gratis. El slice 1 fija la forma de `CatalogQueryPort` mientras el número de consumidores sigue siendo **cero** (R2).

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `services/core-api/src/domains/catalogo/domain/` | New | Entidades + invariante `precio_maximo >= precio_base` (D5) |
| `services/core-api/src/domains/catalogo/ports-in/` | New | 5 casos de uso |
| `services/core-api/src/domains/catalogo/ports-out/catalog-repository.port.ts` | Modified | Agregar `findById(itemId, tx?)` (D7) y `saveMany(items, tx?)` (D4) |
| `services/core-api/src/domains/catalogo/ports-out/catalog-query.port.ts` | Removed | Movido a `contracts/` (D1) |
| `services/core-api/src/domains/catalogo/contracts/` | New | `CatalogQueryPort` + `CATALOG_QUERY_PORT` (D1) |
| `services/core-api/src/domains/catalogo/adapters/http/` | New | Controller, DTOs, mapper, parser de `ArchivoCarga` (D11) |
| `services/core-api/src/domains/catalogo/adapters/persistence/` | New | `KyselyCatalogRepository` + implementación de `CatalogQueryPort` |
| `services/core-api/src/domains/catalogo/adapters/events/` | New | Listener `@OnEvent` de `EmpresaSuspendida`/`EmpresaAprobada` (D9) — primera vez en el repo |
| `services/core-api/src/domains/catalogo/catalogo.module.ts` | Modified | De `@Module({})` vacío a providers reales + `exports` de `CATALOG_QUERY_PORT` |
| `services/core-api/src/shared/database/schema.ts` | Modified | `CatalogProductsTable`, `ProviderCatalogTable`, extender `DB` (D13) |
| `packages/types/src/catalogo.ts` | Modified | `ArchivoCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` (D12) |
| `services/core-api/domains/catalogo/SPEC.md` | Modified | Delta declarado: firma de `actualizarPrecio` (D7), evento `PreciosCategoriaAjustados` (D6) |
| `packages/types/SPEC.md` | Modified | Documenta los 3 tipos promovidos |
| `supabase/migrations/` | New (confirmado) | Índice único parcial en `provider_catalog` (D15); segunda migración condicional si D9/Q1 elige tabla-proyección |
| `services/core-api/src/domains/identidad/ports-in/reactivar-empresa.use-case.ts` | New | D16, espejo de `suspender-empresa.use-case.ts` |
| `services/core-api/src/domains/identidad/identidad.module.ts` | Modified | Cablear el nuevo caso de uso |
| `services/core-api/src/domains/identidad/adapters/http/` | Modified | Nueva ruta/controller/DTO para `reactivarEmpresa` |
| `services/core-api/domains/identidad/SPEC.md` | Modified | Delta declarado: nuevo caso de uso + evento `EmpresaReactivada` (D16) |
| `services/core-api/src/app.module.ts` | None | Ya importa `CatalogoModule` |

## Risks

| Riesgo | Prob. / Impacto | Mitigación |
|---|---|---|
| **R1 — Mutación cross-tenant.** RLS está bypasseada en la conexión service-role: un `companyId` cliente-provisto, o `actualizarPrecio` sin dueño, permite a cualquier proveedor mutar el catálogo de otro sin backstop en DB | Media / **Crítico** | D7 + D8 lo cierran estructuralmente. Bajo D14 los escenarios negativos (proveedor de empresa A → ítem de empresa B → **404**) son tests obligatorios **escritos primero**, en `sdd-spec` como Given/When/Then explícitos |
| **R2 — El contrato de `CatalogQueryPort` se congela apenas aterricen `refill-matching`/`ofertas`.** Hoy no lo consume nadie; con 2 dominios implementados encima, cualquier cambio de firma es un breaking change multi-dominio coordinado | Alta (a futuro) / Alto | Se fija en el slice 1, con **cero** consumidores. `sdd-design` debe cerrar también su semántica de falla (qué pasa si la DB de `catalogo` está lenta/caída durante una llamada síncrona in-process) — ver Q2 |
| **R3 — Fan-out de eventos con `emitAsync`.** N eventos = N fan-outs de listeners serializados dentro del mismo request HTTP; una carga de 300 filas o un ajuste de categoría pueden degradar la respuesta o dejar que un listener lento afecte el orden de completitud | Media / Medio-Alto | D3 y D6: un evento resumen por operación de lote; los eventos por ítem quedan acotados a los casos de uso unitarios |
| **R4 — La proyección de visibilidad (D9) es fail-open ante evento perdido.** Si el listener falla, el catálogo de una empresa suspendida sigue apareciendo en búsqueda y matching | Media / Medio | El modelo deny-list acota el daño (no hay problema de bootstrap ni backfill). No es fuga de datos: `provider_catalog` con `disponible = true` ya es vista pública de marketplace. Reconciliación = follow-up nombrado, fuera de scope |
| **R5 — La carga masiva NO es idempotente hoy.** `provider_catalog` no tiene ninguna constraint UNIQUE fuera de la PK (verificado en `20260803120300_03_catalogo.sql`): un "upsert" no tiene target de conflicto, así que re-subir el mismo archivo **duplica filas** | **Alta** / Alto | Q5 lo resuelve **antes** del slice 3: o un índice único parcial en una migración nueva, o definir la carga masiva como insert-only con detección explícita de duplicados en el caso de uso. La suposición de idempotencia de la exploración no se hereda sin verificar |
| **R6 — Primer dominio bajo strict TDD, sin precedente para una operación de lote.** No existe secuencia de PRs de referencia que muestre cómo hacer red-green-refactor sobre "cientos de filas" | Media / Medio | `sdd-tasks` define incrementos testeables (fila única happy path → reporte de fallo parcial → matemática de ajuste por categoría), no un PR grande |
| **R7 — Presupuesto de review.** 5 casos de uso + carga masiva + listener de eventos + movimiento de contrato supera holgadamente 400 líneas — misma forma que R6 de la fundación | Alta / Medio | Expectativa declarada acá; la decisión real de PRs encadenados la toma **`sdd-tasks`** (`delivery_strategy: ask-on-risk`), no este documento. Los 6 slices ya están dibujados como unidades de trabajo autónomas |
| **R8 — Row types de Kysely faltantes bloquean todo adaptador** | Alta / Bajo | D13: slice 0, la tarea más temprana posible |
| **R9 — Regresión sobre `identidad`, un dominio ya archivado y con 111 unit + 17 e2e en verde.** D16 agrega `reactivarEmpresa`, tocando un dominio que no era parte del scope original de este cambio | Baja / Alto (si se rompe, rompe algo ya en producción) | D16 es puramente aditivo — ningún caso de uso existente cambia de firma ni de comportamiento. `reactivarEmpresa` se testea espejando exactamente la estructura de tests de `suspenderEmpresa` (unit + e2e). La suite completa de `identidad` corre en CI antes de cerrar este cambio, no solo los tests nuevos |

## Rollback Plan

Greenfield: sin deploy, sin datos productivos, sin consumidores (`refill-matching` y `ofertas` son placeholders vacíos — verificado). El rollback operacional es `git revert` de la cadena de PRs y `catalogo` vuelve a ser un `@Module({})` vacío; `app.module.ts` ya lo importa y arranca igual. **Excepción**: si Q1/Q5 producen una migración, esa migración se revierte con una migración fix-forward, nunca editando la aplicada (convención ya establecida en `20260804090500_10_grants_domain_tables_service_role.sql`).

La pregunta real es qué queda barato y qué queda caro una vez que los dominios 3-6 se construyan encima:

| Barato de cambiar después | Caro de cambiar después |
|---|---|
| **Estrategia de escritura de `ajustarPreciosPorCategoria` (D4)**: el puerto ya es de lote; loop → batch es un cambio confinado al adaptador | **Firma de `CatalogQueryPort` (D1)**: con `refill-matching` y `ofertas` implementados encima, cambiarla es un breaking change multi-dominio coordinado |
| **Forma de la proyección de visibilidad (D9)**: la escribe y la lee solo `catalogo`, nadie más la ve | **Modelo de autorización (D7/D8)**: cada caso de uso se escribe asumiendo una forma del actor; cambiarla toca todos los controladores y todas las firmas |
| **Payload de los eventos resumen (D3/D6)**: hoy no los consume nadie | **Granularidad de eventos por-fila vs. resumen**: si `refill-matching` construye su caché desnormalizado asumiendo `PrecioActualizado` por ítem, volver atrás a resumen le rompe el caché |
| **Parser de `ArchivoCarga` (CSV → XLSX → streaming)**: aislado en `adapters/http` por D11 | **`contracts/` como único borde importable**: si un dominio importa `ports-out/` de otro y no se detecta, el acoplamiento se propaga y re-dibujar el borde es exactamente lo que hace fracasar la historia de extracción a microservicios |
| Umbral de tamaño/filas de la carga masiva: validación en el DTO | **Semántica de 404-en-vez-de-403 (D7)**: cambiarla después es un cambio de contrato de API observable por los clientes |

## Dependencies

- `backend-core-api-foundation` (archivado): shared kernel, `AuthGuard`/`RolesGuard`, `EventBusModule`, `TransactionManager`, `@repon/types` y el runner de Jest. **Todo presente.**
- Migraciones de `backend-supabase-migrations` (archivado) aplicadas: `catalog_products`, `provider_catalog` y los grants de `service_role` (`select, insert, update`, sin `delete`). **Todo presente.**
- **Q1 resuelto en `sdd-design` antes del slice 4** — puede implicar una migración nueva, y una migración descubierta a mitad de slice es una interrupción, no un detalle. **D15/D16 (Q5/Q3) ya resueltos** a nivel de decisión de producto; `sdd-design` fija el detalle exacto de columnas del índice (D15) y confirma el wiring de `reactivarEmpresa` (D16).
- Ninguna dependencia externa nueva salvo, potencialmente, un parser de CSV/XLSX en `adapters/http` (D11) — a elegir en `sdd-design`.

## Preguntas abiertas (para `sdd-spec` / `sdd-design`)

| # | Pregunta | Dueño | Estado |
|---|---|---|---|
| Q1 | **Forma del esquema de la proyección de visibilidad (D9)**: ¿columna desnormalizada en `provider_catalog` (escritura O(N) por suspensión) o tabla-proyección deny-list propiedad de `catalogo`, keyed por `company_id` (escritura O(1), sin backfill)? Default nombrado: **tabla deny-list**. Incluye decidir qué migración la posee, y cómo `EmpresaReactivada` (D16) la limpia | `sdd-design` | Abierta |
| Q2 | **Semántica de falla de `CatalogQueryPort`**: ¿qué devuelve/lanza ante DB lenta o caída durante una llamada síncrona in-process desde `refill-matching`? Hay que fijarlo mientras haya **cero** consumidores (R2) | `sdd-design` | Abierta |
| Q4 | **Forma concreta de `ArchivoCarga`** y límites duros por upload (máximo de filas, tamaño de archivo, formatos aceptados). Bajo D11 la validación vive en el DTO de `adapters/http`, no en el caso de uso | `sdd-spec` | Abierta |
| Q5b | **Columnas exactas del índice único parcial de D15**: `(company_id, catalog_product_id) WHERE catalog_product_id IS NOT NULL` para ítems ligados al catálogo de referencia — falta fijar el target de conflicto para ítems sin `catalog_product_id` (candidato: `(company_id, nombre, categoria)`) | `sdd-design` | Resuelto el enfoque (D15); falta el detalle |

~~Q3~~ (¿existe `EmpresaReactivada`?) y ~~Q5~~ (enfoque de idempotencia) fueron resueltas por decisión de producto — ver **D16** y **D15**.

## Success Criteria

- [ ] Los 5 casos de uso responden por HTTP con validación de DTO y cada uno tiene test unitario con ports-out mockeados
- [ ] `CatalogQueryPort` + `CATALOG_QUERY_PORT` viven en `domains/catalogo/contracts/`, la clase concreta en `adapters/persistence/`, y la regla de lint del borde cross-dominio pasa verde (D1)
- [ ] **Un proveedor de la empresa A recibe 404 —no 403— al intentar `actualizarPrecio` sobre un ítem de la empresa B**, con test negativo escrito antes que la implementación (D7 + D14)
- [ ] Ningún DTO de `catalogo` acepta `companyId` del cliente; los 4 casos de uso mutantes lo reciben derivado de `actor.companyId` (D8)
- [ ] `ajustarPreciosPorCategoria` escala `precio_base` y `precio_maximo` proporcionalmente, rechaza `porcentaje <= -100`, y **ningún test provoca una violación del `CHECK (precio_maximo >= precio_base)`** — la invariante se valida en el dominio (D5)
- [ ] `cargarCatalogoMasivo` con un archivo de N filas donde M fallan devuelve un `ResultadoCargaMasiva` con N-M éxitos y M fallos identificables, y emite **exactamente un** evento (D2 + D3)
- [ ] `ajustarPreciosPorCategoria` emite **exactamente un** `PreciosCategoriaAjustados`, sin importar cuántas filas toque (D6)
- [ ] Tras un `EmpresaSuspendida`, `buscarProductos` y `CatalogQueryPort.buscarCoincidencias` dejan de devolver ítems de esa empresa, sin que ninguna query de `catalogo` lea la tabla `companies` (D9)
- [ ] `ArchivoCarga` llega al caso de uso ya parseado; ningún archivo de `ports-in/` o `domain/` importa un tipo de framework HTTP (D11)
- [ ] `ArchivoCarga`, `ResultadoCargaMasiva` y `NuevoProductoProveedor` se importan desde `@repon/types`; cero re-declaración en `core-api` (D12)
- [ ] `schema.ts` tipa `catalog_products` y `provider_catalog`, y `DB` las incluye (D13)
- [ ] Los deltas sobre `catalogo/SPEC.md` (firma de `actualizarPrecio`, evento `PreciosCategoriaAjustados`) y sobre `identidad/SPEC.md` (`reactivarEmpresa`, `EmpresaReactivada`) están escritos en sus SPEC.md, no solo en este cambio
- [ ] Reintentar la carga masiva con el mismo archivo no duplica filas en `provider_catalog` (índice único parcial, D15)
- [ ] Un admin puede reactivar una empresa suspendida (`reactivarEmpresa`), `identidad` publica `EmpresaReactivada`, y el listener de visibilidad de `catalogo` la remueve de su proyección deny-list (D16 + D9)
- [ ] La suite completa de `identidad` (111 unit + 17 e2e previos) sigue en verde tras agregar `reactivarEmpresa` — sin regresión (R9)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verde en CI; ningún DELETE físico introducido
