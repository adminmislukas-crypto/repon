# Design: Backend Supabase — migraciones reales, RLS, Storage y Auth

Cierra los 6 mecanismos que `proposal.md` difirió explícitamente a `sdd-design`. No re-abre D1/D2/D3 ni define columnas (eso es `sdd-spec`); define **cómo** se implementan, una sola vez, para que los 9 lotes de migración usen la misma pieza y no nueve variantes.

Diagramas en ASCII: es la convención existente del repo (`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`); no hay mermaid en ninguna parte.

---

## D-1 · Atomicidad Auth ↔ `profiles` (R5)

**Choice**: Auth-first + compensación in-request + FK `ON DELETE RESTRICT` + vista de detección de huérfanos. El job de reconciliación **no se ejecuta** en este cambio: se entrega la superficie de detección, el ejecutor va con las Edge Functions.

**Alternatives considered**:

| Opción | Por qué se descarta |
|---|---|
| Trigger `on auth.users insert` → crea `profiles` | Mete lógica de negocio en la DB; contradice `docs/ARCHITECTURE.md` ("Supabase = infraestructura pura") y el puerto `AuthProvider` de `identidad/SPEC.md`, que declara que el dominio orquesta. Además `nombre`/`role`/`companyId` no viajan confiablemente en el metadata de Auth |
| `profiles` primero, Auth después | Imposible: `profiles.id` es FK a `auth.users.id` |
| Fila `profiles` en estado `'pendiente'` (two-phase commit) | Agrega un estado de ciclo de vida que ningún caso de uso de dominio expresa, y `ProfileStatus` ya está cerrado en `packages/types/SPEC.md` (D2) |

**Rationale**: la única direccionalidad posible es Auth→profiles, así que el fallo compensable es siempre el mismo (Auth creado, `profiles` no). `ON DELETE RESTRICT` en la FK convierte la compensación en segura por construcción: el borrado del usuario de Auth **solo puede tener éxito cuando no existe fila `profiles`**, que es exactamente el caso que se está compensando. Si alguien intenta borrar un Auth user con perfil (y por tanto con historial de pedidos), Postgres lo rechaza. `CASCADE` haría lo contrario y violaría el "principio de dar de baja".

**Flujo**

```
 core-api / identidad        Supabase Auth            Postgres (service-role)
  registrarUsuario()          auth.users                 public.profiles
        |                         |                            |
   (1)  |---- createAccount ----->|                            |
        |                         |                            |
        |<---- uid ---------------|  OK                        |
        |                         |                            |
   (2)  |---- INSERT profiles (id=uid) ON CONFLICT (id) DO NOTHING ---->|
        |<-------------------------- OK ---------------------------- --|
   (3)  |--- publish UsuarioRegistrado                                  ==> DONE
        |
        |
   ==== FALLO A: (2) falla (constraint, red, timeout de DB) ============
        |
   (A1) |---- auth.admin.deleteUser(uid) -->|   RESTRICT no bloquea:
        |                                   |   no hay fila profiles
        |<--- OK ---------------------------|
   (A2) |--- return RegistroFallido (el email queda libre)     ==> ROLLED BACK
        |
   (A3) si (A1) falla ---> log + alerta; el uid queda como HUERFANO
        |                  y lo detecta la vista de reconciliacion
        |
   ==== FALLO B: (1) responde error AMBIGUO (timeout / 5xx) ===========
        |
   (B1) |---- getUserByEmail(email) ------->|
        |<--- no existe --------------------|  ==> fallo limpio, reintentable
        |<--- existe (uid) -----------------|  ==> RECUPERACION HACIA ADELANTE:
        |                                        volver a (2) con ese uid.
        |                                        NUNCA compensar aqui: el
        |                                        usuario pudo quedar valido.
```

