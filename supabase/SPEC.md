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
| `public.current_company_id()` | función `sql stable security definer` | Devuelve el `company_id` del usuario que llama, vía `profiles`, sin re-evaluar el RLS de `profiles` desde dentro de otra política (design.md D-2). Consumida por las políticas RLS de tablas "company-owned" desde el lote `01a` en adelante. Referencia `public.profiles`, que no existe hasta el lote `01a` — válido porque el cuerpo de una función `language sql` no se valida contra el catálogo en `CREATE FUNCTION`, solo en la primera invocación (a diferencia de `CREATE POLICY`, que sí exige que las tablas referenciadas ya existan). |

## Tablas (a migrar en `migrations/`)

Orden sugerido de creación (respeta dependencias de foreign keys):

1. `companies`
2. `profiles` (FK opcional a `companies`)
3. `admin_roles` (FK a `profiles`)
4. `pets` (FK a `profiles`)
5. `catalog_products`
6. `provider_catalog` (FK a `companies`)
7. `user_consumption` (FK a `profiles`, `pets`)
8. `consumption_logs` (FK a `user_consumption`)
9. `refill_requests` (FK a `profiles`)
10. `refill_items` (FK a `refill_requests`)
11. `offers` (FK a `refill_requests`, `companies`)
12. `offer_items` (FK a `offers`, `refill_items`)
13. `orders` (FK a `offers`)
14. `order_items` (FK a `orders`)
15. `payments` (FK a `orders`)
16. `audit_log` (FK a `profiles`)

## Row Level Security — reglas por tabla

| Tabla | Regla |
|---|---|
| `profiles` | Cada usuario ve y edita solo su propia fila |
| `pets`, `user_consumption`, `consumption_logs` | Visibles solo para el `userId` dueño |
| `refill_requests`, `refill_items` | Visibles para el usuario dueño; visibles (solo lectura) para proveedores cuyo catálogo coincide y están en zona de despacho |
| `provider_catalog` | Editable solo por `profiles` con `companyId` correspondiente |
| `offers`, `offer_items` | El proveedor solo puede crear/editar sus propias ofertas; el usuario solo puede leer las ofertas dirigidas a sus solicitudes |
| `orders`, `payments` | Visibles solo para el usuario y el proveedor involucrados en ese pedido |
| `admin_roles`, `audit_log` | Sin acceso desde clave pública — solo alcanzables vía `service role key` desde `admin-web` |

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
