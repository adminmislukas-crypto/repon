# supabase

Especificación del backend antes de escribir migraciones reales. Ver `docs/DATA_MODEL.md` para el mapa de relaciones.

## Definition of Done — por lote de migración

Checklist, no CI (el repo no tiene tooling de CI y no se va a inventar una compuerta que no existe — ver `openspec/changes/backend-supabase-migrations/design.md` D-3). Cada lote (`NN_<dominio>`) se entrega en **un solo commit/PR** con los 5 artefactos siguientes:

1. **Migración** — `supabase/migrations/<timestamp>_NN_<dominio>.sql`. Timestamps pre-asignados y congelados (D-3), nunca generados con `supabase migration new` al momento de escribir el PR. Estructura interna fija de 8 secciones, siempre en el mismo orden: enums → tablas → constraints/FK diferidas → índices → trigger `updated_at` → grants (`revoke all` → `grant` estrecho) → RLS (enable + políticas) → realtime/publication (solo donde aplica). El paso de RLS va en el **mismo archivo** que el de tablas: una tabla nunca existe en un commit sin su RLS.
2. **Rollback** — `supabase/rollback/NN_<dominio>_down.sql`. Manual, el CLI no lo lee. Inverso completo: drop políticas → drop tablas → drop enums.
3. **Test pgTAP** — `supabase/tests/NN_<dominio>_test.sql`, corre con `supabase test db`: esquema (`has_table`/`has_index`/`col_is_fk`), RLS por rol (`set local role` + `set local request.jwt.claims`), grants (`table_privs_are`).
4. **Delta de tipos** — `packages/types/SPEC.md`, mapeo fijo: `snake_case`→`camelCase`, `timestamptz`→`string` (ISO-8601), `numeric(12,2)`→`number`, columna nullable→prop opcional `?`, enum PG→union type con miembros idénticos y en el mismo orden, `uuid`→`string`.
5. **Delta de spec** — este mismo archivo (`supabase/SPEC.md`), columnas reales del lote recién migrado.

Un PR de lote que rompa la regla "tabla sin RLS en el mismo commit" o que falte cualquiera de los 5 artefactos se rechaza en revisión. Fase 0 (scaffolding de CLI + pgTAP, ver `supabase/migrations/00000000000000_enable_pgtap.sql`) es prerrequisito de todos los lotes.

## Primitivas transversales (lote `00`)

Creadas una sola vez en `supabase/migrations/20260803120000_00_extensions_enums.sql` (+ rollback `supabase/rollback/00_extensions_enums_down.sql`, test `supabase/tests/00_extensions_enums_test.sql`). El resto de los lotes las **consumen**, nunca las redefinen. Este lote no trae tablas ni enums propios — ningún enum es cross-domain en las specs finalizadas, cada dominio trae el suyo dentro de su propio lote (design.md D-3, orden interno fijo).

| Primitiva | Tipo | Uso |
|---|---|---|
| Extensión `pgcrypto` | extension | Backing para defaults `gen_random_uuid()` en PKs `uuid` de todos los lotes posteriores |
| Extensión `pg_trgm` | extension | Índices GIN de trigram para búsqueda por texto (`catalog_products`, `provider_catalog`, lote `03`) |
| `public.set_updated_at()` | función `plpgsql`, trigger, `VOLATILE` | Se ata como `BEFORE UPDATE` en cada tabla con columna `updated_at`, una vez por tabla en cada lote posterior (design.md D-3). Una sola implementación para las 17 tablas — nunca se redefine por dominio. |
| `public.current_company_id()` | función `plpgsql stable security definer` | Devuelve el `company_id` del usuario que llama, vía `profiles`, sin re-evaluar el RLS de `profiles` desde dentro de otra política (design.md D-2). Consumida por las políticas RLS de tablas "company-owned" desde el lote `01a` en adelante. Referencia `public.profiles`, que no existe hasta el lote `01a`. **Corregido en PR 4**: originalmente declarada `language sql`, lo cual falla en `CREATE FUNCTION` contra una tabla inexistente (Postgres resuelve el cuerpo de una función `sql` de inmediato); `language plpgsql` difiere esa resolución a la primera invocación, que es lo que de verdad se necesita para referencias hacia adelante entre lotes. Verificado con `supabase db reset` real. |