**Reglas no negociables del adaptador**
1. El insert de `profiles` es idempotente: `ON CONFLICT (id) DO NOTHING` + relectura. Un reintento tras un timeout de DB nunca debe fallar por duplicado.
2. La compensación solo se dispara ante fallo **determinista** del paso (2). Ante fallo ambiguo del paso (1) → recuperación hacia adelante (B1), nunca borrado.
3. `deleteUser` es la **única** eliminación física permitida en el sistema, y solo dentro de la ventana de la request.

**Reconciliación de huérfanos** — se entrega en el lote `01_identidad`:

```sql
create view public.v_auth_orphans as
  select u.id, u.email, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
    and u.created_at < now() - interval '15 minutes';  -- ventana de gracia: no pisar registros en vuelo

revoke all on public.v_auth_orphans from anon, authenticated;
grant select on public.v_auth_orphans to service_role;
```

Política del job (a implementar en el cambio de Edge Functions): **detectar y alertar, nunca auto-borrar**. Un huérfano de >15 min es estado histórico ambiguo; borrarlo es irreversible y cae en el casillero "si algo se borra físicamente, no hay rollback" del rollback plan. La compensación in-request sí borra porque conoce el contexto completo con segundos de antigüedad; el job no.

---

## D-2 · Patrón único de RLS para tablas hijas (Q8, R4)

**Choice**: `EXISTS` de **un solo salto** contra el padre, con `(select auth.uid())` envuelto en subselect. **Una única denormalización**: `offers.user_id`.

**Hallazgo que fuerza la denormalización** (conflicto con lo asumido en la proposal — se declara, no se resuelve en silencio): `enviarOfertaProactiva(companyId, userId, ...)` crea una oferta **sin `refill_request`**. Con `refill_request_id` nullable, un predicado `EXISTS → refill_requests.user_id` **niega todas las ofertas proactivas** al usuario destinatario. `offers` necesita `user_id NOT NULL` (el destinatario) por razones de dominio, independientemente de RLS.

Efecto colateral valioso: con `offers.user_id`, las 4 tablas hijas quedan a **exactamente un salto**, y no hace falta ninguna función `SECURITY DEFINER` ni `EXISTS` anidado.

| Tabla hija | Padre | Columna dueño | Saltos |
|---|---|---|---|
| `consumption_logs` | `user_consumption` | `user_id` | 1 |
| `refill_items` | `refill_requests` | `user_id` | 1 |
| `offer_items` | `offers` | `user_id` *(denormalizado)* | 1 |
| `order_items` | `orders` | `user_id` | 1 |

**Plantilla canónica** (copiar literal, cambiar solo los 4 identificadores):

```sql
-- PLANTILLA HIJA-POR-DUEÑO — no inventar variantes
create policy "<hija>_authenticated_select_own"
  on public.<hija>
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.<padre> p
      where p.id = <hija>.<fk_padre>
        and p.user_id = (select auth.uid())
    )
  );
```

**Primitivas creadas una sola vez en el lote `00`:**

```sql
-- Empresa del llamador. SECURITY DEFINER para no evaluar el RLS de profiles
-- dentro del RLS de otra tabla (costo + riesgo de recursión).
create function public.current_company_id() returns uuid
  language sql stable security definer set search_path = ''
as $$ select company_id from public.profiles where id = (select auth.uid()) $$;
```

**Postura deny-all — dos mecanismos, no uno:**

```sql
alter table public.<t> enable row level security;   -- sin políticas => 0 filas
revoke all on public.<t> from anon, authenticated;  -- corta los grants por defecto de Supabase
-- y SOLO si está en la allowlist de lectura:
grant select on public.<t> to authenticated;
```

Habilitar RLS sin revocar grants no es deny-all completo: Supabase concede privilegios por defecto a `anon`/`authenticated` en `public`. Ambos pasos, siempre.

**Append-only (`audit_log`, `order_items`) se enforcea por GRANTS, no por RLS**: `service_role` tiene `BYPASSRLS`, así que ninguna política lo detiene. Lo que sí lo detiene es la ausencia del privilegio:

```sql
revoke update, delete on public.audit_log from anon, authenticated, service_role;
```

