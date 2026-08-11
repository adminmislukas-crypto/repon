# Proposal: `consumo` — tercer vertical de dominio, primer job programado y primer binding real del kernel de notificaciones

## Intent

`services/core-api/src/domains/consumo/` son hoy **3 archivos**: dos interfaces `ports-out` y un `@Module({})` vacío. La DB (`pets`, `user_consumption`, `consumption_logs`) está migrada, con RLS y con el índice `(consumption_id, tomado_at DESC)` construido explícitamente para el cron diario — pero **nadie le escribe**. Sin `consumo`, un usuario no puede registrar una mascota ni una dosis, y `refill-matching` no tiene **ningún** disparador para su promesa central: crear la solicitud de reposición sin intervención del usuario.

Este cambio hace tres cosas que solo se hacen una vez:

1. **Convierte `consumo` en un vertical completo**, siguiendo `identidad`/`catalogo` como implementaciones de referencia.
2. **Estrena el tercer tipo de adaptador conductor del repo**: un job programado (`adapters/scheduling/`). Hoy solo existen HTTP y listeners de eventos; el cron diario no encaja en ninguno (D1).
3. **Estrena el binding real de `NotificationPort`** — el token existe desde la fundación sin proveedor, y `SharedKernelModule` lo dice literalmente en su doc comment ("intentionally not wired here"). Es infraestructura compartida que `consumo`, `ofertas` y `pedidos-pagos` van a consumir, así que el binding vive en el kernel, no dentro de `ConsumoModule` (D9).

Éxito = los 4 casos de uso públicos responden por HTTP con guards reales, ningún usuario puede tocar el consumo de otro, el cron diario detecta stock bajo **una sola vez por condición** (no todos los días, D5), emite **un evento por ítem afectado** (D3), y `pnpm test` corre verde con los escenarios negativos de autorización escritos **antes** que el código.

## Decisiones ya tomadas (no re-abrir)