## Tablas (a migrar en `migrations/`)

Orden sugerido de creación (respeta dependencias de foreign keys):

1. `companies`
2. `company_dispatch_zones` (FK a `companies`)
3. `profiles` (FK a `auth.users`; FK opcional a `companies`)
4. `admin_roles` (FK a `profiles`)
5. `pets` (FK a `profiles`)
6. `catalog_products`
7. `provider_catalog` (FK a `companies`)
8. `user_consumption` (FK a `profiles`, `pets`)
9. `consumption_logs` (FK a `user_consumption`)
10. `refill_requests` (FK a `profiles`)
11. `refill_items` (FK a `refill_requests`)
12. `offers` (FK a `refill_requests`, `companies`)
13. `offer_items` (FK a `offers`, `refill_items`)
14. `orders` (FK a `offers`)
15. `order_items` (FK a `orders`)
16. `payments` (FK a `orders`)
17. `audit_log` (FK a `profiles`)

## Columnas reales — lote `01a` (`identidad_core`)

Migrado en `supabase/migrations/20260803120100_01a_identidad_core.sql`. `admin_roles` queda fuera (lote `01b`, Phase 3).

### companies

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| razon_social | text | NOT NULL |
| rut | text | NOT NULL, UNIQUE |
| giro | text | NOT NULL |
| status | company_status | NOT NULL DEFAULT `'pendiente'` |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |

`company_status`: `'pendiente' | 'activo' | 'suspendido'`. Sin columna `rating` (fuera de alcance, ver proposal).

### company_dispatch_zones

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| company_id | uuid | NOT NULL REFERENCES `companies(id)` |
| comuna | text | NOT NULL |
| region | text | NOT NULL |
| — | — | UNIQUE(`company_id`, `comuna`) |

Sin `created_at`/`updated_at` (no aplica: fila inmutable, se reemplaza por completo si cambia la zona).

### profiles (columnas físicas de este lote)

`id` uuid PK REFERENCES `auth.users(id)` ON DELETE RESTRICT (design.md D-1); `company_id` uuid NULL REFERENCES `companies(id)` (solo cuando `role = 'provider'`, invariante enforceado en core-api, no vía CHECK); `created_at`/`updated_at` timestamptz NOT NULL DEFAULT `now()`. El resto de columnas (`role`, `status`, `nombre`, `email`, `telefono`) ya estaban fijadas por `packages/types/SPEC.md`.

## Columnas reales — lote `01b` (`identidad_admin`)

Migrado en `supabase/migrations/20260803120110_01b_identidad_admin.sql`.

### admin_roles

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| profile_id | uuid | NOT NULL, UNIQUE, REFERENCES `profiles(id)` |
| rol | admin_role | NOT NULL |
| granted_by | uuid | NOT NULL REFERENCES `profiles(id)` |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |

`admin_role`: `'super_admin' | 'soporte' | 'finanzas'`. UNIQUE(`profile_id`): un sub-rol por admin, re-asignar reemplaza la fila. `granted_by = profile_id` es válido únicamente en la fila del bootstrap manual (ver "Bootstrap de administrador" más abajo) — documentado con `comment on column` en la migración, no enforceado por CHECK.

### v_auth_orphans (vista, design.md D-1)

Detecta filas `auth.users` sin `profiles` correspondiente, más viejas que 15 minutos. `service_role`-only (`revoke all ... grant select ... to service_role`) — superficie de detección para el flujo de compensación Auth↔profiles documentado en `services/core-api/domains/identidad/SPEC.md`. El job de reconciliación que la consume se entrega en el cambio de Edge Functions, no en este.

## Columnas reales — lote `02` (`consumo`)

Migrado en `supabase/migrations/20260803120200_02_consumo.sql`.

### pets

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| user_id | uuid | NOT NULL REFERENCES `profiles(id)` (physical-only, no está en `Pet` de `packages/types/SPEC.md`) |
| nombre | text | NOT NULL |
| especie | text | NOT NULL |
| raza | text | NULL |
| peso_kg | numeric | NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |

### user_consumption

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| user_id | uuid | NOT NULL REFERENCES `profiles(id)` (physical-only; dueño real incluso cuando `owner_type = 'pet'`) |
| owner_type | owner_type | NOT NULL |
| pet_id | uuid | NULL REFERENCES `pets(id)` (solo cuando `owner_type = 'pet'`, enforceado en core-api, no CHECK) |
| kind | consumption_kind | NOT NULL |
| nombre | text | NOT NULL |
| dosis_por_toma | numeric | NOT NULL |
| unidad | text | NULL |
| frecuencia_dias | integer | NOT NULL |
| horarios | text[] | NOT NULL |
| stock_actual | numeric | NOT NULL |
| auto_crear_refill | boolean | NOT NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |

`owner_type`: `'self' \| 'pet'`. `consumption_kind`: `'medicamento' \| 'alimento' \| 'vacuna' \| 'suplemento'`.

### consumption_logs

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| consumption_id | uuid | NOT NULL REFERENCES `user_consumption(id)` |
| tomado_at | timestamptz | NOT NULL |
| cantidad | numeric | NULL |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX `(consumption_id, tomado_at DESC)` — adherencia (`adherenciaUltimos7Dias`, `calcularDiasRestantes`) |

Owner-less by design (Q8, `db-schema-consumo`): sin columna de dueño propia. SELECT vía `EXISTS` contra `user_consumption.user_id` — mismo patrón único que `refill_items`/`offer_items`/`order_items` (`db-access-control`, "Owner-less child table read policy").

## Columnas reales — lote `03` (`catalogo`)

Migrado en `supabase/migrations/20260803120300_03_catalogo.sql`.

### catalog_products

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| nombre | text | NOT NULL |
| categoria | text | NOT NULL |
| marca | text | NULL |
| presentacion | text | NULL |
| imagen_url | text | NULL |
| status | catalog_product_status | NOT NULL DEFAULT `'activo'` |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | GIN trigram (`nombre`), GIN trigram (`categoria`) |

`catalog_product_status`: `'activo' | 'inactivo'` (soft-delete only, la política SELECT no filtra por status).

### provider_catalog

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| company_id | uuid | NOT NULL REFERENCES `companies(id)` |
| catalog_product_id | uuid | NULL REFERENCES `catalog_products(id)` — nullable por diseño (Q4) |
| nombre | text | NOT NULL (fallback denormalizado para matching) |
| categoria | text | NOT NULL (fallback denormalizado) |
| precio_base | numeric(12,2) | NOT NULL, CHECK (`precio_base >= 0`) |
| precio_maximo | numeric(12,2) | NOT NULL, CHECK (`precio_maximo >= precio_base`) |
| stock | integer | NOT NULL DEFAULT 0, CHECK (`stock >= 0`) |
| disponible | boolean | NOT NULL DEFAULT `true` |
| imagen_url | text | NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(`company_id`); GIN trigram (`nombre`), GIN trigram (`categoria`) |

**Q6 — `catalog_products` es authenticated-only, sin política/grant `anon`**: acceso público sin sesión permitiría a scrapers extraer el catálogo de referencia completo. Ambas políticas de `provider_catalog` (público y dueño) también son `to authenticated` — tampoco hay lectura pública sin sesión para el marketplace view en este lote.

Ninguna de las dos tablas tiene grant de `insert`/`update`/`delete` para el cliente: las mutaciones (`cargarProductoCatalogo`, etc.) van por core-api con service-role, mismo patrón que `companies`/`profiles` (lote `01a`) y `pets`/`user_consumption` (lote `02`).

## Columnas reales — lote `04` (`refill_matching`)

Migrado en `supabase/migrations/20260803120400_04_refill_matching.sql`.

### refill_requests

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| user_id | uuid | NOT NULL REFERENCES `profiles(id)` (physical-only, dueño) |
| direccion | text | NOT NULL |
| comuna | text | NOT NULL — clave de join estructurada (Q2), separada de `direccion` |
| urgencia | refill_urgencia | NOT NULL |
| estado | refill_estado | NOT NULL DEFAULT `'abierta'` |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(`user_id`) |

`refill_urgencia`: `'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias'`. `refill_estado`: `'abierta' | 'ofertada' | 'confirmada'`.