**Nomenclatura de políticas**: `<tabla>_<rol>_<accion>[_<calificador>]` — p.ej. `offers_authenticated_select_recipient`. Sin excepciones.

**Rationale**: la denormalización de `user_id` se paga con un invariante a mantener (cuando hay `refill_request_id`, `offers.user_id` debe coincidir con `refill_requests.user_id`) — se enforcea en el caso de uso de `ofertas` en core-api, no en la DB. Se acepta porque el read path lo exige de verdad: Realtime evalúa el predicado por evento y por suscriptor, y un compare de columna plana es lo más barato posible. Es el único caso donde el read path justifica denormalizar; en las otras tres, `EXISTS` con la FK indexada resuelve por índice.

---

## D-3 · Mecánica de los lotes de migración

**Choice**: timestamps **pre-asignados** con ventana de 100 s por lote, estructura interna fija de 8 secciones, `down` en `supabase/rollback/` (fuera de `migrations/`), sync de tipos en el mismo commit.

```
supabase/
├── migrations/
│   ├── 20260803120000_00_extensions_enums.sql
│   ├── 20260803120100_01_identidad.sql
│   ├── 20260803120200_02_consumo.sql
│   ├── 20260803120300_03_catalogo.sql
│   ├── 20260803120400_04_refill_matching.sql
│   ├── 20260803120500_05_ofertas.sql
│   ├── 20260803120600_06_pedidos_pagos.sql
│   ├── 20260803120700_07_auditoria.sql
│   └── 20260803120800_08_storage.sql
├── rollback/   NN_<dominio>_down.sql   (manual, el CLI no lo lee)
├── seed.sql    (solo dev local, lo corre `supabase db reset`)
├── seed/00_bootstrap_super_admin.sql   (manual, staging/prod)
└── tests/      NN_<dominio>_test.sql   (pgTAP, `supabase test db`)
```

**Por qué timestamps pre-asignados**: los 9 lotes son PRs encadenados. Si cada PR corre `supabase migration new` al momento de escribirse, el PR #5 autorado antes de que mergee el #3 obtiene un timestamp menor y el orden de aplicación se rompe silenciosamente contra el orden de FKs. El orden ya está decidido (D3) → se congela ahora. La ventana de 100 s deja espacio para sub-slicear un lote sin renumerar nada: si `identidad` excede el presupuesto de 400 líneas (riesgo declarado), se parte en `20260803120100_01a_identidad_companies.sql` y `20260803120110_01b_identidad_profiles.sql`.

**Estructura interna fija de cada archivo** — mismo orden siempre, para que el diff sea comparable entre lotes:

```
1. enums          2. tablas         3. constraints/FK diferidas    4. índices
5. trigger updated_at  6. grants (revoke-all → grant estrecho)
7. RLS: enable + políticas    8. realtime/publication (solo donde aplica)
```

El paso 7 va **en el mismo archivo** que el paso 2. Una tabla nunca existe en un commit sin su RLS: el árbol de git nunca contiene un estado con tablas abiertas.

`public.set_updated_at()` se crea una vez en el lote `00` y se ata por tabla en cada lote. Una implementación.

**Sync de `packages/types/SPEC.md` por lote** — reglas de mapeo fijas:

| Postgres | TypeScript |
|---|---|
| `snake_case` | `camelCase` |
| `timestamptz` | `string` (ISO-8601) |
| `numeric(12,2)` | `number` |
| columna nullable | prop opcional `?` |
| enum PG | union type con miembros idénticos y en el mismo orden |
| `uuid` | `string` |

Definition of done de cada PR de lote (checklist, no CI — el repo no tiene tooling y no se va a inventar una compuerta que no existe): migración + rollback + test pgTAP + delta en `packages/types/SPEC.md` + delta en `supabase/SPEC.md`, todo en el mismo commit. `sdd-tasks` debe materializar esto como sub-tareas explícitas por lote, no como una tarea "sincronizar tipos" al final.

---

## D-4 · Realtime sobre `offers`