| # | Decisión | Consecuencia directa |
|---|---|---|
| **D1** | **El cron vive en `core-api` con `@nestjs/schedule`, en una carpeta nueva `adapters/scheduling/`.** Una clase con `@Cron()`, **un solo método**, que solo llama a un caso de uso de `ports-in` y no contiene lógica alguna — exactamente la misma forma "adaptador conductor delgado" que ya tienen `adapters/http/*.controller.ts` y `adapters/events/*.listener.ts`. **Dependencia nueva declarada: `@nestjs/schedule`** (mismo tratamiento que `catalogo` le dio a su parser de CSV). | **Delta declarado sobre `core-api-hexagonal-layout`**, cuya regla "Fixed per-domain folder shape" enumera hoy `adapters/http\|persistence\|events` sin ninguna entrada de scheduling. Se rechazan las alternativas evaluadas en exploración: un endpoint HTTP protegido exige una superficie de autenticación máquina-a-máquina nueva y parte el modo de falla en dos sistemas; `pg_cron` con callback HTTP reintroduce "lógica de negocio parcialmente en Postgres", que `docs/ARCHITECTURE.md` y el `design.md` de la fundación ya rechazaron. A la hora de extraer el microservicio, se cambia el adaptador, no el caso de uso. |
| **D2** | **`calcularDiasRestantes(consumptionId)` es una query pura y se queda así** (alcanzable por HTTP, apta para una futura pantalla "días restantes"). Un caso de uso **nuevo, interno, nunca expuesto por HTTP y sin `@Roles`** — `procesarConsumosVencidos` — es el dueño del chequeo de umbral, la emisión de eventos y el push. Es lo que el cron de D1 realmente invoca. Misma forma que `OcultarCatalogoEmpresaUseCase` de `catalogo`. | **Delta declarado sobre la prosa literal de `consumo/SPEC.md`**, que conflaciona ambas responsabilidades en un solo método (`calcularDiasRestantes` … `// usado también por el cron`) — mismo tratamiento que `catalogo/design.md` le dio al criterio de éxito sobre-amplio de `buscarProductos`. Sin esta separación, cualquier `GET` futuro de "días restantes" dispararía en silencio una push y un refill automático: un peligro estructuralmente invisible que el sistema de tipos no puede frenar. |
| **D3** | **Fan-out por ítem, no resumen diario.** `StockBajoDetectado` y `RefillAutoSolicitado` se emiten **una vez por cada `UserConsumption` que cruza el umbral**, nunca un evento resumen del día. | **Es la conclusión opuesta a D3/D6 de `catalogo`, y a propósito.** Los eventos resumen de `catalogo` sirven a consumidores que solo preguntan "¿terminó el lote?". Acá `refill-matching` debe crear **un `RefillRequest` por producto/mascota que efectivamente se quedó sin stock**: un conteo no le sirve, necesita la identidad concreta de cada consumo afectado. Se documenta explícitamente para que un lector futuro no lo lea como una contradicción del patrón "siempre resumir". El costo de fan-out de `emitAsync` que motivó D3 de `catalogo` no aplica igual: el cron corre fuera de un request HTTP, y D5 acota el volumen a las transiciones, no al total de filas bajas. |
| **D4** | **Sin transacción envolvente alrededor del loop del cron.** Se captura y se loguea el error **por ítem** y se continúa con el resto. | Mismo razonamiento que `cargarCatalogoMasivo` (D2 de `catalogo`): la falla de un `UserConsumption` no puede bloquear el chequeo diario de todos los demás. No hay invariante cross-ítem que proteger — cada fila es independiente. El logueo por ítem sigue el patrón ya establecido por `CompanyVisibilityListener`. |
| **D5** | **La idempotencia entre días la resuelve `consumo`, en su propio esquema.** Se agrega a `user_consumption` un marcador de estado de notificación ("última notificación" / "refill automático abierto"). Mientras el marcador esté activo, el cron **no vuelve a emitir** `StockBajoDetectado`/`RefillAutoSolicitado` para ese `UserConsumption`; el marcador se limpia cuando la condición desaparece (stock repuesto por encima del umbral) o se resetea explícitamente. **La forma exacta de la columna se difiere a `sdd-design` (Q1); el enfoque — el debounce lo posee `consumo`, vía esquema — está cerrado.** | **Decisión de producto ya tomada.** Sin esto, la lectura literal de `consumo/SPEC.md` produce una push diaria indefinida y **un `RefillRequest` nuevo por día** para el mismo ítem sin resolver. Se rechazan explícitamente las dos alternativas: debounce en `refill-matching` empuja una clave de dedup específica de `consumo` a un dominio ajeno y no arregla la push repetida; "aceptarlo como recordatorio diario" es una decisión de producto que no se toma por default de implementación. Es un **delta sobre `db-schema-consumo`** — migración nueva, fix-forward. |
| **D6** | **`marcarDosisTomada` SÍ envuelve una transacción.** `ConsumptionLogRepository.append` + `ConsumptionRepository.save` (decremento de stock) corren dentro de `TRANSACTION_MANAGER.runInTransaction`; `DosisRegistrada` se publica **después** del commit. | Mismo razonamiento que `ajustarPreciosPorCategoria` de `catalogo`: dos escrituras acopladas y una firma `Promise<void>` **sin ningún canal para reportar éxito parcial**. Un log escrito con el stock sin decrementar (o al revés) corrompe silenciosamente el cálculo de días restantes del que depende todo el cron. Publicar después del commit evita que un consumidor reaccione a una dosis que terminó revertida. |
| **D7** | **`marcarDosisTomada(consumptionId, timestamp)` y `calcularDiasRestantes(consumptionId)` cambian de semántica: ambos derivan el dueño de `actor.profileId`, buscan el `UserConsumption`, verifican propiedad, y devuelven 404 (nunca 403) ante un `consumptionId` de otro usuario.** **Delta declarado sobre las firmas crudas de `consumo/SPEC.md`**, que no tienen parámetro de dueño alguno. | Misma clase de vulnerabilidad que cerró D7 de `catalogo`: con RLS bypasseada en la conexión service-role, un `consumptionId` sin dueño permite a cualquier usuario leer y mutar el historial de dosis de cualquier otro enumerando IDs. **404 y no 403 a propósito**: un 403 confirmaría que el recurso existe y es de otro — filtra existencia cross-tenant. Los datos acá son de salud (medicamentos, dosis, mascotas): la fuga es más sensible que la de precios. |
| **D8** | **El dueño se fuerza desde el actor en todo el camino de escritura.** `registrarMascota(userId, …)` y `configurarConsumo(userId, …)` reciben `userId` **siempre** desde `actor.profileId`; ningún DTO de `consumo` acepta un `userId` del cliente. | Es **una sola regla aplicada a los 4 casos de uso públicos**, no cuatro decisiones — misma forma que D8 de `catalogo` y patrón ya fijado en `core-api-auth-guard` ("el controlador pasa escalares derivados del actor, nunca el objeto actor ni campos de identidad del cliente"). |
| **D9** | **El adaptador real de `NotificationPort` se bindea en un módulo NUEVO del kernel compartido, no dentro de `ConsumoModule`.** `shared/notifications/notifications.module.ts`, `@Global()`, espejo exacto de `shared/audit/audit.module.ts`: bindea `NOTIFICATION_PORT` → `ExpoPushNotificationAdapter` y lo exporta; se agrega a los `imports`/`exports` de `SharedKernelModule`. | `core-api/SPEC.md` ("Infraestructura compartida") ya declara este puerto como salida de **`consumo`, `ofertas` y `pedidos-pagos`** — tres dominios sin relación entre sí. Bindearlo privado dentro de `ConsumoModule` obligaría a dos dominios de negocio futuros a importar un módulo de dominio solo para alcanzar infraestructura transversal: **invierte la dirección de la dependencia**. Es exactamente el precedente que ya sentó `AuditLogPort`. **Es trabajo de alcance kernel entregado por el cambio de este dominio** (regla de la fundación: "el cuerpo viaja con el dominio que lo consume") — está listado explícitamente en Affected Areas para que ningún revisor lo lea como scope creep. `consumo.module.ts` queda con `exports` vacío. |
| **D10** | **Almacenamiento de push tokens: diferido. El adaptador nace con fallback no-op seguro.** `ExpoPushNotificationAdapter.sendPush(profileId, mensaje)` resuelve el token del perfil; **si no hay token registrado (el caso común), loguea y retorna sin lanzar**. Registrar/almacenar tokens está **explícitamente fuera de alcance**. | No existe ninguna tabla de push tokens en ninguna migración del repo, y `usuario-mobile`/`proveedor-mobile` siguen siendo mockups HTML: **no hay ningún cliente capaz de registrar un device token todavía**. Construir el almacenamiento ahora es construir para cero consumidores. La regla dura es la otra mitad de la decisión: **ningún caso de uso de `consumo` puede fallar porque un usuario no tenga dispositivo registrado** — el push es un efecto secundario best-effort, nunca una precondición del chequeo de stock. Ver R7. |
| **D11** | **El encuadre "Edge Function / `pg_cron`" de `docs/ARCHITECTURE.md` queda declarado superado.** Corrección explícita, documentada en este cambio y en el propio doc. | Esa sección se escribió cuando la arquitectura Supabase-directa seguía vigente y nunca se actualizó tras `backend-core-api-foundation`, que movió toda la lógica de negocio detrás de `core-api`. `consumo/SPEC.md` ("el cron vive dentro del mismo dominio") y `core-api/SPEC.md` ("`NotificationPort` usado como puerto de salida desde `consumo`") se escribieron **después** del pivote y son más específicos a este dominio: gobiernan ellos. Se declara en vez de sobrescribir en silencio, por la regla `rules.proposal` de `openspec/config.yaml`. |
| **D12** | **Los row types de Kysely son groundwork del slice 0**: `PetsTable`, `UserConsumptionTable`, `ConsumptionLogsTable` en `services/core-api/src/shared/database/schema.ts`, extendiendo `DB`. | No existen — `schema.ts` tipa hoy solo las tablas de `identidad` y `catalogo`, y su propio header dice que cada tabla "se tipa cuando aterriza el cambio de su dominio dueño". **Bloquea todo adaptador de persistencia**, gane lo que gane cualquier otra decisión. Misma clase de tarea-temprana-obligatoria que D13 de `catalogo`. |
| **D13** | **Sin `AuditLogPort` en este dominio.** Decisión explícita, no ausencia silenciosa. | Los 4 casos de uso públicos son acciones self-service de un usuario sobre sus propios datos — ninguno es una mutación administrativa. Fuera del alcance de `shared-audit-log`, que acota la auditoría a mutaciones de admin. Misma conclusión y mismo motivo que D10 de `catalogo`. El caso de uso interno del cron tampoco audita: es un proceso del sistema, no un actor. |
| **D14** | **Sin `contracts/` y sin `adapters/events/`.** Decisión explícita. | `consumo` es un **productor puro de eventos**: ningún otro `SPEC.md` de dominio lo menciona (ningún dominio necesita una lectura síncrona en sus datos), y su propia sección "Eventos que consume" dice literalmente "Ninguno". Ambas carpetas son hoy patrones establecidos y **no-default** del repo (`catalogo` necesitó las dos), así que su ausencia acá debe leerse como deliberada, no como un olvido. `consumo` es el segundo dominio publish-only, igual que `identidad`. |
| **D15** | **`UserConsumption` gana `userId: string` en `@repon/types`.** Delta sobre `shared-types-package`. | Verificado en `packages/types/src/consumo.ts`: `Pet` expone `userId` pero `UserConsumption` **no**, pese a que `db-schema-consumo` fija `user_consumption.user_id NOT NULL` como columna de dueño presente "regardless of `owner_type`". Sin ese campo en el tipo, la verificación de propiedad de D7 **no es expresable** sobre la entidad que devuelve el repositorio. Es la misma asimetría que `ProviderCatalogItem.companyId` ya resuelve del lado de `catalogo`. Es el único trabajo de tipos compartidos de este cambio: los 5 tipos de `consumo` ya están promovidos. |
| **D16** | **`strict_tdd: true` activo, sin excepciones. Tercer dominio del repo construido así** (después de `catalogo`, el primero). | La paradoja de bootstrap que justificó la excepción de `identidad` desapareció hace dos cambios. Los escenarios negativos de D7/D8 (usuario A → `consumptionId` de usuario B → **404**) y el escenario de debounce de D5 (dos corridas consecutivas del cron → **un solo** evento) son **tests obligatorios escritos primero**, no cobertura opcional. |

