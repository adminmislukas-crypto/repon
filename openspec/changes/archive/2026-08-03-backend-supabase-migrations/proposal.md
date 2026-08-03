# Proposal: Backend Supabase — migraciones reales, RLS, Storage y Auth

## Intent

`supabase/` contiene solo `SPEC.md`: no existen `migrations/` ni `functions/`. No hay base de datos. Nada de `core-api` ni de las apps puede implementarse hasta que exista el esquema.

`supabase/SPEC.md` parece listo pero no lo está: define 16 nombres de tabla y una tabla RLS en prosa, **sin una sola columna** para 8 de esas 16 tablas. El trabajo real de este cambio no es "traducir el spec a SQL" — es **definir el esquema a nivel de columna** y recién después escribir las migraciones.

Éxito = un `supabase db reset` limpio levanta las 16+ tablas con FKs, índices, RLS y buckets, y `packages/types/SPEC.md` coincide 1:1 con el esquema real.

## Decisiones ya tomadas (no re-abrir)

| # | Decisión | Consecuencia directa en este cambio |
|---|---|---|
| D1 | `core-api` se conecta a Postgres con **service-role key** (bypassea RLS). La autorización de negocio vive en el dominio (guards + casos de uso hexagonales). | RLS deja de ser la capa de escritura. Postura por defecto: **RLS habilitado + deny-all** en las 16 tablas, y se agregan **solo políticas `SELECT`** para las rutas de lectura directa desde apps (anon/authenticated). **Cero políticas de `INSERT`/`UPDATE`/`DELETE` para el cliente.** Motivo: el dominio tiene operaciones cross-tenant intrínsecas (matching lee solicitudes que no son del proveedor) que RLS-por-fila no puede expresar sin negarse a sí misma. |
| D2 | `Profile.status: ProfileStatus` y `Offer.status: OfferStatus` ya existen en `packages/types/SPEC.md`. | Las migraciones crean los enums `profile_status` y `offer_status`. Queda **abierto para `sdd-spec`**: `ofertas` no tiene caso de uso que dispare `'rechazada'`/`'expirada'` (ej. "oferta desplazada cuando se acepta otra"). No inventar esa lógica aquí. |
| D3 | Migraciones **incrementales ordenadas por dominio**, siguiendo la cadena FK ya validada. Cada lote lleva **su propio RLS en la misma migración**. | 7 lotes: identidad → consumo → catálogo → refill-matching → ofertas → pedidos-pagos → auditoría. Un SDD change, sliceado en PRs encadenados en `sdd-tasks`/`sdd-apply`. |

## Scope

### In Scope

1. **Definir el esquema a nivel de columna de las 8 tablas sin especificar** (`companies`, `admin_roles`, `catalog_products`, `provider_catalog`, `consumption_logs`, `order_items`, `payments`, `audit_log`) — el grueso del trabajo.
2. Migraciones SQL para las 16 tablas + `company_dispatch_zones` (nueva, ver Q2), con FKs, enums, índices y `created_at`/`updated_at`.
3. Políticas RLS por tabla, en la misma migración que la tabla, bajo la postura deny-all de D1.
4. Extensiones (`pgcrypto`, `pg_trgm`) y publicación Realtime sobre `offers`.
5. Buckets de Storage + sus políticas `storage.objects` (separadas del RLS de tablas).
6. Provisioning de Auth: relación `auth.users` ↔ `profiles` y su gap de atomicidad; runbook de bootstrap del primer `super_admin`.
7. Sincronizar `packages/types/SPEC.md` y `supabase/SPEC.md` con el esquema final (incl. corregir la redacción RLS de "zona de despacho", ver Q2).

### Out of Scope

- Implementación de las 4 Edge Functions (`match-refill-request`, `check-consumption-stock`, `find-proactive-opportunities`, `payment-webhook`) y el registro `pg_cron` — cambio siguiente; este solo deja el esquema que consumen.
- Cualquier código de `core-api` (repositorios, adaptadores, guards).
- Integración con Webpay/MercadoPago.
- Parsing/procesamiento de la carga masiva `.xlsx`/`.csv` (el bucket sí entra; el pipeline no).
- **Comprobantes** (ver Q3) — requiere primero un caso de uso de dominio.
- `companies.rating` (mencionado en `admin-web/SPEC.md`): es una métrica derivada sin fórmula definida. No se persiste como columna.
- Tabla de referencia de comunas de Chile.

## Capabilities

`openspec/specs/` está vacío — todas son nuevas. No hay capabilities modificadas.

### New Capabilities

