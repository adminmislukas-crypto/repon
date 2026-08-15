# Design: `ofertas` — quinto vertical, primera proyección de descubrimiento y primer delta sobre un `contracts/` ajeno congelado

Cierra las **3 preguntas que `proposal.md` asignó a esta fase** (Q1, Q2, Q7) y fija la mecánica que `pedidos-pagos` va a copiar: cómo se escribe un read-model que **reemplaza** sin `DELETE`, cómo se extiende un contrato cross-dominio ya congelado sin re-abrirlo, y cómo se prueba un orden de ejecución que ningún test estructural puede garantizar.

No re-abre D1–D18. No define escenarios Given/When/Then (eso ya lo hizo `sdd-spec`, cuyos 5 delta specs están aprobados y son la entrada de este documento). Q4/Q5/Q6 ya fueron resueltas por `sdd-spec` y se toman como dadas; donde este documento diverge de `specs/`, la divergencia está tabulada en **§Reconciliación con `specs/`**, al final, para que `sdd-tasks` no la descubra sola. La única divergencia que exigía decisión explícita del usuario (los `@Roles` de las 2 rutas de usuario) ya fue resuelta: **se mantiene `@Roles('user')` tal como fija el spec aprobado**, revirtiendo la propuesta original de este documento — ver §Reconciliación con `specs/`, fila 4.