## Scope

### In Scope

1. **Groundwork** — row types de Kysely (D12), `UserConsumption.userId` en `@repon/types` (D15), migración nueva con el estado de debounce en `user_consumption` (D5).
2. **`consumo` vertical completo** — `domain/` (entidades `Pet`/`UserConsumption`, matemática de dosis y días restantes, invariante `petId` presente sii `ownerType === 'pet'`), `ports-in/` (4 casos de uso públicos + `procesarConsumosVencidos` interno, D2), `ports-out/` (los 2 puertos existentes, extendidos con lo que exijan D5/D7), `adapters/http|persistence|scheduling`, providers reales en `consumo.module.ts`.
3. **Adaptador de scheduling** — `@nestjs/schedule` como dependencia nueva + la clase `@Cron()` delgada de D1.
4. **Cierre de autorización** — D7 + D8 en los 4 casos de uso públicos, con escenarios negativos Given/When/Then en `sdd-spec`.
5. **Kernel de notificaciones** — `ExpoPushNotificationAdapter` con fallback no-op (D10) + `NotificationsModule` `@Global()` nuevo (D9) + su cableado en `SharedKernelModule`.
6. **Cron diario end-to-end** — `findDueForCheck` → cálculo → umbral → debounce (D5) → fan-out por ítem (D3) → push best-effort (D10), con captura por ítem (D4).
7. **Deltas declarados** — `services/core-api/domains/consumo/SPEC.md` (separación CQS de D2, firmas con dueño de D7, marcador de debounce de D5), `packages/types/SPEC.md` (D15), `docs/ARCHITECTURE.md` (D11).
8. **Tests** — unitarios con ports-out mockeados para los 5 casos de uso, negativos de autorización (404 cross-tenant), matemática de días restantes, debounce entre corridas consecutivas, aislamiento de fallas del loop del cron, y no-throw del adaptador de push sin token.