- `db-schema-identidad`: `companies`, `company_dispatch_zones`, `profiles`, `admin_roles`
- `db-schema-consumo`: `pets`, `user_consumption`, `consumption_logs`
- `db-schema-catalogo`: `catalog_products`, `provider_catalog`
- `db-schema-refill-matching`: `refill_requests`, `refill_items`
- `db-schema-ofertas`: `offers`, `offer_items` + publicación Realtime
- `db-schema-pedidos-pagos`: `orders`, `order_items`, `payments`
- `db-schema-auditoria`: `audit_log` (append-only)
- `db-access-control`: convenciones RLS transversales — deny-all por defecto, allowlist de lectura directa, patrón único para tablas hijas, prohibición de `DELETE`
- `storage-buckets`: buckets y políticas `storage.objects`
- `auth-provisioning`: `auth.users` ↔ `profiles`, compensación ante fallo parcial, bootstrap de admin

### Modified Capabilities

- None (a nivel de `openspec/specs/`). Sí se actualizan dos SPEC.md de producto pre-existentes: `supabase/SPEC.md` y `packages/types/SPEC.md` — cambios declarados, no silenciosos.

## Approach

Un lote de migración por dominio, en orden de dependencia FK, cada uno auto-contenido (tablas + enums + índices + RLS + grants):

```
0. extensiones + enums base
1. identidad     companies, company_dispatch_zones, profiles, admin_roles
2. consumo       pets, user_consumption, consumption_logs
3. catalogo      catalog_products, provider_catalog
4. refill        refill_requests, refill_items
5. ofertas       offers, offer_items (+ Realtime)
6. pedidos       orders, order_items, payments
7. auditoria     audit_log
8. storage       buckets + storage.objects policies
```

Convenciones transversales: PK `uuid` con `gen_random_uuid()`; `snake_case` en DB, `camelCase` en TS; `timestamptz` siempre; sin `DELETE` (baja vía `status`, per `docs/ARCHITECTURE.md`); `created_at`/`updated_at` en toda tabla mutable.

## Esquema propuesto para las 8 tablas indefinidas

> Borrador derivado de cruzar `docs/DATA_MODEL.md` (prosa) con las firmas de puertos de los SPECs de dominio. **A finalizar en `sdd-spec`** — ninguna de estas listas es final.

| Tabla | Columnas propuestas | Derivado de |
|---|---|---|
| `companies` | `id`, `razon_social`, `rut` (unique), `giro`, `status company_status` default `'pendiente'`, `created_at`, `updated_at` | `docs/DATA_MODEL.md`; `identidad/SPEC.md` (`registrarEmpresa`, `aprobarEmpresa`) |
| `company_dispatch_zones` *(nueva)* | `id`, `company_id` FK, `comuna`, `region`, unique(`company_id`,`comuna`) | Ver Q2 |
| `admin_roles` | `id`, `profile_id` FK `profiles` **unique**, `rol admin_role`, `granted_by` FK `profiles`, `created_at` | `asignarRolAdmin(profileId, rol)` — un sub-rol por admin |
| `catalog_products` | `id`, `nombre`, `categoria`, `marca?`, `presentacion?`, `imagen_url?`, `status`, `created_at`, `updated_at` + índice trigram en (`categoria`,`nombre`) | `buscarProductos(query, categoria?)` |
| `provider_catalog` | `id`, `company_id` FK, `catalog_product_id` FK **nullable** (Q4), `nombre`, `categoria`, `precio_base numeric`, `precio_maximo numeric`, `stock int`, `disponible bool`, `imagen_url?`, `created_at`, `updated_at` | `catalogo/SPEC.md` entidad `ProviderCatalogItem` + `actualizarPrecio`, `ajustarPreciosPorCategoria` |
| `consumption_logs` | `id`, `consumption_id` FK `user_consumption`, `tomado_at timestamptz`, `cantidad numeric?`, `created_at` + índice (`consumption_id`, `tomado_at desc`) | `marcarDosisTomada`, `adherenciaUltimos7Dias` |
| `order_items` | `id`, `order_id` FK, `offer_item_id` FK, `nombre`, `cantidad`, `precio_unitario`, `subtotal`, `created_at` | `pedidos-pagos/SPEC.md`. **Semántica de snapshot**: copia congelada al comprar; editar el catálogo después no debe alterar pedidos históricos (requisito contable) |
| `payments` | `id`, `order_id` FK **unique**, `gateway`, `external_transaction_id`, `monto`, `moneda` default `'CLP'`, `estado payment_status`, `raw_payload jsonb`, `paid_at?`, `created_at`, `updated_at`. **Nunca datos de tarjeta.** | `PaymentGatewayPort`, `procesarWebhookPago` |
| `audit_log` | `id`, `actor_profile_id` FK `profiles`, `accion`, `entity_type`, `entity_id uuid` (polimórfico, **sin FK a propósito**), `cambios jsonb`, `motivo?`, `created_at`. **Append-only**: sin grants de `UPDATE`/`DELETE` para nadie, ni service-role | `docs/DATA_MODEL.md` ("quién, sobre qué entidad, qué cambió, cuándo") |