**Choice**: publicar **solo `offers`**, `REPLICA IDENTITY DEFAULT`, y tratar el evento como **señal de invalidación**, no como transporte de datos.

```sql
alter publication supabase_realtime add table public.offers;
-- offer_items NO se publica. REPLICA IDENTITY se deja en DEFAULT (solo PK en old_record).

grant select on public.offers to authenticated;   -- SIN esto, Realtime no entrega NADA

create policy "offers_authenticated_select_recipient"
  on public.offers for select to authenticated
  using (user_id = (select auth.uid()));

create policy "offers_authenticated_select_provider"
  on public.offers for select to authenticated
  using (company_id = (select public.current_company_id()));
```

```
 proveedor-mobile      core-api          Postgres            Realtime         usuario-mobile
                       (ofertas)         public.offers                        (bandeja)
       |                   |                  |                  |                  |
       |                   |                  |    (0) subscribe channel + setAuth(jwt)
       |                   |                  |<---------------------------------- |
       |                   |                  |                  |                  |
       |-- enviarOferta -->|                  |                  |                  |
       |                   |-- INSERT ------->|                  |                  |
       |                   |  (service-role,  |                  |                  |
       |                   |   bypassa RLS)   |-- WAL ---------->|                  |
       |                   |                  |                  |                  |
       |                   |                  |    (1) Realtime evalua la politica SELECT
       |                   |                  |        de offers con el JWT del suscriptor
       |                   |                  |                  |                  |
       |                   |                  |     user_id = auth.uid() ?           |
       |                   |                  |        SI --> (2) INSERT event ----->|
       |                   |                  |        NO --> descartado en silencio |
       |                   |                  |                  |                  |
       |                   |                  |    (3) el cliente NO usa el payload como dato:
       |                   |                  |        invalidateQueries(['offers', userId])
       |                   |<---------------- GET /offers (con items) ------------- |
       |                   |-- SELECT offers + offer_items ------------------------>|
```

**Rationale**:
- *Solo `offers`*: publicar `offer_items` entregaría N eventos por oferta, sin garantía de orden respecto al padre, y una oferta sin ítems no se puede renderizar. Además evita duplicar la superficie RLS sobre Realtime.
- *Señal, no dato*: el stack ya define TanStack Query como dueño del estado de servidor (`docs/ARCHITECTURE.md`, `config.yaml`). Usar el payload como fuente de verdad crearía dos caminos de lectura divergentes y filtraría columnas de `offers` que la app no debería mostrar. Con invalidación, el refetch pasa por el mismo camino autorizado de siempre.
- *`REPLICA IDENTITY DEFAULT`*: `FULL` engorda el WAL y expone `old_record`; no hay caso de uso que lo requiera (nunca hay `DELETE` físico).

**Los 3 puntos donde esto se rompe en silencio** (van al runbook y al test):
1. Falta `grant select ... to authenticated` → RLS correcto, cero eventos.
2. El cliente no llama `setAuth(token)` en el canal → suscribe como `anon` → cero eventos.
3. Se olvida la política del destinatario y solo se pone la del proveedor → el proveedor ve su propia oferta, el usuario no ve nada. Éste es exactamente el riesgo declarado en la proposal.

**Smoke test manual** (criterio de éxito "una lectura autenticada de prueba recibe eventos"): sesión A suscrita como usuario dueño, sesión B suscrita como un segundo usuario; insertar una oferta con service-role; A recibe el evento, B no. Ambas mitades importan: si B también recibe, hay fuga.

---

## D-5 · Runbook de bootstrap del primer `super_admin` (Q5)

Dos archivos, propósitos distintos y no intercambiables:

- `supabase/seed.sql` — **solo dev local**. Lo corre `supabase db reset`; el CLI nunca lo corre contra un proyecto remoto. Crea un usuario de Auth local para que un `db reset` deje un admin usable.
- `supabase/seed/00_bootstrap_super_admin.sql` — **staging/producción**. Parametrizado, ejecución manual, jamás automática.