### Out of Scope

- **Almacenamiento y registro de push tokens** (D10) — sin tabla, sin endpoint, sin cliente. Se difiere al cambio que cablee una app móvil real.
- **Los 3 dominios restantes** (`refill-matching`, `ofertas`, `pedidos-pagos`) — siguen como placeholders. **No se implementa ningún consumidor de `StockBajoDetectado`/`RefillAutoSolicitado`**; este cambio solo los emite.
- **`adherenciaUltimos7Dias` como superficie de producto** — el método de `ports-out` ya existe y se implementa, pero **no** se expone una pantalla/endpoint de adherencia ni de racha: no hay caso de uso en `consumo/SPEC.md` que lo pida.
- **`AuditLogPort` en `consumo`** (D13). **`contracts/` y `adapters/events/`** (D14).
- **Recordatorios de horario de toma** (notificar "te toca la dosis de las 09:00") — `horarios` se persiste y se valida, pero el único job de este cambio es el chequeo diario de stock.
- **Alta disponibilidad del cron** (elección de líder, lock distribuido) — ver R10 y Q5: se nombra y se difiere, no se resuelve acá.
- **Cambiar `consumo/SPEC.md` en silencio** — todo delta va declarado (regla `rules.specs` de `openspec/config.yaml`).

## Capabilities

### New Capabilities

- `core-api-consumo`: los 4 casos de uso públicos + el caso de uso interno del cron, su superficie HTTP, las reglas de autorización (D7/D8), la separación CQS query/comando (D2), la semántica transaccional de `marcarDosisTomada` (D6), la semántica del cron diario (umbral, debounce D5, fan-out por ítem D3, aislamiento de fallas D4) y los 3 eventos publicados.
- `shared-notifications`: el binding de `NOTIFICATION_PORT` en el kernel (D9), el contrato del adaptador Expo Push y su garantía de **no-throw sin token registrado** (D10). Espejo de la capability `shared-audit-log` ya existente.

### Modified Capabilities

- `core-api-hexagonal-layout`: agregar `adapters/scheduling/` a la regla "Fixed per-domain folder shape", con presencia **condicional** — obligatoria cuando el dominio posee un job programado, omitida en caso contrario. Es exactamente la misma forma de corrección que D9 de `catalogo` ya hizo para `adapters/events/` (D1).
- `db-schema-consumo`: migración nueva con el estado de debounce en `user_consumption` (D5). Columnas exactas fijadas en `sdd-design` (Q1).
- `shared-types-package`: agregar `userId: string` a `UserConsumption` (D15).