### refill_items

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| refill_request_id | uuid | NOT NULL REFERENCES `refill_requests(id)` |
| catalog_product_id | uuid | NULL REFERENCES `catalog_products(id)` — nullable por diseño (Q4, misma filosofía que `provider_catalog.catalog_product_id`, lote `03`) |
| nombre | text | NOT NULL |
| categoria | text | NOT NULL |
| precio_referencia | numeric(12,2) | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(`refill_request_id`) |

Sin `updated_at` (inmutable una vez creada, mismo patrón que `consumption_logs`/`order_items`). Owner-less by design (Q8, `db-access-control`): sin columna de dueño propia. SELECT vía `EXISTS` contra `refill_requests.user_id`.

**Q2 — corrección de la prosa "zona de despacho"**: la fila de RLS más abajo para `refill_requests`/`refill_items` decía "visibles (solo lectura) para proveedores cuyo catálogo coincide y están en zona de despacho" — esto es RLS-inexpresable sin un predicado cross-tenant auto-derrotante (D1). El matching por `comuna`/categoría es responsabilidad de core-api (`buscarProveedoresCompatibles`, service-role) y de la futura Edge Function `match-refill-request` (fuera de alcance de este cambio, ver `proposal.md` "Out of Scope"), nunca de una política RLS. La política real implementada es **owner-only**: `user_id = auth.uid()` en `refill_requests`; `EXISTS` contra `refill_requests.user_id` en `refill_items`. Ningún proveedor puede leer `refill_requests` directamente, ni siquiera el que tiene un ítem de catálogo compatible.

## Columnas reales — lote `05` (`ofertas`)

Migrado en `supabase/migrations/20260803120500_05_ofertas.sql`.

### offers

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| user_id | uuid | NOT NULL REFERENCES `profiles(id)` — destinatario, physical-only, denormalizado a propósito (D-2): es la única columna de la que depende la visibilidad de una oferta proactiva, que no tiene `refill_request` |
| refill_request_id | uuid | NULL REFERENCES `refill_requests(id)` — presente solo cuando `kind = 'reactiva'` |
| company_id | uuid | NOT NULL REFERENCES `companies(id)` |
| kind | offer_kind | NOT NULL — enum no listado explícitamente en tasks.md 7.1 (que solo nombra `offer_status`), agregado aquí porque `Offer.kind` es una columna fija del tipo (`packages/types/SPEC.md`) y sigue la misma convención enum↔union-type que el resto de columnas de este cambio |
| status | offer_status | NOT NULL DEFAULT `'pendiente'` |
| tiempo_entrega_horas | integer | NOT NULL |
| costo_despacho | numeric(12,2) | NOT NULL |
| total | numeric(12,2) | NOT NULL |
| mensaje | text | NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | ÍNDICE ÚNICO PARCIAL `(refill_request_id) WHERE status = 'aceptada' AND refill_request_id IS NOT NULL` — a lo sumo una oferta `aceptada` por solicitud |
| — | — | INDEX(`user_id`), INDEX(`company_id`), INDEX(`refill_request_id`) |

`offer_kind`: `'reactiva' | 'proactiva'`. `offer_status`: `'pendiente' | 'aceptada' | 'rechazada' | 'expirada'`.