**Runbook (staging/producción)**

1. Dashboard de Supabase → **Authentication → Users → Add user**. Email + password fuerte, **Auto Confirm User = ON**. Copiar el `uid` generado. Nunca por endpoint público: no existe self-registration para `admin` y no se va a crear una.
2. Exportar credenciales en la shell del operador — `SUPABASE_DB_URL`. La service-role key no se commitea ni se pega en un ticket.
3. Ejecutar el seed parametrizado:
   ```
   psql "$SUPABASE_DB_URL" \
     -v admin_uid="'<uid-del-paso-1>'" \
     -v admin_email="'admin@repon.cl'" \
     -v admin_nombre="'Nombre Apellido'" \
     -f supabase/seed/00_bootstrap_super_admin.sql
   ```
4. El script es idempotente y auto-defensivo:
   - `insert into public.profiles (...) values (:admin_uid, 'admin', 'activo', ...) on conflict (id) do nothing;`
   - `insert into public.admin_roles (profile_id, rol, granted_by) values (:admin_uid, 'super_admin', :admin_uid) on conflict (profile_id) do nothing;`
   - se aborta si ya existe algún `super_admin`: `where not exists (select 1 from public.admin_roles where rol = 'super_admin')`
   - escribe la primera fila de `audit_log`: `accion = 'bootstrap_super_admin'`, `motivo = 'bootstrap manual fuera de banda'`, `actor_profile_id = :admin_uid`
5. Verificar: `select count(*) from public.admin_roles where rol = 'super_admin';` → exactamente `1`.
6. Rotar la contraseña desde el dashboard tras el primer login y registrar operador + fecha en el runbook de operaciones.

**Firma de una fila bootstrap**: `admin_roles.granted_by = admin_roles.profile_id`. Es el único caso legítimo de auto-otorgamiento en el sistema; cualquier otra fila con esa forma es una anomalía auditable. Se documenta con `comment on column`.

**Rationale** (confirma Q5): un endpoint de auto-provisión de admin es una escalada de privilegios permanente a cambio de una comodidad de una sola vez. El paso manual es intencionalmente incómodo y deja rastro humano.

---

## D-6 · Semántica de snapshot de `order_items`

**Choice**: copia por valor en el `INSERT`, `offer_item_id` degradado a **procedencia**, e inmutabilidad enforceada por grants.

1. **Copia al insertar.** `crearPedidoDesdeOferta(offerId)` lee `offer_items` una vez y escribe valores literales en `order_items`. Se copian también los campos de presentación alternativa (`is_alt`, `alt_size`, `alt_qty`, `alt_note`), no solo `nombre`/`cantidad`/`precio_unitario`/`subtotal`: son parte de lo que el usuario aceptó comprar y sin ellos la boleta no es reproducible.
2. **`offer_item_id` no se lee nunca en el read path.** Se conserva la FK para trazabilidad y se declara en la propia DB:
   ```sql
   comment on column public.order_items.offer_item_id is
     'Solo procedencia. NUNCA joinear para leer precio o descripcion:
      order_items es un snapshot inmutable al momento de la compra.';
   ```
   Un comentario en catálogo es greppable y sobrevive al onboarding de quien no leyó este documento; un acuerdo verbal no.
3. **Inmutabilidad por grants**, mismo mecanismo que `audit_log`:
   ```sql
   revoke update, delete on public.order_items from anon, authenticated, service_role;
   ```
   Con esto el snapshot deja de depender de la disciplina del programador: aunque core-api use service-role, Postgres rechaza el `UPDATE`. Corregir un pedido equivocado exige un registro compensatorio (cambio de `orders.status`, pedido nuevo), nunca una edición — que es justamente el requisito contable.
4. **`subtotal` es columna plana, no `GENERATED ALWAYS AS`.** Una columna generada impone `cantidad × precio_unitario` para siempre y hace imposible representar un descuento o un redondeo pactado. Solo `check (subtotal >= 0)`.
5. Moneda: vive en `payments`/`orders`, no por línea. Todos los montos `numeric(12,2)`.