## Approach

Bottom-up, 7 slices, cada uno revisable de forma independiente y terminando con `pnpm test` verde. Bajo D16, **cada slice arranca por los tests**.

```
0. groundwork      schema.ts (3 row types), UserConsumption.userId en @repon/types,
                   migracion del estado de debounce
1. dominio+lectura entidades + matematica de dosis/dias restantes, repositorios Kysely,
                   calcularDiasRestantes como query pura (D2)
2. escritura       registrarMascota, configurarConsumo, controller + DTOs + mapper,
                   dueno forzado desde el actor (D8) y 404 cross-tenant (D7)
3. dosis           marcarDosisTomada transaccional (D6) + DosisRegistrada
4. notificaciones  ExpoPushNotificationAdapter (fallback no-op, D10) +
                   NotificationsModule @Global() + cableado en SharedKernelModule (D9)
5. cron            procesarConsumosVencidos (umbral + debounce D5 + fan-out por item D3
                   + captura por item D4), luego el @Cron() delgado en
                   adapters/scheduling/ (D1)
6. cierre          cableado del modulo, deltas declarados de SPEC.md, correccion de
                   docs/ARCHITECTURE.md (D11)
```

El slice 0 aterriza **antes** de cualquier lógica: los row types y el campo `userId` son costuras, y una costura mal puesta con 5 casos de uso encima ya no es gratis. El slice 4 va **antes** que el cron a propósito: el caso de uso del slice 5 inyecta `NOTIFICATION_PORT`, y tenerlo bindeado de verdad evita escribir el cron contra un mock que después no calza con el adaptador real. El slice 5 fija la forma de `StockBajoDetectado`/`RefillAutoSolicitado` mientras el número de consumidores sigue siendo **cero** (R3).

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `services/core-api/src/domains/consumo/domain/` | New | Entidades `Pet`/`UserConsumption`, matemática de días restantes, invariante `petId` ⟺ `ownerType === 'pet'` |
| `services/core-api/src/domains/consumo/ports-in/` | New | 4 casos de uso públicos + `procesar-consumos-vencidos.use-case.ts` interno (D2) |
| `services/core-api/src/domains/consumo/ports-out/consumption-repository.port.ts` | Modified | Lo que exijan D5 (marcador de debounce) y D7 (`findById` con dueño) |
| `services/core-api/src/domains/consumo/ports-out/consumption-log-repository.port.ts` | Modified | Confirmar firmas contra el uso real; sin cambio previsto |
| `services/core-api/src/domains/consumo/adapters/http/` | New | Controller, DTOs, mapper — ningún DTO acepta `userId` (D8) |
| `services/core-api/src/domains/consumo/adapters/persistence/` | New | `KyselyConsumptionRepository`, `KyselyConsumptionLogRepository` |
| `services/core-api/src/domains/consumo/adapters/scheduling/` | New | `consumption-check.job.ts` — `@Cron()`, un método, cero lógica (D1). **Primera vez en el repo** |
| `services/core-api/src/domains/consumo/consumo.module.ts` | Modified | De `@Module({})` vacío a providers reales; `exports` queda vacío (D9/D14) |
| `services/core-api/src/shared/notifications/expo-push.adapter.ts` | New | **Alcance kernel, no dominio** (D9/D10) — no es scope creep, es el precedente de `AuditLogPort` |
| `services/core-api/src/shared/notifications/notifications.module.ts` | New | **Alcance kernel** — `@Global()`, espejo exacto de `audit.module.ts` (D9) |
| `services/core-api/src/shared/shared-kernel.module.ts` | Modified | Agregar `NotificationsModule` a `imports`/`exports`; su doc comment dice hoy "intentionally not wired here" y deja de ser cierto |
| `services/core-api/src/shared/database/schema.ts` | Modified | `PetsTable`, `UserConsumptionTable`, `ConsumptionLogsTable`, extender `DB` (D12) |
| `services/core-api/src/app.module.ts` | Modified | Registrar `ScheduleModule.forRoot()` (D1). `ConsumoModule` ya está importado |
| `services/core-api/package.json` | Modified | Dependencias nuevas: `@nestjs/schedule` (D1) y el cliente de Expo Push (D10, Q7) |
| `packages/types/src/consumo.ts` | Modified | `UserConsumption.userId` (D15) |
| `supabase/migrations/` | New (confirmado) | Estado de debounce en `user_consumption` (D5), fix-forward |
| `services/core-api/domains/consumo/SPEC.md` | Modified | Deltas declarados: separación CQS (D2), firmas con dueño (D7), marcador de debounce (D5) |
| `packages/types/SPEC.md` | Modified | Documenta `UserConsumption.userId` (D15) |
| `docs/ARCHITECTURE.md` | Modified | Corrección declarada del encuadre Edge Function / `pg_cron` (D11) |
| `services/core-api/src/domains/refill-matching/` | None | Sigue placeholder; este cambio emite eventos, no implementa consumidores |