## Resolución recomendada de las preguntas abiertas restantes

| # | Pregunta | Recomendación | Razón |
|---|---|---|---|
| Q1 | Esquema de las 8 tablas | **IN SCOPE**, borrador arriba, se cierra en `sdd-spec` | Es el grueso del trabajo, no groundwork previo |
| Q2 | Estructura de "zona de despacho" | Tabla hija `company_dispatch_zones(company_id, comuna, region)` + columna estructurada `refill_requests.comuna` junto a la `direccion` de texto libre. **No** polígonos geo en v1. Corregir la redacción RLS de `supabase/SPEC.md`: la coincidencia de zona la hace el matching, RLS no puede expresarla sola | El despacho en Chile opera a granularidad de comuna. Sin una clave de join estructurada, ni la Edge Function ni RLS pueden hacer el match — la regla escrita hoy es inimplementable (R3) |
| Q3 | Qué es un "comprobante" | **Dividir y diferir.** Comprobante de *pago*: OUT — el checkout hospedado lo emite, la pasarela es el sistema de registro, nosotros solo guardamos `external_transaction_id`. Comprobante de *entrega* (foto): real pero **sin caso de uso de dominio hoy** (ningún puerto lo expone) → follow-up que empieza en `pedidos-pagos/SPEC.md`, no en una migración | Modelar storage para un requisito que ningún dominio expresa es adivinar. Agregar después un `comprobante_url` nullable en `orders` es barato |
| Q4 | FK dura a `catalog_products` | **FK nullable** `catalog_product_id` en `provider_catalog` **y** en `refill_items`, conservando `nombre`/`categoria` denormalizados. Texto libre sigue siendo el fallback de matching en v1 | Es la decisión **más cara de diferir** del cambio. Agregar la columna después es barato; **backfillear** meses de texto libre a IDs es caro y con pérdida. Nullable (no `NOT NULL`) evita bloquear al proveedor cuyo producto no está en el catálogo de referencia. Riesgo en ambas direcciones: con FK, fricción de carga; sin FK, el matching se degrada en silencio por typos/sinónimos (R7) |
| Q5 | Bootstrap de admin | **Paso manual documentado**, no caso de uso: crear el usuario en Supabase Auth por dashboard, luego seed con service-role que inserta `profiles` + `admin_roles(rol='super_admin')`. `asignarRolAdmin` sigue siendo admin-only | Un endpoint de auto-provisión de admin es una escalada de privilegios permanente a cambio de una comodidad de una sola vez |
| Q6 | RLS de `catalog_products` | **Lectura solo `authenticated`**, no `anon` | Ambas apps exigen login antes de llegar al buscador; `anon` regala el catálogo completo al scraping. Abrir a `anon` después es una línea; cerrarlo cuando ya hay consumidores públicos, no |
| Q7 | Custom JWT claims / Auth Hooks | **No en v1** | RLS acá es estructural (`auth.uid()`), no basada en claims; la diferenciación de roles vive en `core-api` (D1). Agregar un Auth Hook después es aditivo |
| Q8 | Tablas hijas sin columna de dueño (`refill_items`, `offer_items`, `order_items`, `consumption_logs`) | Convención **única** decidida una vez en `sdd-design`: `EXISTS`-subquery contra el padre, **o** denormalizar `user_id`. Recomendado: `EXISTS` por defecto; denormalizar solo donde el read path lo justifique | D1 reduce mucho el problema (solo hace falta el patrón para `SELECT`, no para escrituras). Implementaciones ad hoc por tabla son fuente clásica de fugas de datos o negaciones excesivas (R4) |

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `supabase/migrations/` | New | 9 migraciones (extensiones + 7 dominios + storage) |
| `supabase/seed.sql` | New | Seed del primer `super_admin` (runbook manual) |
| `supabase/SPEC.md` | Modified | Columnas reales; corregir redacción RLS de zona de despacho; agregar `company_dispatch_zones` |
| `packages/types/SPEC.md` | Modified | Tipos para las 8 tablas nuevas; `catalogProductId?` en `RefillItem`; `comuna` en `RefillRequest` |
| `docs/DATA_MODEL.md` | Modified | Agregar `company_dispatch_zones` al mapa de relaciones |
| `services/core-api/domains/ofertas/SPEC.md` | Modified | Caso de uso pendiente para `'rechazada'`/`'expirada'` (D2) |