**Consequences**: el catálogo del proveedor puede editarse libremente sin tocar el historial (objetivo). El costo es que `order_items` duplica texto y precios — deliberado, es la definición de snapshot. Y `revoke update` implica que cualquier corrección de datos es una operación de break-glass con el rol `postgres`, que deja rastro.

---

## Cambios de archivos

| Archivo | Acción | Descripción |
|---|---|---|
| `supabase/migrations/20260803120000_00_extensions_enums.sql` .. `_08_storage.sql` | Create | 9 lotes, timestamps congelados, RLS en el mismo archivo |
| `supabase/rollback/NN_<dominio>_down.sql` | Create | Inverso manual por lote (drop políticas → tablas → enums) |
| `supabase/tests/NN_<dominio>_test.sql` | Create | pgTAP: esquema, RLS por rol, grants |
| `supabase/seed.sql` | Create | Admin de dev local (solo `db reset`) |
| `supabase/seed/00_bootstrap_super_admin.sql` | Create | Runbook D-5, parametrizado, manual |
| `supabase/SPEC.md` | Modify | Columnas reales; corregir redacción RLS de zona de despacho; `company_dispatch_zones`; documentar la plantilla D-2 |
| `packages/types/SPEC.md` | Modify | Por lote. Incluye **`Offer.userId`** (D-2) y `Offer.refillRequestId` opcional |
| `docs/DATA_MODEL.md` | Modify | `company_dispatch_zones`; nota de snapshot en `order_items` |
| `services/core-api/domains/ofertas/SPEC.md` | Modify | Invariante `offers.user_id`; casos de uso `'rechazada'`/`'expirada'` (D2) |
| `services/core-api/domains/identidad/SPEC.md` | Modify | Contrato de compensación de `AuthProvider` (D-1) |

## Estrategia de testing

| Capa | Qué se prueba | Cómo |
|---|---|---|
| Esquema | Tablas, FKs, índices, enums | pgTAP `has_table` / `has_index` / `col_is_fk`, vía `supabase test db` |
| RLS | Deny-all por defecto; allowlist; dueño ve / no-dueño no ve | pgTAP con `set local role authenticated` + `set local request.jwt.claims` |
| Grants | Sin `update`/`delete` en `audit_log` y `order_items`, ni para `service_role` | pgTAP `table_privs_are` |
| Realtime | Evento llega al dueño y **no** al no-dueño | Smoke manual de 2 sesiones (D-4); no es automatizable con pgTAP |
| Auth/compensación | — | Difierido al cambio de core-api. Acá solo se testea que `v_auth_orphans` existe y es service-role-only |

pgTAP es la elección correcta para este repo: es la única forma de testear RLS y grants de verdad, y **no requiere npm, package manager ni CI** — que hoy no existen (`config.yaml: testing.status = not_configured`). Evita bloquear el esquema detrás de una decisión de tooling de JS.

## Migración / rollout

Sin datos productivos. Rollback = `supabase db reset` hasta el primer deploy real; después, el archivo espejo de `supabase/rollback/`. Los 9 lotes se aplican en orden estricto de timestamp, que coincide con el orden de FKs.

## Preguntas abiertas

- [ ] `offers.user_id` y `refill_request_id` nullable son **aditivos respecto a `packages/types/SPEC.md`** (hoy `Offer` no tiene `userId` y `refillRequestId` es requerido). `sdd-spec` debe absorberlo explícitamente — se declara como conflicto, no se cambia en silencio.
- [ ] Dueño y calendarización del job de reconciliación de huérfanos (este cambio entrega solo `v_auth_orphans`).
- [ ] ¿`refill_requests.comuna` `NOT NULL` o nullable? Afecta al matching, no a este diseño; lo cierra `sdd-spec`.
- [ ] ¿`order_items` debería congelar también `catalog_product_id`? Barato ahora, caro de backfillear después (mismo argumento que Q4).