## Risks

| Riesgo | Prob. / Impacto | Mitigación |
|---|---|---|
| **R1 — Lectura y mutación cross-tenant de datos de salud.** RLS bypasseada en la conexión service-role; `marcarDosisTomada`/`calcularDiasRestantes` sin dueño permiten enumerar `consumptionId` y leer o alterar el historial de dosis de cualquier usuario | Media / **Crítico** | D7 + D8 lo cierran estructuralmente. Bajo D16 los negativos (usuario A → consumo de usuario B → **404**, no 403) son tests obligatorios **escritos primero**, en `sdd-spec` como Given/When/Then explícitos |
| **R2 — Spam diario y `RefillRequest` duplicados.** Sin debounce, un ítem con stock bajo sin resolver genera una push por día y un refill automático por día, indefinidamente | Media-Alta / Medio-Alto | D5 lo cierra en `consumo` con estado en esquema. El test obligatorio es explícito: **dos corridas consecutivas del cron sobre la misma condición → exactamente un evento**. Q1 fija la columna en `sdd-design` antes del slice 5 |
| **R3 — El payload de `RefillAutoSolicitado` se congela apenas aterrice `refill-matching`.** Hoy no lo consume nadie; es el **primer** evento cross-dominio que ese dominio va a leer, y su forma decide qué puede construir | Alta (a futuro) / Alto | Se fija en el slice 5 con **cero** consumidores (Q4). Debe llevar la identidad concreta del consumo afectado, no un conteo (D3), porque `refill-matching` crea un `RefillRequest` por ítem |
| **R4 — Landmine de efecto secundario silencioso.** Si D2 se implementa "según la prosa literal del SPEC", cualquier `GET` futuro de días restantes dispara pushes y refills | Baja (con D2) / **Alto** | D2 lo separa estructuralmente: el caso de uso con efectos no tiene ruta HTTP ni decorador de roles, y el que sí es alcanzable no inyecta `EVENT_PUBLISHER` ni `NOTIFICATION_PORT`. La garantía es por construcción, igual que el "sin `TRANSACTION_MANAGER` inyectado" de `cargarCatalogoMasivo` |
| **R5 — Radio de impacto del kernel compartido.** D9 modifica `shared/notifications/` y `SharedKernelModule`, un módulo `@Global()` que toca **toda** la app, incluyendo `identidad` y `catalogo`, ya archivados y en verde | Media / Medio-Alto | El módulo es puramente aditivo: bindea un token que hoy no tiene proveedor y que **nadie inyecta todavía** — no puede cambiar el comportamiento de un dominio existente. Las suites completas de `identidad` y `catalogo` corren en CI antes de cerrar el cambio, no solo los tests nuevos |
| **R6 — `@nestjs/schedule` es un patrón arquitectónico genuinamente nuevo para el repo, sin precedente de PRs bajo strict TDD** | Media / Medio | `sdd-tasks` define incrementos testeables (matemática pura → umbral + debounce con ports mockeados → el `@Cron()` delgado, que por diseño no necesita test propio porque no tiene lógica), no un PR grande |
| **R7 — Notificaciones verdes pero sin entrega real.** Con D10, sin tokens registrados **ninguna push llega a ningún dispositivo**, y todos los tests pasan igual | Alta (por diseño) / Bajo hoy, Medio si se olvida | Es una consecuencia aceptada de D10, no un bug: no hay cliente móvil que pueda recibirla. Se mitiga con un log explícito por cada envío omitido y dejando el registro de tokens **nombrado** como out-of-scope, no implícito. `StockBajoDetectado` sí se emite y persiste el valor de negocio aunque la push no salga |
| **R8 — Row types de Kysely faltantes bloquean todo adaptador de persistencia** | Alta / Bajo | D12: slice 0, la tarea más temprana posible |
| **R9 — Presupuesto de review.** 4 casos de uso públicos + 1 interno + adaptador de scheduling nuevo + módulo de kernel nuevo + migración de debounce supera holgadamente 400 líneas — misma forma que R6/R7 de `catalogo` | Alta / Medio | Expectativa declarada acá; la decisión real de PRs encadenados la toma **`sdd-tasks`** (`delivery_strategy: ask-on-risk`), no este documento. Los 7 slices ya están dibujados como unidades de trabajo autónomas |
| **R10 — El cron se dispara N veces con N instancias.** `@nestjs/schedule` corre el `@Cron()` en **cada** proceso: con más de una réplica, el chequeo diario se ejecuta en paralelo y D5 deja de ser suficiente (dos instancias pueden leer el marcador antes de que ninguna lo escriba) | Baja hoy / Alto en producción escalada | Se nombra explícitamente y se difiere a `sdd-design` (Q5). D1 mantiene la salida barata: al ser un adaptador delgado, migrar a un scheduler externo o a un advisory lock de Postgres no toca el caso de uso ni sus tests |