## Risks

| Riesgo | Prob. | Mitigación |
|---|---|---|
| R4-A — Texto libre en matching degrada la calidad del marketplace en silencio | Alta | FK nullable desde el día 1 (Q4); métrica de cobertura `catalog_product_id IS NOT NULL` |
| R4-B — La FK genera fricción y los proveedores no cargan catálogo | Media | Nullable, nunca `NOT NULL`; texto libre sigue siendo camino válido |
| R5 — Gap de atomicidad Auth ↔ `profiles` (dos sistemas, sin transacción compartida) | Alta | `sdd-design` define compensación: crear Auth primero, y ante fallo del insert de `profiles`, borrar el usuario de Auth; más un job de reconciliación de huérfanos |
| R6 — Perder "comprobantes" como requisito al diferirlo | Media | Registrado explícitamente como follow-up con dueño (`pedidos-pagos/SPEC.md`), no como omisión |
| Deriva entre `packages/types/SPEC.md` y el esquema real | Alta | Sincronización de tipos en el mismo PR que cada lote de migración, no al final |
| Deny-all de RLS rompe lecturas directas de las apps (incl. Realtime en `offers`, que respeta RLS) | Media | Allowlist explícita de lectura directa en `sdd-spec`; `offers` **requiere** política `SELECT` para el dueño de la solicitud o Realtime no entrega nada |
| El lote de identidad excede el presupuesto de 400 líneas de review | Media | `sdd-tasks` puede sub-slicear identidad (companies+zones / profiles+admin_roles) |

## Rollback Plan

Esquema desde cero, sin datos productivos: hasta el primer deploy real, el rollback es `supabase db reset` — costo prácticamente nulo. Cada migración lleva su `-- down` inverso (drop de políticas → tablas → enums). Lo que importa es qué queda **caro de cambiar después**:

| Barato de cambiar después | Caro de cambiar después |
|---|---|
| Predicados RLS y allowlist de lectura | `catalog_product_id`: agregar la columna es barato, **backfillear texto libre a IDs es caro y con pérdida** |
| Agregar columnas nullable (ej. `orders.comprobante_url`) | `refill_requests.comuna`: sin ella desde el inicio, derivar comuna de direcciones libres es parsing arqueológico |
| Índices | Semántica de snapshot de `order_items`: cambiarla a precios vivos rompe el historial contable |
| Abrir `catalog_products` a `anon` | Forma polimórfica de `audit_log`: reescribir un log append-only histórico no es viable |
| Agregar Auth Hooks / custom claims | Tipo de PK (`uuid`) — migrar PKs con FKs vivas es una operación de riesgo |
| Buckets de Storage y sus políticas | Baja lógica vs física: si algo se borra físicamente, no hay rollback |

## Dependencies

- Proyecto Supabase creado; Supabase CLI disponible localmente (el repo no tiene tooling todavía — `sdd-tasks` debe incluir su scaffolding).
- `auth.users` es gestionada por Supabase: dependencia implícita de orden cero para `profiles`, no se migra.
- Primer usuario de Auth creado manualmente antes del seed de `super_admin`.

## Success Criteria

- [ ] `supabase db reset` corre limpio de cero y crea las 17 tablas en orden FK sin errores.
- [ ] Las 8 tablas antes indefinidas tienen columnas explícitas, con tipos y constraints, aprobadas en `sdd-spec`.
- [ ] Toda tabla tiene RLS habilitado; ninguna concede `INSERT`/`UPDATE`/`DELETE` a `anon`/`authenticated`; cada `SELECT` permitido está justificado en la allowlist.
- [ ] Ninguna tabla concede `DELETE` a ningún rol de cliente (`docs/ARCHITECTURE.md`, principio de dar de baja).
- [ ] `packages/types/SPEC.md` coincide 1:1 con las columnas reales (`camelCase` ↔ `snake_case`).
- [ ] Existen los índices de `supabase/SPEC.md` (`refill_requests.user_id`, `offers.refill_request_id`, `provider_catalog.company_id`) más el trigram de búsqueda de catálogo.
- [ ] Realtime está publicado en `offers` y una lectura autenticada de prueba recibe eventos.
- [ ] Los buckets de Storage existen con sus políticas `storage.objects`.
- [ ] El bootstrap del primer `super_admin` está documentado y ejecutado en el proyecto de desarrollo.
- [ ] La redacción RLS de zona de despacho en `supabase/SPEC.md` describe lo que RLS realmente hace.