### offer_items

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` — physical-only, no está en `OfferItem` de `packages/types/SPEC.md` (mismo patrón de columna de infra no expuesta al dominio que otras tablas de este cambio) |
| offer_id | uuid | NOT NULL REFERENCES `offers(id)` |
| refill_item_id | uuid | NULL REFERENCES `refill_items(id)` — presente solo si la offer padre es `kind = 'reactiva'` |
| provider_catalog_item_id | uuid | NULL REFERENCES `provider_catalog(id)` — presente solo si la offer padre es `kind = 'proactiva'` |
| — | — | CHECK `(refill_item_id IS NOT NULL) <> (provider_catalog_item_id IS NOT NULL)` — exactamente uno, nunca ambos ni ninguno |
| is_alt | boolean | NOT NULL DEFAULT `false` |
| alt_size | numeric | NULL |
| alt_qty | numeric | NULL |
| alt_note | text | NULL |
| precio | numeric(12,2) | NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(`offer_id`) |

Sin `updated_at` (inmutable una vez creada, mismo patrón que `refill_items`/`consumption_logs`). Owner-less by design (Q8, `db-access-control`): sin columna de dueño propia. SELECT vía `EXISTS` contra `offers.user_id` — mismo patrón uniforme, sin lógica bespoke; en este lote el proveedor NO lee `offer_items` directamente vía RLS (solo vía core-api con service-role).

**Gap cerrado en `sdd-spec`, no presente en propose/design**: `OfferItem.refillItemId` era `NOT NULL` en el tipo original — hacía a los ítems de `enviarOfertaProactiva` no representables (una oferta proactiva no tiene `refill_request`, por lo tanto no tiene `refill_items` que referenciar). Resuelto con la FK dual-nullable + CHECK de arriba.

### Realtime (D-4)

Solo `offers` está en la publicación `supabase_realtime` (`alter publication supabase_realtime add table public.offers;`), `REPLICA IDENTITY DEFAULT` (sin tocar). `offer_items` NO se publica — el cliente invalida su query de bandeja al recibir el evento y vuelve a pedir el detalle completo (incl. items) por REST, nunca usa el payload del evento como dato. `grant select on public.offers to authenticated` es un prerequisito duro: sin ese grant, Realtime no entrega eventos a nadie sin importar cuántas políticas existan.

**Smoke test manual (D-4, no automatizable con pgTAP)** — pendiente de ejecutar contra un ambiente real antes de considerar Realtime verificado end-to-end (`supabase test db` no puede probar WAL/websocket):

1. Sesión 1 (destinatario): cliente autenticado como el usuario dueño de una `offer`, suscrito a `postgres_changes` sobre `public.offers` filtrado por su propio `user_id`.
2. Sesión 2 (no-dueño): otro cliente autenticado, suscrito al mismo canal sin filtro de propiedad.
3. `core-api` (service-role) inserta una `offer` nueva para el destinatario de la sesión 1.
4. Verificar: sesión 1 recibe el evento `INSERT`; sesión 2 no recibe nada (la política SELECT de Realtime lo descarta en silencio, no es un error visible).
5. Repetir el mismo flujo con una oferta **proactiva** (`refill_request_id = NULL`) — debe comportarse igual: el destinatario la recibe vía el compare directo de `user_id`, no vía `refill_requests`.

## Columnas reales — lote `06` (`pedidos_pagos`)

Migrado en `supabase/migrations/20260803120600_06_pedidos_pagos.sql`.

### orders

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| offer_id | uuid | NOT NULL REFERENCES `offers(id)` |
| user_id | uuid | NOT NULL REFERENCES `profiles(id)` — dueño |
| company_id | uuid | NOT NULL REFERENCES `companies(id)` |
| status | order_status | NOT NULL DEFAULT `'confirmado'` |
| total | numeric(12,2) | NOT NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(`user_id`), INDEX(`company_id`), INDEX(`offer_id`) |

`order_status`: `'confirmado' | 'preparando' | 'en_camino' | 'entregado'`.

### order_items — snapshot inmutable (D-6)

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| order_id | uuid | NOT NULL REFERENCES `orders(id)` |
| offer_item_id | uuid | NOT NULL REFERENCES `offer_items(id)` — **solo procedencia, nunca fuente de lectura de precio/descripcion** |
| nombre | text | NOT NULL — copiado por valor desde `offer_items` al crear el pedido |
| cantidad | numeric | NOT NULL, CHECK `> 0` |
| precio_unitario | numeric(12,2) | NOT NULL, CHECK `>= 0` |
| subtotal | numeric(12,2) | NOT NULL, CHECK `>= 0` — columna plana, no `GENERATED ALWAYS`, para permitir descuentos/redondeos pactados |
| is_alt / alt_size / alt_qty / alt_note | — | copiados igual que el resto, forman parte de lo que el usuario aceptó comprar |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(`order_id`) |

Sin `updated_at`, sin columna de dueño (Q8). **Inmutable por grants, no por RLS**: `revoke update, delete on public.order_items from anon, authenticated, service_role` — `service_role` tiene `BYPASSRLS`, así que solo la ausencia del privilegio detiene un `UPDATE`, incluso desde `core-api`. Verificado con `supabase test db` (throws `42501` para `authenticated` y para `service_role`).

### payments

| Columna | Tipo | Constraint |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| order_id | uuid | NOT NULL UNIQUE REFERENCES `orders(id)` |
| gateway | text | NOT NULL, CHECK IN (`'webpay'`, `'mercadopago'`) — CHECK, no enum, para que sumar un gateway sea una migración de una línea |
| external_transaction_id | text | NOT NULL |
| monto | numeric(12,2) | NOT NULL, CHECK `> 0` |
| moneda | text | NOT NULL DEFAULT `'CLP'` |
| estado | payment_status | NOT NULL DEFAULT `'pendiente'` |
| raw_payload | jsonb | NOT NULL DEFAULT `'{}'::jsonb` — interno, nunca expuesto en `packages/types/SPEC.md` |
| paid_at | timestamptz | NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |

`payment_status`: `'pendiente' | 'pagado' | 'fallido' | 'reembolsado'`. **Sin ninguna columna capaz de guardar PAN/CVV/vencimiento** (PCI scope avoidance). **Cero SELECT de cliente**: ni owner ni company tienen grant ni política — `revoke all` sin `grant select` para `anon`/`authenticated`, y cero políticas RLS. El estado del pago se lee vía core-api, nunca directo.

## Bootstrap de administrador

Runbook completo en `openspec/changes/backend-supabase-migrations/design.md` D-5 (no se duplica aquí). Dos archivos, propósitos distintos:

- `supabase/seed.sql` — solo dev local, lo corre `supabase db reset`.
- `supabase/seed/00_bootstrap_super_admin.sql` — staging/producción, manual, parametrizado, con el runbook de 6 pasos en su propio encabezado.

## Row Level Security — reglas por tabla

| Tabla | Regla |
|---|---|
| `companies` | (lote `01a`, migrado) `authenticated` ve `status = 'activo'` (directorio público), más su propia empresa en cualquier status vía `EXISTS` sobre `profiles.company_id` |
| `company_dispatch_zones` | (lote `01a`, migrado) Hereda la visibilidad de su `companies` padre — mismo predicado activo-o-dueño, evaluado contra la fila padre |
| `profiles` | (lote `01a`, migrado) **Conflicto con la prosa original de esta fila, no sobrescrita en silencio**: la regla real implementada es solo lectura de la propia fila (`id = auth.uid()`), **sin** política UPDATE. "...y edita..." queda superseded por design.md D-1 — mutaciones como `suspenderUsuario` van por core-api con service-role, nunca UPDATE directo del cliente. Ver `db-schema-identidad` Requirement "profiles has no client-side mutation policy" |
| `pets`, `user_consumption` | (lote `02`, migrado) `authenticated` ve solo filas propias, `user_id = auth.uid()` — ni siquiera proveedores tienen acceso |
| `consumption_logs` | (lote `02`, migrado) Sin columna de dueño propia (Q8) — SELECT vía `EXISTS` contra `user_consumption.user_id`, mismo patrón único que `refill_items`/`offer_items`/`order_items` (`db-access-control`) |
| `refill_requests`, `refill_items` | (lote `04`, migrado) **Conflicto con la prosa original de esta fila, no sobrescrita en silencio**: la regla real implementada es owner-only, `user_id = auth.uid()` en `refill_requests` y `EXISTS` contra `refill_requests.user_id` en `refill_items` — **ningún** proveedor puede leerlas directamente. "...visibles (solo lectura) para proveedores cuyo catálogo coincide..." queda superseded por Q2/D1: el matching cross-tenant es RLS-inexpresable sin un predicado auto-derrotante, va por core-api (`buscarProveedoresCompatibles`, service-role) y la futura Edge Function `match-refill-request` (fuera de alcance de este cambio). Ver "Columnas reales — lote `04`" más abajo y `db-schema-refill-matching` Requirement "refill_requests SELECT is owner-only" |
| `catalog_products` | (lote `03`, migrado) `authenticated` ve todas las filas sin filtro de status (Q6) — **sin** política ni grant `anon`, para no exponer el catálogo de referencia a scrapers sin sesión |
| `provider_catalog` | (lote `03`, migrado) **Conflicto con la prosa original de esta fila, no sobrescrita en silencio**: la regla real implementada es solo lectura, dos políticas `authenticated` — pública (`disponible = true`) y dueño (`EXISTS` sobre `profiles.company_id`, ve todo incl. `disponible = false`). No hay política de escritura para el cliente; `cargarProductoCatalogo` va por core-api con service-role, igual que `companies`/`profiles` |
| `offers`, `offer_items` | (lote `05`, migrado) **Conflicto con la prosa original de esta fila, no sobrescrita en silencio**: no hay política de escritura para el cliente — `enviarOferta`/`enviarOfertaProactiva`/`aceptarOferta` van por core-api con service-role, igual que el resto del cambio. `offers` tiene dos políticas SELECT `authenticated`: destinatario (`user_id = auth.uid()`, comparación directa — no `EXISTS` contra `refill_requests`, es lo que hace visibles a las ofertas proactivas sin solicitud) y proveedor (`EXISTS` sobre `profiles.company_id`, mismo patrón literal que `companies`/`provider_catalog`). `offer_items` usa el patrón `EXISTS`-contra-el-padre uniforme (Q8) sobre `offers.user_id` únicamente — el proveedor no tiene lectura directa de `offer_items` en este lote. Ver "Columnas reales — lote `05`" más abajo y `db-schema-ofertas` Requirement "SELECT allowlist for offers is required for Realtime to deliver anything" |
| `orders`, `order_items` | (lote `06`, migrado) `orders` tiene dos políticas SELECT `authenticated`: dueño (`user_id = auth.uid()`) y empresa (`EXISTS` sobre `profiles.company_id`, mismo patrón literal que `companies`/`offers`). `order_items` usa el patrón `EXISTS`-contra-el-padre (Q8) sobre `orders.user_id` únicamente — el proveedor no lee `order_items` directo, mismo carve-out que `offer_items` en lote `05`. `order_items` además es inmutable por grants (`revoke update, delete` incl. `service_role`, D-6) |
| `payments` | (lote `06`, migrado) **Conflicto con la prosa original de esta fila, no sobrescrita en silencio**: la regla real implementada es **cero acceso de cliente**, ni owner ni company — sin grant `select`, sin política. El estado del pago se lee vía core-api. Ver "Columnas reales — lote `06`" más abajo y `db-schema-pedidos-pagos` Requirement "payments has no direct client SELECT policy" |
| `admin_roles` | (lote `01b`, migrado) Cero acceso de cliente — RLS habilitado + `revoke all` + cero políticas para `anon`/`authenticated` (los dos mecanismos de design.md D-2). Solo alcanzable vía `service role key` desde `admin-web`/core-api. Ver "Bootstrap de administrador" más arriba para cómo se crea la primera fila |
| `audit_log` | (pendiente, lote `07`) Sin acceso desde clave pública — solo alcanzable vía `service role key` desde `admin-web` |

**Nota:** ninguna tabla admite `DELETE` desde el cliente. Todas las bajas son un `UPDATE` de `status`.

## Edge Functions

| Función | Dispara | Hace |
|---|---|---|
| `match-refill-request` | Al crear una `refill_request` | Busca `provider_catalog` compatible por categoría + zona, genera ofertas automáticas para proveedores con auto-oferta activada |
| `check-consumption-stock` | Cron diario (`pg_cron`) | Recalcula días de stock restante por `user_consumption`, dispara notificación si está bajo, o genera `refill_request` automática si el usuario lo activó |
| `find-proactive-opportunities` | Cron diario | Detecta usuarios próximos a refill (por `user_consumption`) y las expone a proveedores en su sección de "solicitudes proactivas" |
| `payment-webhook` | Callback de Webpay/MercadoPago | Verifica el pago, crea el `order` a partir de la `offer` aceptada, notifica al proveedor |

## Checklist antes de escribir la primera migración real

- [ ] Confirmar nombres finales de columnas contra `packages/types/SPEC.md`
- [ ] Definir índices sobre `refill_requests.userId`, `offers.refillRequestId`, `provider_catalog.companyId` (consultas más frecuentes)
- [ ] Escribir las políticas RLS como parte de la misma migración que crea la tabla, no después