## Rollback Plan

Greenfield: sin deploy, sin datos productivos, sin consumidores (`refill-matching` es un placeholder vacío — verificado). El rollback operacional es `git revert` de la cadena de PRs y `consumo` vuelve a ser un `@Module({})` vacío; `app.module.ts` ya lo importa y arranca igual.

Tres excepciones que no revierten con `git revert` solo:

1. **La migración de D5** se revierte con una migración fix-forward, nunca editando la aplicada (convención ya establecida en `20260804090500_10_grants_domain_tables_service_role.sql`).
2. **`NotificationsModule` en `SharedKernelModule`** (D9) toca el arranque global — revertirlo es quitar un import de un módulo cuyo token hoy no inyecta nadie más, así que es seguro **mientras `ofertas`/`pedidos-pagos` sigan siendo placeholders**. Después deja de serlo.
3. **`ScheduleModule.forRoot()`** en `app.module.ts` (D1): si el cron causa problemas en runtime, la mitigación rápida es desactivar el job sin revertir el vertical — el caso de uso `procesarConsumosVencidos` sigue siendo invocable y testeable sin el adaptador.

La pregunta real es qué queda barato y qué queda caro una vez que `refill-matching`, `ofertas` y `pedidos-pagos` se construyan encima:

| Barato de cambiar después | Caro de cambiar después |
|---|---|
| **Mecanismo del cron (D1)**: adaptador delgado; pasar a scheduler externo, contenedor o advisory lock es un cambio confinado a `adapters/scheduling/` | **Payload de `StockBajoDetectado`/`RefillAutoSolicitado` (D3/Q4)**: con `refill-matching` implementado encima, cambiarlo es un breaking change cross-dominio coordinado |
| **Forma exacta de la columna de debounce (D5/Q1)**: la escribe y la lee solo `consumo`, nadie más la ve | **Granularidad por ítem vs. resumen (D3)**: si `refill-matching` asume un evento por ítem, volver a resumen le rompe la creación de solicitudes |
| **Implementación del adaptador Expo (D10)**: aislado detrás de `NotificationPort`; cambiar de proveedor de push no toca ningún dominio | **Ubicación del binding de `NotificationPort` (D9)**: si `ofertas`/`pedidos-pagos` terminan importando `ConsumoModule` para alcanzarlo, redibujar ese borde después es exactamente lo que hace fracasar la historia de extracción a microservicios |
| **Umbral y fórmula de días restantes (Q2/Q3)**: viven en el dominio, testeados en aislamiento | **Semántica 404-en-vez-de-403 (D7)**: cambiarla después es un cambio de contrato de API observable por los clientes |
| **Horario y cadencia del cron (Q6)**: configuración del adaptador | **Separación CQS de D2**: cada caso de uso se escribe asumiendo una forma; fusionarlos después reintroduce R4 en todo el camino de lectura |

## Dependencies

- `backend-core-api-foundation` (archivado): shared kernel, `AuthGuard`/`RolesGuard`, `EventBusModule`, `TransactionManager`, `NOTIFICATION_PORT`/`EVENT_PUBLISHER` como tokens, `@repon/types` y el runner de Jest. **Todo presente.**
- `backend-core-api-catalogo` (archivado): precedentes de `contracts/`, `adapters/events/`, el patrón de fallo parcial y la regla 404-cross-tenant. **Presente.**
- Migraciones de `backend-supabase-migrations` aplicadas: `pets`, `user_consumption`, `consumption_logs`, RLS y el índice `(consumption_id, tomado_at DESC)`. **Todo presente.**
- **Dependencias externas nuevas (2)**: `@nestjs/schedule` (D1) y un cliente de Expo Push (D10) — el paquete exacto se elige en `sdd-design` (Q7).
- **Q1 y Q2 resueltas en `sdd-design` antes del slice 5** — Q1 puede implicar una migración, y una migración descubierta a mitad de slice es una interrupción, no un detalle.

## Preguntas abiertas (para `sdd-spec` / `sdd-design`)