Diagramas en ASCII: convención existente del repo (`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, los `design.md` de `catalogo`, `consumo` y `refill-matching`); no hay mermaid en ninguna parte.

## Qué cierra este documento

| Sección | Cierra | Respuesta en una línea |
|---|---|---|
| **D-A** | **Q1** — DDL del batch `16` y forma exacta del reemplazo | **`vigente boolean` + retire-blanket-then-upsert dentro de una sola transacción**, 5 sentencias acotadas. `urgencia` como **`text`**, no reusando `public.refill_urgencia`: reusar el enum de otro bounded context es el equivalente **a nivel de tipo** de la FK que D4 ya rechazó. `cerrada_at` **nunca se toca** por el writer: cerrar es monótono |
| **D-B** | **Q2** — firma del método nuevo de `CatalogQueryPort` | `obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>` — `companyId` **primero** porque es alcance obligatorio (el `companyId?` de `buscarCoincidencias` va último porque es un estrechamiento opcional). El descarte silencioso **no es código**: es el predicado del `WHERE`. Hereda C1–C6 y C8; C7 no aplica; nacen **C9** (descarte silencioso) y **C10** (la cota es el input) |
| **D-C** | **Q7 + R3** — cómo se prueba el orden de C2 | **Test de interacción con log de resolución**, obligatorio, no review. Es el único riesgo del cambio **sin garantía estructural**: `enviarOferta` es el primer caso de uso del repo que inyecta `TRANSACTION_MANAGER` **y** llama a un `contracts/` ajeno |
| **D-D** | `aceptarOferta`: 3 escrituras, 1 transacción (D12/R4) | `desplazadas` sale de un `UPDATE ... RETURNING id` — exacto y gratis, sin SELECT previo ni carrera. La violación del índice único se traduce a error de dominio **en el adaptador** (código `23505`), nunca en el caso de uso |
| **D-E** | Superficie HTTP, roles y errores | 5 rutas, prefijo `ofertas` (sin desviación: es de una palabra). `aceptarOferta`/`obtenerBandeja` mantienen **`@Roles('user')`**, tal como fija el spec aprobado — decisión explícita del usuario, revirtiendo la propuesta original de este documento. Limitación aceptada y declarada: un perfil `provider` que también es dueño de mascota **no puede** ver su propia bandeja ni aceptar ofertas por esta vía |
| **D-F** | Eventos, listeners y los 3 payloads locales | El payload local de `ofertas` **omite `providerCatalogItemIds` a propósito**: no declarar el campo es lo que hace que D8 no se pueda violar por accidente |
| **D-G** | Vacíos que ninguna Q nombró | `OfferRepository` necesita 3 métodos más y uno de los existentes queda **sin caller**; qué hace `enviarOferta` con el resultado del puerto; aceptar una oferta que no está `'pendiente'`; **no hay push al proveedor** y por qué; `tx` **requerido** (no opcional) en 2 métodos |
| §Diagramas · §Wiring · §Transacciones · §Row types · §Secuencia | Detalle que `sdd-tasks` necesita | 3 flujos, providers, mapa de transacciones, DDL, 8 PRs encadenados |

---

## D-A · DDL del batch `16` y mecánica exacta del reemplazo (Q1)

### A.1 · `urgencia` es `text`, no `public.refill_urgencia`

| | **`text`** | Reusar `public.refill_urgencia` |
|---|---|---|
| Acoplamiento físico | Ninguno | La tabla de `ofertas` depende de un **tipo creado por la migración `04` de `refill-matching`** |
| Extracción a otra base | La tabla se mueve sola | Hay que **recrear el tipo** en la base destino, o dropear la columna |
| Si `refill-matching` agrega un valor | Nada que hacer: el dato llega tipado como `Urgencia` desde `@repon/types` | El dominio aceptado de una columna de `ofertas` **cambia sin que `ofertas` se entere** |
| Validación en Postgres | Ninguna | Sí |
| Coherencia con D4 | **Exacta**: D4 ya rechazó la FK a `refill_requests` por este mismo motivo | Contradice D4 a nivel de tipo |

Se elige **`text`**, y **sin `CHECK`**: un `CHECK` que enumere los 4 valores es el mismo acoplamiento con otra sintaxis — habría que editarlo el día que `refill-matching` agregue un quinto. El modo de falla es inerte y acotado, igual que el `company_id` basura de `catalog_hidden_companies`: `urgencia` no gobierna ninguna decisión, solo se muestra y se ordena en la lista del proveedor. La validación real vive donde el dato entra: el payload local del listener lo tipa como `Urgencia` (`@repon/types`), y ése es el único camino de escritura.

**A nivel de TypeScript la reutilización sí es obligatoria** (`SolicitudElegible.urgencia: Urgencia`, exigido por el delta de `shared-types-package`). No es contradicción: `@repon/types` es un paquete compartido **del monorepo** y sobrevive la extracción; un tipo de Postgres, no.

### A.2 · El reemplazo de D5: `vigente boolean` + retire-blanket-then-upsert

Tres candidatos, evaluados contra el mismo escenario: R tenía elegibles `[A, B]`, llega un `MatchEncontrado` con `[A]`.

| Opción | Cómo expulsa a B | Veredicto |
|---|---|---|
| **`vigente boolean`** ✅ | `UPDATE ... SET vigente = false WHERE refill_request_id = R` y después upsert de `[A]` con `vigente = true`. B queda `false` porque nadie lo reinstaló | **Elegida.** Precedente **literal** del repo: `catalog_hidden_companies.oculto` — misma tabla-proyección, mismo problema, misma solución ("`oculto boolean` instead of physical DELETE... every write here is an idempotent upsert/update", migración `12`). Un solo predicado de lectura (`vigente`), una sola forma de escritura |
| `retirado_at timestamptz` | Idéntico, con `retirado_at is null` como predicado | Rechazada: **no compra nada**. "Volver a ser elegible" sería `SET retirado_at = null`, que **destruye** el dato que justificaba la columna. Si no se conserva historia, un timestamp es un booleano más caro |
| `matched_at` versionado | La cabecera avanza su `matched_at`; los hijos llevan el `matched_at` de la corrida que los escribió; se lee con `hijo.matched_at = cabecera.matched_at`. B queda afuera por no haber sido re-estampado | Rechazada, aunque es la más elegante (ahorra 2 `UPDATE`): usa un **timestamp como identidad de generación**. Dos corridas con el mismo `now()` — improbable en la práctica, indetectable en la teoría — dejarían a B elegible para siempre. Un mecanismo de autorización no se apoya en que dos relojes no coincidan |
| `DELETE` + `INSERT` | — | **Estructuralmente imposible**, y ésa es la parte interesante: `service_role` **no tiene el grant** (`20260804090500_10_…`: "select, insert, update — no DELETE anywhere in this schema"). No es una convención que alguien pueda olvidar: la sentencia falla con permission denied |

**La forma exacta del writer**, entera dentro de un `runInTransaction` (D5/D13), máximo **5 sentencias**, ninguna N+1:

```
1. INSERT INTO offer_opportunities (refill_request_id, user_id, comuna, urgencia, matched_at)
   VALUES (...)
   ON CONFLICT (refill_request_id) DO UPDATE
     SET user_id = excluded.user_id, comuna = excluded.comuna,
         urgencia = excluded.urgencia, matched_at = now()
   -- cerrada_at NO aparece en el SET. Ver A.3.

2. UPDATE offer_opportunity_companies SET vigente = false
   WHERE refill_request_id = $R AND vigente = true            -- retire en bloque

3. INSERT INTO offer_opportunity_companies (refill_request_id, company_id) VALUES (...)  -- multi-row, 1 sentencia
   ON CONFLICT (refill_request_id, company_id) DO UPDATE SET vigente = true
   -- se OMITE si companyIds = [] : el paso 2 ya dejo la solicitud sin elegibles

4. UPDATE offer_opportunity_items SET vigente = false
   WHERE refill_request_id = $R AND vigente = true

5. INSERT INTO offer_opportunity_items (refill_item_id, refill_request_id, nombre,
                                        categoria, precio_referencia, catalog_product_id)
   VALUES (...)                                                -- multi-row, 1 sentencia
   ON CONFLICT (refill_item_id) DO UPDATE
     SET nombre = excluded.nombre, categoria = excluded.categoria,
         precio_referencia = excluded.precio_referencia,
         catalog_product_id = excluded.catalog_product_id, vigente = true
```

Tres propiedades, cada una con su razón:

1. **El orden retire → upsert es obligatorio y no conmutativo.** Al revés (upsert y después retire) el `UPDATE` en bloque apagaría las filas recién escritas y la solicitud quedaría sin elegibles. Es el bug más fácil de introducir en este archivo; va comentado en el adaptador.
2. **Nadie observa el estado intermedio.** Los dos `UPDATE` y los dos upsert viven en la misma transacción: bajo `read committed`, un `listarSolicitudesElegibles` concurrente ve el conjunto anterior **completo** o el nuevo **completo**, nunca el vacío del medio. Ésta es la razón real por la que D5 exige `TRANSACTION_MANAGER`, más allá de que crucen 3 tablas.
3. **La idempotencia cae del upsert, no de un chequeo.** Una re-corrida con `[A, B]` apaga y reenciende las mismas dos filas: cero duplicados, cero ramas especiales, y el escenario "same-companies re-run is idempotent" del spec se cumple sin código dedicado.

Costo aceptado y acotado: el `UPDATE` en bloque toca filas que se van a reinstalar dos sentencias después (y dispara su trigger de `updated_at` dos veces). El conjunto es el de **una** solicitud, indexado por el prefijo de la PK. Se rechaza calcular el diff en la aplicación (leer el conjunto actual, computar altas/bajas, escribir solo el delta): más round-trips, una ventana TOCTOU entre la lectura y la escritura, y ninguna ganancia.

### A.3 · Cerrar es monótono: el writer nunca reabre una oportunidad

`cerrada_at` **no aparece** en el `DO UPDATE SET` del paso 1, a propósito. Es alcanzable: `refill-matching` permite re-correr el matching sobre una solicitud `'confirmada'` (riesgo residual archivado de su propio `design.md`), así que un `MatchEncontrado` **puede** llegar después de que el usuario ya aceptó. Si el writer reseteara `cerrada_at`, la solicitud volvería a la lista de todos los proveedores, ellos ofertarían, y `aceptarOferta` chocaría contra el índice único parcial → 409 sobre una operación que el usuario ya completó. Cerrar es **una sola dirección**, y el escenario "A closed opportunity does not appear in any provider's list" del spec depende de eso.

El writer **no** se saltea la escritura sobre una oportunidad cerrada: mantener la cabecera fresca es inocuo (todas las lecturas filtran `cerrada_at is null`) y saltear introduciría una rama silenciosa. Uniformidad sobre micro-optimización.

### A.4 · La migración completa

`supabase/migrations/20260808120000_16_ofertas_discovery_projection.sql` — ventana de timestamps del día siguiente al último aplicado (`20260807120100_15_…`), mismo patrón que `11`/`12` y `14`/`15`. **Un solo archivo**: no crea ni usa ningún valor de enum nuevo, así que la restricción de Postgres que obligó a partir `14`/`15` no aplica acá.

```sql
-- Batch 16 -- ofertas: la proyeccion de descubrimiento (D1/D4/D5,
-- design.md D-A). Delta declarado sobre db-schema-ofertas.
-- NO edita 20260803120500_05_ofertas.sql: fix-forward.
--
-- Las 3 tablas son estado INTERNO de `ofertas` (D4), mismo encuadre literal
-- que catalog_hidden_companies (batch 12): RLS habilitada, CERO politicas,
-- cero grants a anon/authenticated. Ningun cliente las lee jamas --
-- listarSolicitudesElegibles es el unico camino de acceso, por HTTP, porque
-- la elegibilidad es logica de negocio (docs/ARCHITECTURE.md reserva el
-- acceso directo a Postgres para "lecturas simples sin logica asociada").
-- Divergencia deliberada respecto de offers/offer_items, que SI tienen
-- politicas y grant a authenticated: esos los exige Realtime.
--
-- SIN FK a refill_requests / refill_items / companies / profiles (D4): la
-- fuente de verdad de estas filas es el payload de un evento de otro
-- bounded context, no una relacion que este dominio posea. Una FK habria
-- que dropearla el dia que ofertas se extraiga. El modo de falla esta
-- acotado: offers.refill_request_id SI tiene FK real, y es el cerrojo final.
--
-- urgencia es `text` y NO public.refill_urgencia (design.md D-A.1): reusar
-- el enum de otro dominio es el equivalente a nivel de TIPO de la FK que el
-- parrafo anterior rechaza. Sin CHECK enumerando los valores, por lo mismo.
--
-- `vigente boolean` y no DELETE fisico (D5/design.md D-A.2): este esquema no
-- otorga DELETE en ningun lado (batch 10, literal). El reemplazo por
-- solicitud es UPDATE-en-bloque + upsert, en una sola transaccion.

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.offer_opportunities (
  refill_request_id uuid primary key,
  user_id           uuid        not null,
  comuna            text        not null,
  urgencia          text        not null,
  matched_at        timestamptz not null default now(),
  cerrada_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.offer_opportunities is
  'Cabecera de la proyeccion de descubrimiento propiedad de ofertas (D1). La mantiene un listener @OnEvent sobre MatchEncontrado. PK = refill_request_id SIN FK a proposito. user_id es de donde enviarOferta saca offers.user_id, sin joinear jamas contra refill_requests (D7 de refill-matching: no existe camino sincrono).';
comment on column public.offer_opportunities.cerrada_at is
  'La setea aceptarOferta (D12) y NADIE la vuelve a NULL: cerrar es monotono (design.md D-A.3). Un MatchEncontrado posterior refresca la cabecera pero NO reabre la oportunidad -- reabrirla devolveria la solicitud a la lista de todos los proveedores despues de que el usuario ya acepto.';
comment on column public.offer_opportunities.urgencia is
  'text, no public.refill_urgencia (design.md D-A.1). Vocabulario de refill-matching que viaja por evento; se valida al entrar (el payload local del listener lo tipa como Urgencia de @repon/types), nunca en Postgres.';

create table public.offer_opportunity_companies (
  refill_request_id uuid        not null,
  company_id        uuid        not null,
  vigente           boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (refill_request_id, company_id)
);

comment on table public.offer_opportunity_companies is
  'El HECHO de elegibilidad: una fila por empresa actualmente elegible sobre una solicitud (D1). vigente = false es la baja logica del reemplazo de D5 -- el repo no otorga DELETE en ningun lado. Toda lectura filtra vigente = true.';

create table public.offer_opportunity_items (
  refill_item_id     uuid primary key,
  refill_request_id  uuid          not null,
  nombre             text          not null,
  categoria          text          not null,
  precio_referencia  numeric(12,2) not null,
  catalog_product_id uuid,
  vigente            boolean       not null default true,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

comment on table public.offer_opportunity_items is
  'Los items de la solicitud, RE-DECLARADOS en el vocabulario de refill-matching -- nunca un snapshot de un tipo de catalogo (D8). Contra esta tabla se valida que cada refillItemId de una oferta reactiva pertenezca a esa solicitud, y de aca sale el RefillItem[] con el que enviarOferta llama a buscarCoincidencias. SIN columna de provider_catalog: una proyeccion que guarda ids de catalogo es un evento congelado con otra forma (D8).';
comment on column public.offer_opportunity_items.categoria is
  'NOT NULL, a diferencia de refill_items.categoria (nullable desde el batch 15): MatchEncontrado SOLO se publica sobre una solicitud activa, y RefillRequestActiva garantiza categoria/precio_referencia. La completitud la garantiza el contrato del evento, no un CHECK.';

-- ============================================================
-- 4. Indexes
-- ============================================================
-- listarSolicitudesElegibles busca por company_id, que NO es prefijo de la
-- PK (refill_request_id, company_id). Parcial sobre vigente: el indice tiene
-- exactamente la forma del unico predicado que este dominio ejecuta.
create index offer_opportunity_companies_company_id_idx
  on public.offer_opportunity_companies (company_id)
  where vigente;

-- El retire-en-bloque de D5 y la lectura de items filtran por
-- refill_request_id, que no es la PK de esta tabla.
create index offer_opportunity_items_refill_request_id_idx
  on public.offer_opportunity_items (refill_request_id);

-- D10: "existe alguna oportunidad de este usuario donde esta empresa figure".
create index offer_opportunities_user_id_idx
  on public.offer_opportunities (user_id);

-- ============================================================
-- 5. Triggers updated_at (funcion publica del lote 00)
-- ============================================================
create trigger offer_opportunities_set_updated_at
  before update on public.offer_opportunities
  for each row execute function public.set_updated_at();
create trigger offer_opportunity_companies_set_updated_at
  before update on public.offer_opportunity_companies
  for each row execute function public.set_updated_at();
create trigger offer_opportunity_items_set_updated_at
  before update on public.offer_opportunity_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.offer_opportunities         enable row level security;
alter table public.offer_opportunity_companies enable row level security;
alter table public.offer_opportunity_items     enable row level security;

revoke all on public.offer_opportunities         from anon, authenticated;
revoke all on public.offer_opportunity_companies from anon, authenticated;
revoke all on public.offer_opportunity_items     from anon, authenticated;

grant select, insert, update on public.offer_opportunities         to service_role;
grant select, insert, update on public.offer_opportunity_companies to service_role;
grant select, insert, update on public.offer_opportunity_items     to service_role;
-- Sin DELETE (convencion uniforme del esquema): la baja es vigente = false.

-- ============================================================
-- 7. RLS: ninguna politica, a proposito (ver cabecera).
-- ============================================================
```

**Reconciliación con el escenario "no extra domain column"** del delta de `db-schema-ofertas`: `vigente` y `created_at`/`updated_at` **no** son columnas de dominio. `vigente` es el mecanismo que la *otra* requirement del mismo spec autoriza explícitamente ("a `vigente boolean`, a `retirado_at timestamptz`, or a versioned `matched_at` … pending design.md's Q1"), y los timestamps son convención uniforme de las 15 tablas del esquema. Cero columnas de dominio más allá de D1.

---

## D-B · `CatalogQueryPort.obtenerItemsDeProveedor` (Q2)

**Choice**: `obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>` — la firma provisional del spec, confirmada, con 4 detalles fijados.

```ts
// domains/catalogo/contracts/catalog-query.port.ts  (aditivo, +1 metodo)
export interface CatalogQueryPort {
  buscarCoincidencias(itemsSolicitados: RefillItem[], companyId?: string): Promise<ProviderCatalogItem[]>;

  /**
   * C9 — DESCARTE SILENCIOSO: un id que no existe, que pertenece a otra
   * empresa, que esta `disponible = false` o cuya empresa esta oculta, NO
   * aparece en el resultado y NO lanza. El caller compara cardinalidades.
   * C10 — sin tope propio: el resultado esta acotado por `ids.length` (la
   * consulta es por PK). `MAX_COINCIDENCIAS_POR_ITEM` NO aplica acá: existe
   * para acotar una expansion trigram difusa, y acá no hay ninguna.
   */
  obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>;
}
```

| Detalle | Decisión | Por qué |
|---|---|---|
| **Orden de parámetros** | `companyId` **primero** | El `companyId?` de `buscarCoincidencias` va último porque es un **estrechamiento opcional**; acá es el **alcance obligatorio** de toda la consulta. Que el orden difiera es la señal: no son el mismo parámetro con la misma fuerza |
| **Tipo de retorno** | `ProviderCatalogItem[]`, no una proyección más angosta | El caller necesita `id` (para `offer_items.provider_catalog_item_id`), `precioBase`/`precioMaximo` (para acotar la cotización) y `nombre` (para el push). Un tipo angosto propio sería un **segundo** vocabulario que `catalogo` tendría que mantener para siempre, y `mapProviderCatalogRow` ya existe |
| **`disponible`** | **Filtra `disponible = true`** (hereda C5); no devuelve el flag para que decida el caller | Un ítem no disponible es exactamente tan inofertable como uno ajeno. Devolver el flag mudaría la política de disponibilidad de `catalogo` a `ofertas`. Con el filtro adentro, **una sola** comparación de cardinalidad cubre las cuatro causas de rechazo |
| **`ids` vacío** | Devuelve `[]` con **cero round-trips** | Espejo literal del `itemsSolicitados.length === 0` de `buscarCoincidencias`. Rechazar una oferta sin ítems es responsabilidad del DTO (400), no del puerto |

**Herencia de C1–C8, término a término**: C1 (sin `tx?`) ✔ · C2 (nunca desde dentro de una transacción) ✔ · C3 (solo lectura) ✔ · C4 (anti-join de empresas ocultas) ✔ · C5 (`disponible`, no `stock`) ✔ · C6 (un solo round-trip para todo el array) ✔ · **C7 no aplica** (no hay matching difuso: es igualdad por PK) · C8 (lanza `CatalogQueryUnavailableError`, jamás `[]` degradado) ✔.

**C4 heredada compra algo que no estaba pedido**: si la empresa que oferta está oculta (suspendida), el anti-join devuelve `[]`, la cardinalidad no coincide y `enviarOfertaProactiva` se rechaza. La suspensión queda enforceada en la ruta proactiva **sin una sola línea de código de `ofertas`**.

### Dónde vive el descarte silencioso: en el `WHERE`, no en una función

```ts
// adapters/persistence/kysely-catalog-query.adapter.ts  (+1 metodo)
async obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]> {
  if (ids.length === 0) return [];              // C6/C10: cero round trips
  try {
    const rows = await this.db
      .selectFrom('provider_catalog as pc')
      .selectAll('pc')
      .where('pc.company_id', '=', companyId)   // C9: el alcance ES el descarte
      .where('pc.id', 'in', [...ids])
      .where('pc.disponible', '=', true)        // C5
      .where((eb) => eb.not(eb.exists(/* anti-join catalog_hidden_companies */)))  // C4
      .execute();
    return rows.map(mapProviderCatalogRow);
  } catch (error) {
    throw new CatalogQueryUnavailableError(undefined, { cause: error });  // C8
  }
}
```

La respuesta a "¿dónde vive el descarte?" es **en ningún lado, como código**: es la ausencia de filas que satisfagan el predicado. No hay un `filter()` posterior que alguien pueda "arreglar" para que lance, ni una lista de ids no encontrados que tiente a reportarla. Lo único que hay que proteger es que un implementador futuro **no** agregue ese lanzamiento, y eso vive en el doc comment del contrato (C9), donde ya viven C1–C8.

La comparación de cardinalidad vive en `EnviarOfertaProactivaUseCase` (`ports-in/`), no en el adaptador: "cuántos faltantes son demasiados" es una decisión de negocio (hoy: **uno solo ya rechaza**), y ponerla en el adaptador la haría inobservable desde un test unitario del caso de uso.

**`catalogo` se toca en exactamente 2 archivos**, los dos de forma aditiva, tal como exige el criterio de éxito.

---

## D-C · Cómo se prueba el orden de C2 (Q7 + R3)

`enviarOferta` es el **primer caso de uso del repo que inyecta `TRANSACTION_MANAGER` y además llama a un `contracts/` ajeno**. En `refill-matching`, C2 se cumplía **por construcción** (`BuscarProveedoresCompatiblesUseCase` no inyecta el token, y esa ausencia era el test). Acá esa red no existe.

| Opción | Veredicto |
|---|---|
| Solo review + comentario | **Rechazada.** Es el riesgo más alto del cambio (R3) y el único sin garantía estructural. Un refactor futuro que mueva la llamada tres líneas abajo no rompe ningún test, no rompe el typecheck, y el deadlock **solo aparece bajo carga real**, cuando el pool se agota |
| Test estructural (ausencia del token) | **Imposible**: el caso de uso *debe* inyectarlo |
| `invocationCallOrder` de los mocks | Insuficiente: prueba orden de **invocación**, no de **resolución**. Un `buscarCoincidencias(...)` sin `await`, con el `runInTransaction` después, pasaría el assert y tendría exactamente el bug |
| **Log de resolución ordenado** ✅ | **Elegida.** Determinista, sin timers, ~10 líneas |

```ts
// ports-in/enviar-oferta.use-case.spec.ts — D18: se escribe ANTES del caso de uso
const orden: string[] = [];
catalogQueryPort.buscarCoincidencias.mockImplementation(async () => {
  await Promise.resolve();            // fuerza a que el caller tenga que AWAITEAR
  orden.push('catalogo:resuelto');
  return [itemVivo];
});
transactionManager.runInTransaction.mockImplementation(async (work) => {
  orden.push('tx:abierta');
  return work(txFake);
});

await useCase.execute(actor, refillRequestId, items, entrega);

expect(orden).toEqual(['catalogo:resuelto', 'tx:abierta']);
```

Si el caso de uso llamara al puerto **dentro** del `runInTransaction`, el array sería `['tx:abierta', 'catalogo:resuelto']` y el test falla. Si lo llamara antes pero sin `await`, el `push` del puerto cae en un microtask posterior y el array también se invierte. **Las dos formas del bug quedan cubiertas por el mismo assert.**

Se complementa con la mitad estructural que sí existe: `CatalogQueryPort` **no tiene parámetro `tx?`** (C1), así que ni siquiera existe el canal por el cual la transacción podría filtrarse al puerto. El test cubre el orden; el tipo cubre la fuga.

---

## D-D · `aceptarOferta`: tres escrituras, una transacción (D12 / R4)

```
runInTransaction(async (tx) => {
  1. offerRepository.findById(offerId, tx)
       null || offer.userId !== actor.profileId  -> OfferNotFoundError      (404, byte-identico)
       offer.status !== 'pendiente'              -> TransicionInvalidaError (409, D-G.3)
  2. offerRepository.marcarAceptada(offerId, tx)                  -- UPDATE angosto de 1 columna
  3. if (offer.kind === 'reactiva') {                             -- refillRequestId !== null
       desplazadas = offerRepository.desplazarHermanas(offer.refillRequestId, offerId, tx)
       opportunityRepository.cerrar(offer.refillRequestId, tx)
     } else { desplazadas = [] }                                  -- rama PROBADA, no muerta
})
-- COMMIT --
4. eventPublisher.publish(new OfertaAceptada({ offerId, companyId, userId,
                                               refillRequestId, total, desplazadas }))
```

**`desplazadas` sale de un `UPDATE ... RETURNING`, y ése es el punto:**

```sql
update public.offers set status = 'rechazada'
 where refill_request_id = $1 and id <> $2 and status = 'pendiente'
returning id;
```

Un `SELECT` previo para saber a quién desplazar, seguido del `UPDATE`, daría una lista que **puede no coincidir** con lo que efectivamente se movió (una hermana nueva insertada entre ambas sentencias). `RETURNING` devuelve exactamente las filas que esta sentencia cambió: el payload de `OfertaAceptada` es exacto **por construcción**, no por cuidado del programador, y el escenario del spec ("`desplazadas` is `[A, C]` — exactly the offers this operation moved") se cumple sin un assert de más.

**La violación del índice único se traduce en el adaptador, nunca en el caso de uso** (R4). `KyselyOfferRepository.marcarAceptada` atrapa el error del driver, y si `code === '23505'` con `constraint === 'offers_refill_request_id_aceptada_uidx'` lanza `OfertaYaAceptadaError`; el filtro lo mapea a **409**. Motivo: un `code` de Postgres es infraestructura, y `ports-in/` no puede conocerlo sin importar vocabulario del driver — la misma frontera que hace que `CatalogQueryUnavailableError` exista en vez de dejar salir un error de Kysely. Cualquier otro error se re-lanza tal cual y termina en 500, que es lo correcto para un fallo genuinamente inesperado.

**La rama proactiva no es un `if` defensivo, es la mitad del contrato**: sin `refillRequestId` no hay hermanas ni oportunidad, y el escenario "Accepting a proactive offer displaces nothing and closes nothing" es test obligatorio.

---

## D-E · Superficie HTTP, roles y errores

### Rutas (fijadas por `sdd-spec`, Q5)

| Método + ruta | Guard | Caso de uso | Éxito |
|---|---|---|---|
| `POST /ofertas` | `@Roles('provider')` | `enviarOferta` | **201** `OfferResponseDto` |
| `POST /ofertas/proactivas` | `@Roles('provider')` | `enviarOfertaProactiva` | **201** `OfferResponseDto` |
| `GET /ofertas/oportunidades` | `@Roles('provider')` | `listarSolicitudesElegibles` | **200** `SolicitudElegibleDto[]` |
| `POST /ofertas/:offerId/aceptar` | `@Roles('user')` (spec, decisión confirmada — ver abajo) | `aceptarOferta` | **204** sin cuerpo |
| `GET /ofertas/bandeja` | `@Roles('user')` (spec, decisión confirmada) | `obtenerBandeja` | **200** `OfferResponseDto[]` |
| — | — | `registrarOportunidad` | **Sin ruta. Nunca** (interno, solo el listener) |

**Prefijo `ofertas`, sin desviación**: el dominio tiene nombre de una palabra, así que hereda el precedente 3-de-3 (`identidad`, `catalogo`, `consumo`). La regla que `refill-matching` tuvo que inventar ("un dominio con nombre compuesto expone su familia de recursos") no se propaga acá.

**`204` para `aceptarOferta`**: `ofertas/SPEC.md` declara `aceptarOferta(...): Promise<void>`; devolver la oferta actualizada sería otro delta sobre una firma que nadie pidió cambiar. Precedente: `PUT /catalogo/mi-catalogo/:itemId/precio` → `@HttpCode(HttpStatus.NO_CONTENT)`. El cliente ya se entera por Realtime (`offers` está en la publicación) o refetcheando la bandeja.

### Decisión confirmada: se mantiene `@Roles('user')` en las 2 rutas de usuario

Este documento había propuesto divergir del delta spec (que fija `@Roles('user')` para `aceptarOferta`/`obtenerBandeja`), con evidencia real: la política RLS de `offers` no chequea rol (migración `05`, `user_id = (select auth.uid())`), y un perfil `provider` que también es dueño de mascota puede legítimamente ser destinatario de una oferta — con el guard puesto, ese perfil queda sin poder ver su bandeja ni aceptar, el mismo lockout que `consumo` y `refill-matching` evitaron por escrito en sus propios dominios.

**El usuario revisó esta evidencia y decidió mantener el spec tal como está aprobado.** `aceptarOferta`/`obtenerBandeja` conservan `@Roles('user')`.

**Limitación aceptada y declarada, no descubierta en producción**: un perfil `provider` que también es dueño de mascota (crea solicitudes, recibe ofertas propias) **no puede aceptar sus propias ofertas ni ver su bandeja** a través de esta API mientras el guard exista. No es un bug de este cambio — es una restricción de producto que debe comunicarse explícitamente al equipo de producto/soporte, y que un cambio futuro puede revertir quitando un solo `@Roles()` si se decide lo contrario.

Las **3 rutas de proveedor sí conservan `@Roles('provider')`**, sin relación con esta decisión: necesitan `actor.companyId` **no nulo** (`AuthenticatedActor`: "non-null iff role === 'provider'"). Sin el guard, un actor sin empresa llegaría al caso de uso con `companyId: null` y produciría un 500 en vez de un 403 limpio.

### Errores de dominio → `OfertasExceptionFilter`

`@UseFilters` a nivel de controlador, mapa keyeado por constructor, envelope `{ statusCode, code, message }`, `@Catch()` acotado — espejo exacto de `RefillExceptionFilter`/`ConsumoExceptionFilter`/`CatalogoExceptionFilter`.

| Error de dominio | HTTP | `code` | Cuándo |
|---|---|---|---|
| `SolicitudNoElegibleError` | **404** | `SOLICITUD_NO_ELEGIBLE` | La oportunidad no existe **o** esta empresa no es elegible. Byte a byte idéntico (D11) |
| `OportunidadCerradaError` | **409** | `OFERTA_OPORTUNIDAD_CERRADA` | Elegible, pero ya hay una oferta aceptada sobre esa solicitud (Q4) |
| `DestinatarioNoElegibleError` | **404** | `DESTINATARIO_NO_ELEGIBLE` | D10: no existe relación previa. Indistinguible de "ese `userId` no existe" |
| `OfferNotFoundError` | **404** | `OFFER_NOT_FOUND` | La oferta no existe **o** es de otro usuario (D11) |
| `OfertaYaAceptadaError` | **409** | `OFERTA_YA_ACEPTADA` | Violación del índice único parcial, traducida en el adaptador (R4) |
| `TransicionInvalidaError` | **409** | `TRANSICION_INVALIDA` | Aceptar una oferta que no está `'pendiente'` (D-G.3) |
| `ItemsNoDisponiblesError` | 400 | `OFERTA_ITEMS_NO_DISPONIBLES` | Cardinalidad distinta a la pedida: ids ajenos, inexistentes o no disponibles (D9/D-B) |
| `OfertaInvalidaError` | 400 | `OFERTA_INVALIDA` | 0 ítems, `isAlt` sin `altNote`, precio negativo, `refillItemId` que no pertenece a la solicitud |
| **`CatalogQueryUnavailableError`** | **503** | **`CATALOG_UNAVAILABLE`** | C8/D8. **Importado de `catalogo/contracts/`**, nunca redeclarado — misma única importación cross-dominio legítima que hace `refill-matching` |

**El orden de los chequeos es parte de la decisión**, igual que en `refill-matching`: elegibilidad (**404**) **antes** que oportunidad cerrada (**409**). Una empresa que nunca fue elegible sobre una solicitud ya cerrada recibe **404**, nunca 409 — el 409 confirmaría que la solicitud existe. **El 409 solo es alcanzable por una empresa que sí es elegible.**

---

## D-F · Eventos, listeners y payloads locales

### Los 2 eventos de `ofertas` (D6, ya fijados)

```ts
// domains/ofertas/events/oferta-enviada.event.ts
export class OfertaEnviada implements DomainEvent {
  readonly type = 'ofertas.oferta_enviada';
  readonly occurredAt = new Date();
  constructor(readonly payload: OfertaEnviadaPayload) {}
}
// payload: { offerId, kind, companyId, userId, refillRequestId: string | null,
//            total, tiempoEntregaHoras }

// domains/ofertas/events/oferta-aceptada.event.ts  -> 'ofertas.oferta_aceptada'
// payload: { offerId, companyId, userId, refillRequestId: string | null,
//            total, desplazadas: readonly string[] }
```

Campos anidados bajo `payload` (no aplanados sobre la instancia): es la forma de `consumo` y de `refill-matching`, y es la que el gotcha de `emitAsync` obliga a respetar del lado del consumidor.

### Los 3 payloads locales — y el que se define por lo que **omite**

```ts
// domains/ofertas/adapters/events/refill-matching-event.payloads.ts
import type { Urgencia } from '@repon/types';

export interface MatchEncontradoItemPayload {
  readonly refillItemId: string; readonly nombre: string;
  readonly categoria: string; readonly precioReferencia: number;
  readonly catalogProductId: string | null;
}
export interface MatchEncontradoPayload {
  readonly refillRequestId: string; readonly userId: string;
  readonly comuna: string; readonly urgencia: Urgencia;
  readonly companyIds: readonly string[];
  readonly items: readonly MatchEncontradoItemPayload[];
  // `providerCatalogItemIds` NO SE DECLARA, y es la parte importante de este
  // archivo: el evento real lo trae, y D8 prohibe persistirlo. Un campo que
  // no existe en el tipo no se puede guardar por accidente ni "aprovechar"
  // en un refactor futuro. La decision arquitectonica queda enforceada por
  // el sistema de tipos, no por un comentario.
}
```

```ts
// domains/refill-matching/adapters/events/ofertas-event.payloads.ts   (D7)
export interface OfertaEnviadaPayload {
  readonly offerId: string;                       // solo para la linea de log
  readonly refillRequestId: string | null;        // null => oferta proactiva
}
export interface OfertaAceptadaPayload {
  readonly offerId: string;
  readonly refillRequestId: string | null;
}
```

`Urgencia` se importa de `@repon/types`, no de `refill-matching`: es el paquete compartido del monorepo (el mismo que el delta de `shared-types-package` obliga a reusar en `SolicitudElegible`), no código de otro dominio. La regla que se preserva es "nunca importar la **clase de evento** ajena", y no se rompe.

### Los 2 listeners dentro de `refill-matching` (D7)

```ts
@Injectable()
export class OfertaEnviadaListener {
  private readonly logger = new Logger(OfertaEnviadaListener.name);
  constructor(private readonly marcarComoOfertadaUseCase: MarcarComoOfertadaUseCase) {}

  @OnEvent('ofertas.oferta_enviada')
  async onOfertaEnviada(event: { payload: OfertaEnviadaPayload }): Promise<void> {
    const { offerId, refillRequestId } = event.payload;
    // D6/D18 negativo obligatorio: una oferta proactiva no tiene solicitud
    // que transicionar. `return` temprano, nunca un `?.` ni un cast.
    if (refillRequestId === null) return;
    try {
      await this.marcarComoOfertadaUseCase.execute(refillRequestId);
    } catch (error) {
      this.logger.error({ evento: 'ofertas.oferta_enviada', offerId, refillRequestId },
        error instanceof Error ? error.stack : String(error));
    }
  }
}
```

`OfertaAceptadaListener` es idéntico contra `MarcarComoConfirmadaUseCase` y `'ofertas.oferta_aceptada'`. **Los dos capturan y loguean, jamás re-lanzan** (R5): `publish` usa `emitAsync`, y un rechazo acá propagaría **de vuelta** a `enviarOferta`/`aceptarOferta` **después del commit**, convirtiendo una operación exitosa en un error para el proveedor. Es el negativo obligatorio de D18 que más caro sale omitir.

`refill-matching.module.ts` cambia **solo su array de `providers`** (+2 entradas). `imports`, `controllers` y `exports` quedan byte a byte idénticos: cero aristas de módulo nuevas. `MarcarComoOfertadaUseCase`/`MarcarComoConfirmadaUseCase` ya están registrados desde su PR 7 y **no se editan**.

---

## D-G · Vacíos que ninguna pregunta abierta nombró

### D-G.1 · `OfferRepository` necesita 3 métodos más, y uno de los actuales queda sin caller

```ts
export interface OfferRepository {
  save(offer: Offer, tx?: TransactionContext): Promise<void>;                 // existente
  findByUser(userId: string, tx?: TransactionContext): Promise<Offer[]>;      // existente -> obtenerBandeja (items inline)
  findByRefillRequest(refillRequestId: string, tx?: TransactionContext): Promise<Offer[]>; // existente, SIN CALLER (ver abajo)

  /** D11 — dueño. NUEVO. No filtra por dueño: trae la fila y el caller compara. */
  findById(offerId: string, tx?: TransactionContext): Promise<Offer | null>;

  /** D12 — transición angosta de 1 columna, nunca un `save()` que reescriba ítems. NUEVO. */
  marcarAceptada(offerId: string, tx: TransactionContext): Promise<void>;

  /** D12 — una sentencia con RETURNING; devuelve los ids efectivamente movidos. NUEVO. */
  desplazarHermanas(
    refillRequestId: string, exceptoOfferId: string, tx: TransactionContext,
  ): Promise<readonly string[]>;
}
```

**`findByRefillRequest` se queda declarado y sin caller**, y se dice en voz alta en vez de fingir que se usa: está en `ofertas/SPEC.md`, y el displacement de D12 **no** lo necesita (una sentencia con `RETURNING` es más correcta que leer-y-después-escribir). Misma clase de superficie huérfana que `marcarComoOfertada` tuvo durante un cambio entero.

El puerto de la proyección, nuevo:

```ts
export interface OfferOpportunityRepository {
  /** D5 — replace por solicitud. `tx` REQUERIDO (D-G.5). */
  reemplazar(snapshot: OportunidadSnapshot, tx: TransactionContext): Promise<void>;
  /** D11/D8 — cabecera + items VIGENTES, ya como `RefillItem[]` para el puerto de catalogo. */
  findElegible(refillRequestId: string, companyId: string): Promise<OportunidadElegible | null>;
  /** D-E — la lista del proveedor, 1 query con join. */
  listarPorCompany(companyId: string): Promise<SolicitudElegible[]>;
  /** D10 — "¿esta empresa fue elegible alguna vez sobre alguna solicitud de este usuario?" */
  existeRelacion(companyId: string, userId: string): Promise<boolean>;
  /** D12 — `tx` REQUERIDO. Idempotente y monotono: `where cerrada_at is null`. */
  cerrar(refillRequestId: string, tx: TransactionContext): Promise<void>;
}
```

`OportunidadElegible` lleva `{ refillRequestId, userId, comuna, urgencia, cerradaAt, items: RefillItem[] }`. Que `items` sea **exactamente `RefillItem[]`** no es casualidad: es la razón por la que `offer_opportunity_items` guarda `nombre`/`categoria`/`precio_referencia`/`catalog_product_id` y nada más. La proyección mapea 1:1 contra la firma congelada de `buscarCoincidencias`, sin una sola línea de adaptación.

### D-G.2 · Qué hace `enviarOferta` con el resultado del puerto

`NuevoOfferItem` lleva `precio` (lo exige el delta de `shared-types-package`, que lo declara estructuralmente idéntico a `OfferItem`), y `isAlt` existe precisamente para cotizar una presentación **distinta** de la línea de catálogo — un saco de 25 kg no tiene precio derivable de una línea de 15 kg. Entonces el precio lo **cotiza el proveedor**, y el resultado vivo del puerto es la **autoridad** que lo gobierna:

1. **Regla dura**: cada ítem cotizado debe tener coincidencia viva en el resultado del puerto. Sin coincidencia no hay oferta — es lo que hace observable el escenario "a price change after the match is reflected in the offer" y lo que cierra R1 (proveedor suspendido → cero coincidencias → oferta incomponible).
2. **Techo, solo para ítems no-alt**: `precio <= precioMaximo` del ítem vivo. `precio_maximo` existe en el esquema exactamente para acotar lo que un proveedor puede cobrar (`CHECK (precio_maximo >= precio_base)`).
3. **Para `isAlt: true` el techo NO se aplica**, y se declara: la presentación difiere de la línea de catálogo, así que compararlas es comparar peras con manzanas. Lo que sí se exige es `altNote` (regla de `SPEC.md`), y el dominio expone la función pura de **precio por unidad/kilo** que `SPEC.md` pide, para que el cliente compare contra `precioReferencia`. **Riesgo residual nombrado**: un ítem `isAlt` no tiene techo de precio server-side. Cerrarlo exige normalizar presentaciones, que es su propio cambio de producto.

`total = Σ(item.precio) + costoDespacho`, función pura del dominio, calculada **fuera** de la transacción (paso 3 del orden de D13).

### D-G.3 · Aceptar una oferta que no está `'pendiente'`

`ofertas/SPEC.md` no lo cubre y el spec tampoco. Aceptar dos veces la **misma** oferta no viola el índice único (es la misma fila), así que sin regla explícita sería un no-op silencioso. Decisión: la máquina de estados de `OfferStatus` solo admite `'pendiente' -> 'aceptada'`; cualquier otro origen lanza `TransicionInvalidaError` → **409**. Mismo criterio que `refill-matching` usó para `TRANSICION_INVALIDA`, y misma familia que el 409 de Q4: el recurso existe y es tuyo, pero su estado no admite la operación.

### D-G.4 · No hay push al proveedor cuando le aceptan la oferta, y por qué

`NotificationPort.sendPush(recipientProfileId, mensaje)` toma un **`profileId`**. En `aceptarOferta` solo tenemos `companyId`, y resolver empresa → perfiles exigiría un contrato nuevo contra `identidad` que nadie pidió. Se envía push **solo en `enviarOferta`/`enviarOfertaProactiva`**, al `userId` destinatario, que sí tenemos — que es exactamente lo que `ofertas/SPEC.md` promete ("`OfertaEnviada` — dispara notificación push al usuario"). Notificar al proveedor está en `docs/ARCHITECTURE.md` **en el paso 6 del flujo, que es `pedidos-pagos`**. Ausencia declarada, no olvido.

Como en `procesarConsumosVencidos`: `publish(...)` y después `sendPush(...)` **en el mismo cuerpo del caso de uso**, después del commit, best-effort (`sendPush` no lanza por contrato).

### D-G.5 · `tx` **requerido**, no opcional, en los métodos cuya corrección es la atomicidad

`OfferOpportunityRepository.reemplazar(...)`, `.cerrar(...)` y `OfferRepository.marcarAceptada(...)`/`.desplazarHermanas(...)` declaran `tx: TransactionContext` **sin `?`**. Todo el resto del repo usa `tx?`. Es un endurecimiento deliberado y acotado: la regla de la fundación es "«olvidé abrir la transacción» debe ser un error de compilación", y en estos 4 métodos la atomicidad no es una optimización sino **la definición** de la operación (D5, D12). Llamarlos fuera de una transacción **no compila**. Los métodos de lectura conservan `tx?`.

---

## Diagrama 1 · `registrarOportunidad`: el listener y el reemplazo (D2 + D5 + R5)

```
 refill-matching                  MatchEncontradoListener            RegistrarOportunidadUseCase       OfferOpportunityRepository
 buscarProveedoresCompatibles     ofertas/adapters/events/           ports-in (interno, sin ruta)      ports-out
    |                                     |                                    |                            |
 publish(MatchEncontrado{ ...payload, companyIds[], providerCatalogItemIds[] })  -- emitAsync
    |------------------------------------>|                                    |                            |
    |                             (1) @OnEvent('refill.match_encontrado')
    |                                 Suscripcion por NOMBRE DE CANAL STRING. NUNCA se importa la clase
    |                                 de evento de refill-matching: el payload se tipa con la interfaz
    |                                 LOCAL de refill-matching-event.payloads.ts, que OMITE
    |                                 providerCatalogItemIds a proposito (D8 enforceada por el tipo).
    |                                     |
    |                             (2) NO HAY @OnEvent('refill.creado'). D2, y no es ahorro de trabajo:
    |                                 RefillCreado NO LLEVA companyIds, asi que no hay hecho de
    |                                 elegibilidad que proyectar. Suscribirse crearia una oportunidad
    |                                 con cero elegibles por CADA solicitud creada.
    |                                     |
    |                             (3) try {                                     |
    |                                   |--- execute(event.payload) ----------->|                            |
    |                                     |                              3a.  runInTransaction (D5/D13) =====
    |                                     |                                    |--- reemplazar(snapshot, tx) -->|
    |                                     |                                    |                            |
    |                                     |                                    |   1. upsert cabecera (cerrada_at NO se toca)
    |                                     |                                    |   2. UPDATE companies SET vigente=false  <- expulsa
    |                                     |                                    |   3. upsert companies  SET vigente=true  <- reinstala
    |                                     |                                    |   4. UPDATE items     SET vigente=false
    |                                     |                                    |   5. upsert items      SET vigente=true
    |                                     |                                    |
    |                                     |                                    |   companyIds = [] -> se OMITE el paso 3.
    |                                     |                                    |   La cabecera SE ESCRIBE IGUAL: "buscamos y
    |                                     |                                    |   no hay nadie" es un hecho, no un no-evento.
    |                                     |                                    |
    |                                     |                              ---- COMMIT ------------------------
    |                                     |                                    |
    |                                     |                              3b.  CERO EVENTOS, CERO push. Esta proyeccion es
    |                                     |                                   estado interno; el proveedor se entera cuando
    |                                     |                                   consulta su lista (D4: lectura por HTTP).
    |                             (4) } catch (error) { this.logger.error(...) }   <-- NUNCA re-lanza (R5)
    |<-- resuelve ----------------------- |
    |   emitAsync propaga los rechazos DE VUELTA: sin este catch, un fallo al escribir la proyeccion
    |   convertiria un matching exitoso de refill-matching en un 5xx. Negativo obligatorio de D18.
```

## Diagrama 2 · `enviarOferta`: el orden de C2 es la mitad del diseño (D8 + D11 + D13 + R3)

```
 proveedor        OfertasController        EnviarOfertaUseCase                OfferOpportunityRepo   CatalogQueryPort   OfferRepo/Publisher
    |                    |                 (INYECTA TRANSACTION_MANAGER **Y** CATALOG_QUERY_PORT:
    |                    |                  primer caso de uso del repo que hace las dos cosas -> R3)
 POST /ofertas   @Roles('provider')   body: { refillRequestId, items: NuevoOfferItemDto[], entrega }
    |                    |                 <-- el DTO NO tiene companyId. NO PUEDE tenerlo (D11).
    |------------------->|                          |                          |               |            |
    |               (1) AuthGuard + RolesGuard. actor.companyId es NO-NULO por el guard.
    |               (2) |--- execute(actor.companyId, refillRequestId, items, entrega) ------->|            |
    |                    |                          |                          |               |            |
    |                    |                    (3)  |--- findElegible(refillRequestId, companyId) --->|      |
    |                    |                          |     SIN tx: no hay transaccion abierta todavia.
    |                    |                          |     Filtra vigente = true.
    |                    |                          |<-- OportunidadElegible | null ------------------|
    |                    |                          |
    |                    |                    (4)  null ==> SolicitudNoElegibleError ==> 404
    |                    |                         (no existe Y no elegible dan EL MISMO error, byte a byte)
    |                    |                    (5)  cerradaAt !== null ==> OportunidadCerradaError ==> 409
    |                    |                         DESPUES de (4), a proposito: una empresa no elegible
    |                    |                         sobre una oportunidad cerrada recibe 404, nunca 409.
    |                    |                    (6)  todo item.refillItemId in oportunidad.items ?
    |                    |                         no ==> OfertaInvalidaError ==> 400 (validado contra la
    |                    |                         proyeccion, jamas confiado del cliente)
    |                    |                          |
    |                    |                    (7)  |--- buscarCoincidencias(oportunidad.items, companyId) ->|          |
    |                    |                          |   ***FUERA DE TODA TRANSACCION*** (C2/D13/R3).
    |                    |                          |   oportunidad.items YA es RefillItem[]: por eso la
    |                    |                          |   proyeccion guarda nombre/categoria/precioReferencia.
    |                    |                          |   C8: lanza CatalogQueryUnavailableError -> 503, y NO se captura.
    |                    |                          |<-- ProviderCatalogItem[] con precios FRESCOS (D8) ----|
    |                    |                    (8)  sin coincidencia para algun item ==> 400. Techo de precio (D-G.2).
    |                    |                    (9)  total = suma(precios) + costoDespacho   <-- dominio puro
    |                    |                          |
    |                    |                   (10)  runInTransaction (D13) =============================
    |                    |                          |--- save(offer + items, tx) -------------------------------->|
    |                    |                          |    offers.user_id = oportunidad.userId (D1: JAMAS un join
    |                    |                          |    contra refill_requests -- no existe camino sincrono).
    |                    |                          |    status escrito EXPLICITO, nunca el default de la columna.
    |                    |                   ---- COMMIT --------------------------------------------------
    |                    |                          |
    |                    |                   (11)  |--- publish(OfertaEnviada{ ..., refillRequestId }) --------->|
    |                    |                   (12)  |--- sendPush(oportunidad.userId, mensaje) ----- best effort -|
    |<-- 201 OfferResponseDto ----------------------|
```

`enviarOfertaProactiva` tiene la **misma forma**, con tres diferencias: (a) el paso 3 es `existeRelacion(companyId, userId)` y su negativo es `DestinatarioNoElegibleError` → **404** (D10); (b) el paso 7 es `obtenerItemsDeProveedor(companyId, ids)` y el 8 compara **cardinalidades** → `ItemsNoDisponiblesError` → 400 (D-B); (c) no hay oportunidad que consultar ni items de solicitud que validar — `refillRequestId` viaja `null` en el evento.

## Diagrama 3 · `listarSolicitudesElegibles`: la lectura, y lo que NO devuelve

```
 GET /ofertas/oportunidades   @Roles('provider')
   -> ListarSolicitudesElegiblesUseCase        ** NO INYECTA TRANSACTION_MANAGER ** (D13, garantia estructural)
      -> listarPorCompany(actor.companyId)
           select o.refill_request_id, o.comuna, o.urgencia, o.matched_at, i.*
             from offer_opportunity_companies c
             join offer_opportunities o    on o.refill_request_id = c.refill_request_id
             join offer_opportunity_items i on i.refill_request_id = o.refill_request_id
            where c.company_id = $actor.companyId
              and c.vigente              -- D5: el proveedor expulsado desaparece
              and o.cerrada_at is null   -- D12: la oportunidad cerrada desaparece PARA TODOS
              and i.vigente
         -- 1 sola query con join; los items vienen inline, nunca N+1.

      -> SolicitudElegible[]  ... y NO lleva `userId`.
         La cabecera lo tiene (enviarOferta lo necesita para offers.user_id), pero el proveedor
         NO tiene por que conocer el profileId del destinatario antes de ofertar: no lo necesita
         para componer nada, y exponerlo convertiria esta ruta en un enumerador de perfiles.
         Misma disciplina que hizo que `direccion` no viaje en el payload de refill-matching.
```

---

## Wiring de módulos y estructura de archivos

```ts
@Module({
  // CatalogoModule: SEGUNDA arista inter-dominio del repo (la primera la abrio
  // refill-matching). Consume CATALOG_QUERY_PORT, token que CatalogoModule YA
  // exporta. DatabaseModule es redundante (@Global) pero explicito, mismo estilo
  // que los otros 4 dominios.
  imports: [DatabaseModule, CatalogoModule],
  controllers: [OfertasController],
  providers: [
    { provide: OFFER_REPOSITORY, useClass: KyselyOfferRepository },
    { provide: OFFER_OPPORTUNITY_REPOSITORY, useClass: KyselyOfferOpportunityRepository },
    EnviarOfertaUseCase, EnviarOfertaProactivaUseCase, AceptarOfertaUseCase,
    ObtenerBandejaUseCase, ListarSolicitudesElegiblesUseCase,
    RegistrarOportunidadUseCase,          // interno: sin ruta
    MatchEncontradoListener,              // en `providers`: DiscoveryService encuentra @OnEvent igual
  ],
  exports: [],   // D15: sin contracts/, nadie importa de acá
})
export class OfertasModule {}
```

`app.module.ts` **no se toca** (`OfertasModule` ya está importado). `OfertasExceptionFilter` **no** va en `providers`: no tiene dependencias de DI, `@UseFilters` lo instancia — misma decisión que los otros 3 filtros del repo. **Cero dependencias externas nuevas.**

```
domains/ofertas/
├── domain/
│   ├── offer.entity.ts          (factories crearOfertaReactiva/crearOfertaProactiva, isAlt => altNote,
│   │                             total puro, precioPorUnidad puro, maquina de OfferStatus)
│   └── oferta.errors.ts         (las 8 clases de la tabla de errores)
├── ports-in/
│   ├── enviar-oferta.use-case.ts              ── TX + CATALOG_QUERY_PORT (el unico con ambos, R3)
│   ├── enviar-oferta-proactiva.use-case.ts    ── TX + CATALOG_QUERY_PORT
│   ├── aceptar-oferta.use-case.ts             ── TX
│   ├── registrar-oportunidad.use-case.ts      ── TX, interno (+ RegistrarOportunidadInput local)
│   ├── obtener-bandeja.use-case.ts            ── **SIN TRANSACTION_MANAGER** (D13)
│   └── listar-solicitudes-elegibles.use-case.ts ── **SIN TRANSACTION_MANAGER** (D13)
├── ports-out/
│   ├── offer-repository.port.ts               (+3 metodos — D-G.1)
│   └── offer-opportunity-repository.port.ts   (NUEVO — D1/D5)
├── events/
│   ├── oferta-enviada.event.ts + .payload.ts
│   └── oferta-aceptada.event.ts + .payload.ts
├── adapters/
│   ├── http/          ofertas.controller.ts · ofertas.mapper.ts
│   │                  ofertas-exception.filter.ts · dto/*.dto.ts
│   ├── persistence/   kysely-offer.repository.ts             (mapper numeric->number; traduce 23505)
│   │                  kysely-offer-opportunity.repository.ts (el writer de D5)
│   └── events/        refill-matching-event.payloads.ts · match-encontrado.listener.ts
└── ofertas.module.ts

SIN `contracts/`            — D15. Nadie hace lecturas sincronas sobre ofertas todavia.
SIN `adapters/scheduling/`  — D15. 'expirada' sigue sin disparador.
CON `adapters/events/`      — D15/D2.

domains/refill-matching/adapters/events/   (+3 archivos, D7 — unico dominio hermano tocado)
├── ofertas-event.payloads.ts · oferta-enviada.listener.ts · oferta-aceptada.listener.ts
```

## Mapa de transacciones

| Operación | ¿`runInTransaction`? | Sentencias | Razón |
|---|---|---|---|
| **`registrarOportunidad`** | **Sí (D5)** | 1 upsert + 2 update + 2 upsert (máx. 5) | Cruza 3 tablas y el estado intermedio (retire hecho, upsert pendiente) **no debe ser observable**: un lector concurrente vería la solicitud sin ningún elegible |
| **`enviarOferta` / `enviarOfertaProactiva`** | **Sí (D12)** | 1 insert `offers` + 1 insert bulk `offer_items` | Dos escrituras acopladas y una firma que devuelve `Promise<Offer>`: cero canal para reportar parcialidad. **El puerto de `catalogo` queda FUERA** (C2/D13/R3) |
| **`aceptarOferta`** | **Sí (D12)** | 1 select + 1 update + 1 update…returning + 1 update | Aceptar sin desplazar deja dos ofertas vivas; desplazar sin cerrar deja la solicitud en la lista de todos. Es una operación, no tres |
| **`obtenerBandeja`** | **No — estructuralmente** | 1 select con join | Cero escrituras. **No inyecta el token**, y esa ausencia es el test (D13) |
| **`listarSolicitudesElegibles`** | **No — estructuralmente** | 1 select con 2 joins | Ídem |

---

## Row types de Kysely y `@repon/types` (D14, slice 0)

```ts
// shared/database/schema.ts  (+5 row types; DB += las 5 tablas)
export type OfferKindRow   = 'reactiva' | 'proactiva';
export type OfferStatusRow = 'pendiente' | 'aceptada' | 'rechazada' | 'expirada';

export interface OffersTable {
  id: Generated<string>; user_id: string; refill_request_id: string | null;
  company_id: string; kind: OfferKindRow;
  status: Generated<OfferStatusRow>;   // tiene default -> Generated. El adaptador lo escribe
                                       // SIEMPRE explicito (misma regla que refill_requests.estado).
  tiempo_entrega_horas: number;        // integer -> number (pg SI parsea int4)
  costo_despacho: string; total: string;   // numeric(12,2) -> STRING
  mensaje: string | null;
  created_at: Generated<string>; updated_at: Generated<string>;
}

export interface OfferItemsTable {
  id: Generated<string>; offer_id: string;
  refill_item_id: string | null; provider_catalog_item_id: string | null;  // dual-nullable, CHECK en la 05
  is_alt: Generated<boolean>;
  alt_size: string | null; alt_qty: string | null;   // numeric -> STRING, y ademas nullable
  alt_note: string | null; precio: string;           // numeric -> STRING
  created_at: Generated<string>;                     // sin updated_at: offer_items es inmutable
}

export interface OfferOpportunitiesTable {
  refill_request_id: string;           // PK provista por el caller -> sin Generated
  user_id: string; comuna: string;
  urgencia: RefillUrgenciaRow;         // `text` en Postgres (D-A.1), tipado acá con la MISMA union TS
  matched_at: Generated<string>; cerrada_at: string | null;
  created_at: Generated<string>; updated_at: Generated<string>;
}

export interface OfferOpportunityCompaniesTable {
  refill_request_id: string; company_id: string;
  vigente: Generated<boolean>;
  created_at: Generated<string>; updated_at: Generated<string>;
}

export interface OfferOpportunityItemsTable {
  refill_item_id: string;              // PK provista por el caller
  refill_request_id: string; nombre: string; categoria: string;
  precio_referencia: string;           // numeric(12,2) -> STRING. NOT NULL (ver abajo)
  catalog_product_id: string | null;
  vigente: Generated<boolean>;
  created_at: Generated<string>; updated_at: Generated<string>;
}
```

> ### El gotcha de `numeric` sigue vigente — pero `Number(null) === 0` **no aplica acá**, y hay que decir por qué
>
> `costo_despacho`, `total`, `precio`, `alt_size`, `alt_qty` y `precio_referencia` vuelven del driver como **`string`** (OID 1700). La conversión vive en el mapper del adaptador, **nunca** en el row type.
>
> La diferencia con `refill-matching`: allá `precio_referencia` era **nullable**, y `Number(null) === 0` reintroducía en silencio el centinela que su D3 rechazaba. Acá `offer_opportunity_items.precio_referencia` y `.categoria` son **NOT NULL**, porque `MatchEncontrado` solo se publica sobre solicitudes activas y `RefillRequestActiva` garantiza ambos campos. **`Number(row.precio_referencia)` es seguro en esta tabla, y lo es por el contrato del evento, no por suerte.**
>
> Donde sí hay que tener cuidado es en `offer_items.alt_size`/`alt_qty`, que **sí** son nullable: `altSize: row.alt_size === null ? undefined : Number(row.alt_size)`, jamás `Number(row.alt_size)` a secas.

```ts
// packages/types/src/ofertas.ts  (aditivo; Offer/OfferItem SIN cambios)
export type NuevoOfferItemReactiva  = OfferItemPricing & OfferItemAlt & { refillItemId: string; providerCatalogItemId?: never };
export type NuevoOfferItemProactiva = OfferItemPricing & OfferItemAlt & { providerCatalogItemId: string; refillItemId?: never };
/** Alias de `OfferItem` NO: hoy son estructuralmente identicos, y un alias
 *  convertiria la primera divergencia (p. ej. `cantidad`) en un rename
 *  breaking en vez de un campo nuevo. Tipo nombrado propio, como pide el spec. */
export type NuevoOfferItem = NuevoOfferItemReactiva | NuevoOfferItemProactiva;

export interface DatosEntrega { tiempoEntregaHoras: number; costoDespacho: number; }

export interface SolicitudElegibleItem {
  refillItemId: string; nombre: string; categoria: string;
  precioReferencia: number; catalogProductId?: string;
}
export interface SolicitudElegible {
  refillRequestId: string; comuna: string;
  urgencia: Urgencia;        // importado de './refill-matching.js', NUNCA re-declarado
  matchedAt: string;
  items: SolicitudElegibleItem[];
  // sin `userId`, a proposito — Diagrama 3.
}
```

`RegistrarOportunidadInput`/`OportunidadElegible` **no** van a `@repon/types`: ningún `SPEC.md` los nombra, así que siguen el camino de `NuevaMascotaInput`/`CompletarRefillItemInput` y se declaran dentro de su propio `ports-in/`/`ports-out/`. **D14 se queda exactamente en 3 incorporaciones.**

---

## Secuencia de implementación (8 PRs encadenados)

Cada PR deja `main` verde. Bajo **D18 (strict TDD, sin excepciones)**, cada uno arranca por sus tests. `ofertas.module.ts` crece **incrementalmente**; el PR 8 es la auditoría final, no el primer cableado.

| PR | Slice | Contenido | Por qué acá |
|---|---|---|---|
| **1** | 0 · groundwork | Migración `16` (D-A); 5 row types + `DB` (D14); los 3 tipos de `@repon/types`; `OfferRepository` en su forma final (D-G.1) + `OfferOpportunityRepository`; `domain/oferta.errors.ts` | Cero comportamiento, puras costuras. Una tabla mal puesta con 6 casos de uso encima ya no es gratis |
| **2** | 1 · dominio | Factories, `isAlt ⇒ altNote`, `total`, `precioPorUnidad`, máquina de `OfferStatus` (incluida la regla de D-G.3) | Jest puro, sin contenedor Nest |
| **3** | 2 · persistencia | `KyselyOfferRepository` (6 métodos, mapper `numeric`, traducción del `23505`) + `KyselyOfferOpportunityRepository` (**el writer de D5**) | El PR con la mecánica más delicada del cambio: el orden retire→upsert |
| **4** | 3 · descubrimiento | `RegistrarOportunidadUseCase` + payload local + `MatchEncontradoListener` + `ListarSolicitudesElegiblesUseCase` + `GET /ofertas/oportunidades` | **Antes** de la creación: la elegibilidad de `enviarOferta` lee esta tabla. Cierra 2 de los 5 negativos de D18 |
| **5** | 4 · creación | `EnviarOfertaUseCase` (**el orden de C2 + su test de D-C**), 404 de D11, controller + filter + DTOs, `OfertaEnviada`, push | **El PR que más merece review dedicada**: cierra R2 y R3 |
| **6** | 5 · proactiva | Delta de `CatalogQueryPort` (D-B) + su adaptador; `EnviarOfertaProactivaUseCase` con D10 | **El único PR que toca `catalogo`** — se aísla para que ese diff sea de una sola lectura (R8) |
| **7** | 6 · aceptación | `AceptarOfertaUseCase` (tx + displacement + cierre), 409 del índice único, `OfertaAceptada`, `ObtenerBandejaUseCase` + `GET /ofertas/bandeja` | Necesita la proyección (para cerrar) y las ofertas (para desplazar) |
| **8** | 7 · cableado | 2 listeners + payloads locales en `refill-matching` (D7); los 2 e2e de contrato con `await moduleRef.init()`; los deltas de SPEC.md; auditoría del módulo | Último a propósito: es el único diff dentro de un dominio hermano, y se quiere legible sin ruido de `ofertas` alrededor |

**Presupuesto de review (R11)**: los PRs 1, 4, 5 y 7 son los pesados; **el 4 es el candidato #1 a partirse** en 4a (writer + listener) y 4b (lectura + ruta), porque son dos caminos independientes. La decisión final de PRs encadenados la toma `sdd-tasks` bajo `delivery_strategy`, no este documento.

---

## Estrategia de testing (D18: todo esto se escribe primero)

| Capa | Qué se prueba | Cómo | ¿CI? |
|---|---|---|---|
| Unit | **D18-1**: proveedor no elegible → `enviarOferta` → `SolicitudNoElegibleError`; solicitud inexistente → **el mismo error, byte a byte** (404, nunca 403) | Ports mockeados | Sí |
| Unit | **D18-2**: usuario A → `aceptarOferta` sobre oferta de B → `OfferNotFoundError`; offerId inexistente → **el mismo error** | Mocks | Sí |
| Unit | **D18-3**: `OfertaEnviada` con `refillRequestId: null` → el listener **no** llama a `MarcarComoOfertada` | Listener + mock | Sí |
| Unit | **D18-4**: segundo `MatchEncontrado` con menos empresas → el writer emite el `UPDATE vigente=false` **antes** del upsert, y B queda fuera | Repo mockeado / query builder | Sí |
| Unit | **D18-5**: los **3** listeners capturan y loguean; el handler resuelve aunque el caso de uso lance | Mocks | Sí |
| Unit | **R3 / Q7**: `buscarCoincidencias` **resuelve antes** de que `runInTransaction` se invoque (log de resolución, D-C) | Mocks ordenados | Sí |
| Unit | `ObtenerBandejaUseCase` y `ListarSolicitudesElegiblesUseCase` **no inyectan `TRANSACTION_MANAGER`** (D13) | Inspección del constructor (`self:paramtypes`) | Sí |
| Unit | Oportunidad **cerrada** → 409, y ese 409 es **inalcanzable** para una empresa no elegible (orden de chequeos) | Mocks | Sí |
| Unit | Oferta **proactiva** aceptada: **no desplaza nada, no cierra nada**; `desplazadas: []` | Mocks | Sí |
| Unit | `obtenerItemsDeProveedor` devuelve menos ids de los pedidos → `ItemsNoDisponiblesError`, **nunca** una oferta más chica | Puerto mockeado | Sí |
| Unit | `CatalogQueryUnavailableError` **no se captura** y el filtro lo mapea a 503 | Puerto que lanza | Sí |
| Unit | `MatchEncontrado` con `companyIds: []` → cabecera escrita, cero elegibles | Mocks | Sí |
| Unit | El writer **no toca `cerrada_at`** en el `DO UPDATE SET` (D-A.3) | Query builder mockeado | Sí |
| Adaptador | El `23505` del índice único se traduce a `OfertaYaAceptadaError`; cualquier otro error se re-lanza | Driver mockeado | Sí |
| Adaptador | `alt_size`/`alt_qty` `NULL` sobreviven el round-trip como `undefined`, **jamás como `0`** | Mocks | Sí |
| Integración (opt-in) | El reemplazo real contra Postgres: `[A,B]` → `[A]` deja a B no legible; re-corrida idéntica no duplica filas; **ninguna sentencia `DELETE`** en todo el dominio | `supabase start` | No |
| E2E | 401 sin token; 403 sin rol `provider` en las 3 rutas de proveedor; **404 cross-tenant** en `aceptar` y `enviar`; 409 en oportunidad cerrada; 400 de DTO; **503** con el puerto caído; **no existe ruta que alcance `registrarOportunidad`** | `supertest` + `ACTOR_PORT`/`JWT_VERIFIER` sobreescritos | Sí |
| E2E contrato | Un `MatchEncontrado` **real** por el bus real crea la fila de oportunidad; un `OfertaEnviada`/`OfertaAceptada` **real** lleva `refill_requests.estado` a `'ofertada'`/`'confirmada'`. **Con `await moduleRef.init()`**, no solo `.compile()` — sin `init()` el `@OnEvent` no se registra y el test pasa sin probar nada (bug real de `catalogo` PR8b) | `moduleRef.init()` | Sí |
| Regresión | Suites completas de `identidad`, `catalogo`, `consumo` y `refill-matching` verdes. `catalogo` importa especialmente: D-B lo toca | Sin cambios | Sí |

---

## Riesgos residuales y preguntas abiertas

Los 11 de la proposal siguen vigentes. Lo que este documento agrega o precisa:

- [x] ~~La divergencia de `@Roles` en las 2 rutas de usuario (D-E) contradice un spec aprobado y necesita visto bueno explícito.~~ **Resuelto**: el usuario decidió mantener `@Roles('user')`. Limitación declarada: un perfil `provider` que también es dueño de mascota no puede aceptar sus propias ofertas ni ver su bandeja — pendiente de comunicar a producto (no es un defecto de este cambio).
- [ ] **Un ítem `isAlt` no tiene techo de precio server-side** (D-G.2). El techo de `precio_maximo` solo se aplica a ítems no-alt, porque la presentación difiere de la línea de catálogo. Cerrarlo exige normalizar presentaciones: es su propio cambio de producto.
- [ ] **`urgencia` como `text` acepta cualquier string a nivel de base de datos** (D-A.1). Mitigado en el único camino de escritura (el payload local lo tipa como `Urgencia`), inerte si falla (la columna no gobierna ninguna decisión). El día que la lista se filtre por urgencia, esto se revisa.
- [ ] **La ventana residual de R1 sigue abierta**: matcheado → suspendido → sin re-corrida. D5 la cierra en la re-corrida y D8 en el momento de ofertar (cero coincidencias ⇒ oferta incomponible), pero la solicitud **sigue apareciendo en la lista** del proveedor suspendido hasta la próxima corrida. Salida nombrada, no construida: escuchar `EmpresaSuspendida` y apagar `vigente` — aditivo, un listener más.
- [ ] **Cerrar la oportunidad es monótono y no hay forma de reabrirla** (D-A.3). Si un pedido se cancela en `pedidos-pagos`, la solicitud **no** vuelve a la lista de proveedores. Es lo correcto hoy (`pedidos-pagos` no existe) y es exactamente la conversación que ese cambio va a tener que abrir.
- [ ] **`desplazarHermanas` desplaza las de TODAS las empresas, incluidas otras `'pendiente'` de la misma empresa** — consecuencia directa de Q6 (varias ofertas de un mismo proveedor conviven). Coherente con `SPEC.md` ("todas las demás ofertas `'pendiente'` que compartan el mismo `refillRequestId`"), pero conviene que producto lo vea escrito.
- [ ] **No hay push al proveedor cuando le aceptan** (D-G.4): `sendPush` toma un `profileId` y este dominio solo tiene `companyId`. Resolverlo exige un contrato nuevo contra `identidad`. Es trabajo de `pedidos-pagos` según `docs/ARCHITECTURE.md`.
- [ ] **`findByRefillRequest` queda declarado y sin caller** (D-G.1). Se conserva porque está en `SPEC.md`; se declara para que nadie lo interprete como olvido.
- [ ] **`tx` requerido en 4 métodos rompe la convención `tx?` del repo** (D-G.5). Endurecimiento deliberado y acotado a las operaciones cuya corrección **es** la atomicidad. Si molesta, revertirlo es agregar un `?`.
- [ ] **R7 se agrava con este documento**: `OfertaAceptada` ahora lleva `total` y `desplazadas`, y `pedidos-pagos` va a necesitar los **ítems** para el snapshot inmutable de `order_items`. La salida está nombrada en D15 (un `contracts/` sobre `ofertas` o un payload más gordo), las dos aditivas.
- [ ] **El `UPDATE` en bloque del writer toca filas que se reinstalan dos sentencias después.** Acotado a una solicitud e indexado por el prefijo de la PK; se acepta a cambio de que la idempotencia y el shrinking caigan del mismo mecanismo, sin ramas especiales.

---

## Reconciliación con `specs/` (para `sdd-tasks`)

`sdd-spec` corrió antes y dejó **3 puntos explícitamente provisorios** para esta fase. Las divergencias, con quién gana y por qué:

| # | `specs/` dice | `design.md` dice | Gana | Motivo |
|---|---|---|---|---|
| 1 | `db-schema-ofertas`: mecanismo del reemplazo **provisional** (`vigente` \| `retirado_at` \| `matched_at` versionado) | **`vigente boolean`** + retire-blanket-then-upsert, 5 sentencias, `cerrada_at` excluido del `SET` | **design** (el spec defiere) | Precedente literal de `catalog_hidden_companies.oculto`; `matched_at` versionado usa un timestamp como identidad de generación |
| 2 | `db-schema-ofertas`: `urgencia` **provisional** (enum reusado \| `text`) | **`text`**, sin `CHECK` | **design** (el spec defiere) | Reusar el enum de otro dominio es la FK de D4 con otra sintaxis |
| 3 | `core-api-catalogo`: firma **provisional** `obtenerItemsDeProveedor(companyId, ids)` | **Confirmada**, + `readonly string[]`, + filtra `disponible` y visibilidad adentro, + sin tope propio, + `[]` sin round-trip | **design** (el spec defiere) | Ver D-B |
| 4 | `core-api-ofertas`: `aceptarOferta`/`obtenerBandeja` con **`@Roles('user')`** | Propuesta original: sin `@Roles()`. **Revertida tras decisión del usuario** | **specs** (decisión confirmada) | El design.md documentó la evidencia (RLS sin chequeo de rol, lockout de un `provider` con mascota); el usuario la revisó y eligió mantener el spec. Limitación resultante declarada en §D-E, pendiente de comunicar a producto |
| 5 | `core-api-ofertas`: no fija el código de éxito de `aceptarOferta` | **204 sin cuerpo** | **design agrega** | `SPEC.md` declara `Promise<void>`; precedente `PUT .../precio` → 204 |
| 6 | `core-api-ofertas`: no cubre aceptar una oferta que no está `'pendiente'` | **409 `TRANSICION_INVALIDA`** | **design agrega** | Sin regla, aceptar dos veces la misma oferta sería un no-op silencioso (D-G.3) |
| 7 | `core-api-ofertas`: 404 de elegibilidad y 409 de oportunidad cerrada, sin orden entre ellos | **Elegibilidad (404) SIEMPRE antes que cerrada (409)** | **design agrega** | Un 409 sobre una solicitud para la que nunca fuiste elegible confirmaría su existencia (D11) |
| 8 | `db-schema-ofertas`: "no extra domain column" | `vigente` + `created_at`/`updated_at` | **compatible, se declara** | `vigente` es el mecanismo que la requirement hermana autoriza; los timestamps son convención de las 15 tablas |
| 9 | `shared-types-package`: `NuevoOfferItem` "structurally identical today" | **Tipo nombrado propio**, no un alias de `OfferItem` | **design precisa** | Un alias convertiría la primera divergencia en un rename breaking |
| 10 | Ningún spec cubre qué hace `enviarOferta` con el resultado del puerto | El proveedor cotiza; el puerto **autoriza y acota** (regla dura + techo para no-alt) | **design agrega** | D-G.2. Sin esto, `NuevoOfferItem.precio` y `isAlt` no tienen semántica |

Ninguna divergencia cambia un escenario aprobado salvo la **#4**, que es la única que necesita decisión. Las demás rellenan huecos que los specs dejaron abiertos a propósito. `sdd-tasks` debe tomar `design.md` como fuente para las 10 filas y emitir los ajustes de prosa correspondientes sobre `specs/`.