| # | Pregunta | Dueño | Estado |
|---|---|---|---|
| Q1 | **Forma exacta del estado de debounce (D5)**: ¿`ultima_notificacion_stock_bajo timestamptz` (con condición de limpieza al reponer stock), un booleano `refill_auto_abierto`, o ambos? Incluye definir **qué evento o acción lo limpia** — reposición de stock detectada por el propio cron, `configurarConsumo`, o un evento de vuelta desde `refill-matching`. El enfoque está cerrado (D5); falta el detalle | `sdd-design` | Abierta |
| Q2 | **Dónde vive "el umbral configurado"**. `consumo/SPEC.md` lo menciona pero `UserConsumption` **no tiene ningún campo de umbral** (verificado en `packages/types/src/consumo.ts`). Opciones: constante de dominio, config por entorno, o columna nueva por consumo (segunda migración, se agruparía con Q1) | `sdd-design` + producto | Abierta |
| Q3 | **Predicado exacto de `findDueForCheck()`** — qué hace a un `UserConsumption` "due": ¿todos los activos?, ¿solo los que tienen stock por debajo de N días?, ¿se excluyen los ya debounceados (D5) en SQL o en el caso de uso? Impacta directamente el costo del cron | `sdd-design` | Abierta |
| Q4 | **Payload de `StockBajoDetectado` y `RefillAutoSolicitado`**. Se fija con **cero** consumidores (R3); debe llevar lo mínimo para que `refill-matching` cree un `RefillRequest` sin volver a consultar a `consumo` — que no tiene `contracts/` para atender esa consulta (D14) | `sdd-design` | Abierta |
| Q5 | **Seguridad del cron con múltiples instancias (R10)**: ¿se asume una sola réplica y se documenta, o se agrega un advisory lock de Postgres desde el día 1? | `sdd-design` | Abierta |
| Q6 | **Horario, zona horaria y expresión cron del chequeo diario**, y qué pasa si una corrida se solapa con la anterior | `sdd-design` | Abierta |
| Q7 | **Cliente de Expo Push**: ¿`expo-server-sdk` o un `fetch` directo a la API de Expo? Y **cómo resuelve `profileId` → token** el adaptador mientras no exista almacenamiento (D10) — presumiblemente devolviendo siempre "sin token" hasta que exista la tabla | `sdd-design` | Abierta |

## Success Criteria

- [ ] Los 4 casos de uso públicos responden por HTTP con validación de DTO y cada uno tiene test unitario con ports-out mockeados
- [ ] **Un usuario A recibe 404 —no 403— al llamar `marcarDosisTomada` o `calcularDiasRestantes` sobre un `consumptionId` del usuario B**, con test negativo escrito antes que la implementación (D7 + D16)
- [ ] Ningún DTO de `consumo` acepta `userId` del cliente; los 4 casos de uso públicos lo reciben derivado de `actor.profileId` (D8)
- [ ] `calcularDiasRestantes` **no inyecta** `EVENT_PUBLISHER` ni `NOTIFICATION_PORT`, y `procesarConsumosVencidos` **no tiene ruta HTTP ni decorador de roles** — ambas garantías verificables por inspección, no por convención (D2 + R4)
- [ ] Dos corridas consecutivas del cron sobre el mismo `UserConsumption` con stock bajo sin resolver emiten **exactamente un** `StockBajoDetectado` y **exactamente un** `RefillAutoSolicitado` (D5)
- [ ] Un cron con N ítems bajo umbral emite **N** `StockBajoDetectado`, no uno resumen (D3)
- [ ] Un ítem que falla dentro del loop del cron no impide procesar los restantes, y su error queda logueado (D4)
- [ ] `marcarDosisTomada` escribe el log y decrementa el stock en **una sola transacción**, y publica `DosisRegistrada` **después** del commit; un fallo en la segunda escritura no deja el log persistido (D6)
- [ ] `NOTIFICATION_PORT` resuelve a `ExpoPushNotificationAdapter` desde `SharedKernelModule`, y **`consumo.module.ts` no lo bindea ni lo exporta** (D9)
- [ ] `sendPush` sobre un `profileId` sin token registrado **loguea y retorna sin lanzar**; ningún caso de uso de `consumo` falla por ausencia de dispositivo (D10)
- [ ] `schema.ts` tipa `pets`, `user_consumption` y `consumption_logs`, y `DB` las incluye (D12)
- [ ] `UserConsumption.userId` se importa desde `@repon/types`; cero re-declaración del tipo en `core-api` (D15)
- [ ] `domains/consumo/` contiene `adapters/scheduling/` y **no** contiene `contracts/` ni `adapters/events/`, y el delta de `core-api-hexagonal-layout` lo declara como regla, no como excepción (D1 + D14)
- [ ] La clase `@Cron()` contiene exactamente una llamada a un caso de uso de `ports-in` y cero lógica de negocio (D1)
- [ ] Los deltas sobre `consumo/SPEC.md` (D2, D5, D7), `packages/types/SPEC.md` (D15) y `docs/ARCHITECTURE.md` (D11) están escritos en esos archivos, no solo en este cambio
- [ ] Las suites completas de `identidad` y `catalogo` siguen en verde tras tocar `SharedKernelModule` — sin regresión (R5)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verde en CI; ningún DELETE físico introducido
