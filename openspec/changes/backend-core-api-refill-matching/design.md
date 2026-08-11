# Design: `refill-matching` — cuarto vertical, primer consumidor de un `contracts/` ajeno y primera entidad con estado incompleto

Cierra las **6 preguntas** que `proposal.md` difirió a esta fase (**Q1–Q6**) y fija el cableado que `ofertas` y `pedidos-pagos` van a copiar: cómo se declara una entidad que existe antes de estar completa, cómo se consume un contrato cross-dominio sin abrir una transacción encima, y cómo se fija el payload de un evento cuyo consumidor todavía no existe.

No re-abre D1–D17. No define escenarios Given/When/Then (eso es `sdd-spec`, que corrió en paralelo sobre la misma proposal). `sdd-spec` terminó mientras se escribía esto y tomó elecciones **provisorias declaradas como tales** en Q5 y Q6; las divergencias están tabuladas en **§Reconciliación con `specs/`**, al final, para que `sdd-tasks` no las descubra sola. Diagramas en ASCII: convención existente del repo (`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, los `design.md` de la fundación, de `catalogo` y de `consumo`); no hay mermaid en ninguna parte.

## Qué cierra este documento

| Sección | Cierra | Respuesta en una línea |
|---|---|---|
| **D-A** | **Q1** — forma de la migración | **DOS migraciones, y es una restricción de corrección, no de estilo**: Postgres prohíbe *usar* un valor de enum agregado en la misma transacción que lo agregó, y el batch 15 lo usa (índice parcial de D-D). Batch 14 = `ADD VALUE 'borrador' BEFORE 'abierta'`, solo. Batch 15 = las 4 columnas nullable + `consumption_id` + el índice |
| **D-B** | **Q2** — unión discriminada | Se preserva **`RefillItem` con su forma EXACTA de hoy** como el ítem *completo* y nace `RefillItemBorrador` al lado. Sin eso, la firma congelada de `CatalogQueryPort` deja de compilar y `catalogo` habría que tocarlo — contra un criterio de éxito explícito. Efecto colateral: **"un borrador nunca entra al matching" pasa a ser un error de compilación**, no solo un chequeo en runtime |
| **D-C** | **Q3** — payloads | **Solo referencias, nunca snapshots de `ProviderCatalogItem`**: publicarlos sería publicar el vocabulario de `catalogo`, exactamente lo que la regla de D-D de `consumo` prohíbe. Los dos eventos son **autosuficientes** (comparten `RefillSolicitudPayload`) para que `ofertas` no dependa del orden de llegada. `RefillCreado` marca la **entrada a `'abierta'`**, no el insert de la fila |
| **D-D** | **Q4** — ciclo de vida del borrador | **El borrador NO expira** — el único mecanismo posible es un job programado y **D8 lo prohíbe explícitamente** para este dominio. **Sí se agrega `consumption_id`** (columna + campo + índice parcial único): declarado como cambio ADICIONAL más allá de D3/D4. Dedup = *skip* si ya hay un borrador abierto de ese consumo, porque los dos borradores serían **byte a byte idénticos** |
| **D-E** | **Q5** — superficie HTTP | 3 rutas, prefijo `refill`, `mis-solicitudes`, cero `@Roles()`. **`listarMisSolicitudes` NO se construye**: no está en `SPEC.md` y el listado owner-only ya lo sirve la lectura directa por RLS que la migración `04` habilitó — mismo camino que `consumo`. El matching es **`POST`, no `GET`**: publica un evento, así que no es seguro ni idempotente |
| **D-F** | **Q6** — matching sobre un borrador | **409 `REFILL_REQUEST_EN_BORRADOR`**, clase `SolicitudEnBorradorError`. 404 sería mentira (el recurso existe y es tuyo) y colisionaría con el 404 de D13, volviéndolos indistinguibles |
| **D-G** | Vacíos que ninguna Q nombró | El listener **no puede** llamar a `crearSolicitud` → nace un 6º caso de uso interno. `RefillRepository` necesita 2 métodos más. `RefillCreado` **no puede** llevar proveedores compatibles bajo D15 — `SPEC.md` afirma lo contrario y hay que corregirlo |
| §Diagramas | Los 3 flujos con forma propia | `crearSolicitud` transaccional, matching fuera de toda transacción, listener → borrador |
| §Wiring · §HTTP · §Transacciones · §Migraciones · §Secuencia | Detalle que `sdd-tasks` necesita | Providers, rutas, quién abre transacción, DDL exacto, 7 PRs encadenados |

---

## D-A · Forma exacta de la migración (Q1)

**Choice**: **dos migraciones**, `14` y `15`, en la misma ventana de timestamps del día siguiente a la última aplicada (`20260806120000_13_…`) — mismo patrón de "dos slots el mismo día" que ya usaron `09`/`10` y `11`/`12`.

### Por qué dos y no una: es Postgres, no gusto

Este era el sub-punto que parecía cosmético y no lo es. Desde PostgreSQL 12, `ALTER TYPE … ADD VALUE` **sí** puede correr dentro de un bloque transaccional, pero el valor recién agregado **no puede usarse hasta que esa transacción commitee** (`ERROR: unsafe use of new value "borrador" of enum type refill_estado`). El runner de migraciones de Supabase aplica **cada archivo dentro de una transacción**.

El batch 15 **usa** `'borrador'`: el índice parcial único de D-D lo lleva en su predicado (`where estado = 'borrador'`). En un solo archivo, la migración falla al aplicarse. No es un riesgo teórico ni una precaución: es un error de arranque el primer día.

Y aunque el índice no existiera, la separación sigue siendo la elección correcta: deja el archivo del enum con **exactamente una sentencia**, trivialmente revisable, e inmune a que una edición futura le agregue un CHECK, un default o un backfill que referencie el valor nuevo. La regla queda escrita en la cabecera del batch 14 para que nadie la re-descubra.

### Posición del valor: `BEFORE 'abierta'`

```sql
alter type public.refill_estado add value 'borrador' before 'abierta';
```

La posición **solo** afecta comparación, `ORDER BY`, `MIN`/`MAX` y `enum_range()`; la corrección de las igualdades no cambia. Por eso mismo es barato elegir bien:

| | **`BEFORE 'abierta'`** | Al final (append) |
|---|---|---|
| Orden resultante | `borrador < abierta < ofertada < confirmada` | `abierta < ofertada < confirmada < borrador` |
| ¿Coincide con el ciclo de vida? | **Sí** | **No — lo invierte** |
| `ORDER BY estado` | Orden de avance del ciclo | Pone el estado más temprano al final |
| `where estado >= 'abierta'` | Se lee literalmente como "ya es matchable" (el predicado de D3) | No significa nada |
| `pg_dump` / un futuro squash | `create type … as enum ('borrador','abierta','ofertada','confirmada')` — legible | Lista desordenada respecto del ciclo |
| Costo | O(1), sin reescritura de tabla | Idéntico |

Se elige `BEFORE`. Un `ORDER BY estado` escrito dentro de dos años no tiene por qué ser una trampa cuando evitarla es una palabra.

**Sin `IF NOT EXISTS`**: ninguna migración del repo usa DDL idempotente (`create type … as enum` a secas en `00`/`04`); el runner ya garantiza aplicación única y agregarlo acá rompería el estilo sin comprar nada.

### Batch 14 (completo)

```sql
-- Batch 14 -- refill-matching: cuarto valor del enum refill_estado.
-- Delta declarado sobre db-schema-refill-matching (backend-core-api-refill-matching
-- D3 / design.md D-A). Solo seccion 1 del layout estandar: cero tablas, cero RLS.
--
-- ESTE ARCHIVO CONTIENE UNA SOLA SENTENCIA, A PROPOSITO. Desde PG12 un
-- `ALTER TYPE ... ADD VALUE` puede correr dentro de una transaccion, pero el
-- valor agregado NO puede USARSE hasta que esa transaccion commitee
-- (`unsafe use of new value ... of enum type`), y el runner de Supabase aplica
-- cada archivo en una transaccion. El batch 15 usa 'borrador' en el predicado
-- de un indice parcial, asi que DEBE ser un archivo aparte. No agregar aca
-- ningun CHECK, default, backfill ni indice que referencie el valor nuevo.
--
-- BEFORE 'abierta' y no al final: la posicion en el enum define el orden de
-- comparacion y de ORDER BY. 'borrador' precede a 'abierta' en el ciclo de
-- vida, asi que ponerlo antes hace que el orden de Postgres coincida con el
-- del dominio y que `estado >= 'abierta'` se lea como "ya es matchable".
-- No es reversible: quitar un valor de un enum exige recrear el tipo (R8).

alter type public.refill_estado add value 'borrador' before 'abierta';
```

### Batch 15 (completo)

```sql
-- Batch 15 -- refill-matching: completitud diferida (D4) + clave de
-- correlacion del borrador automatico (design.md D-D).
-- Delta declarado sobre db-schema-refill-matching. Depende del batch 14 YA
-- COMMITEADO: el indice de la seccion 4 usa el valor 'borrador'.
-- Secciones 2 y 4 del layout estandar: cero tablas nuevas, cero enums, cero RLS.

-- ============================================================
-- 2. Tables (relajacion de NOT NULL + columna de correlacion)
-- ============================================================
alter table public.refill_requests
  alter column direccion drop not null,
  alter column comuna    drop not null,
  add  column consumption_id uuid;

alter table public.refill_items
  alter column categoria         drop not null,
  alter column precio_referencia drop not null;

comment on column public.refill_requests.direccion is
  'Nullable desde el batch 15 (backend-core-api-refill-matching D3/D4). NULL solo es legal mientras estado = ''borrador'': el sistema no tiene de donde leer una direccion cuando consumo dispara RefillAutoSolicitado (profiles no tiene ninguna columna de direccion en ninguna migracion). La completitud se enforcea en la transicion ''borrador'' -> ''abierta'', en el caso de uso, NO en Postgres -- un CHECK no es expresable porque la completitud de los items es cross-tabla. Mismo encuadre literal que ofertas/SPEC.md ya usa para offers.user_id ("Regla enforceada aqui, no en Postgres").';
comment on column public.refill_requests.comuna is
  'Nullable desde el batch 15 (D3/D4), misma regla que direccion. CORRECCION DECLARADA (D9) del comentario original: el matching NO corre en una Edge Function -- corre en core-api via buscarProveedoresCompatibles + CatalogQueryPort. Y en este cambio NO se filtra por comuna (D1): la columna se persiste desde el dia 1 para que el filtro futuro sea aditivo, pero el matching es nacional.';
comment on column public.refill_requests.consumption_id is
  'Clave de correlacion hacia consumo.user_consumption.id, recibida en el payload de RefillAutoSolicitado (design.md D-D). NULL para toda solicitud creada manualmente. SIN FOREIGN KEY a proposito: es una clave que llega por el bus de eventos, no una relacion que este dominio posea o pueda validar; una FK haria fallar la escritura de refill-matching por el estado de una tabla ajena y se rompe el dia que consumo se extraiga a su propio servicio. Deliberadamente distinto de refill_items.catalog_product_id, que SI es FK porque el usuario elige ese producto y catalogo se consulta sincronicamente por contrato.';
comment on column public.refill_items.categoria is
  'Nullable desde el batch 15 (D3/D4). NULL solo es legal en un item de una solicitud en ''borrador'': UserConsumption no tiene categoria (tiene kind, un enum de otro vocabulario) y consumo se niega explicitamente a mapear kind -> categoria porque no tiene autoridad sobre el vocabulario del catalogo. Se rechazo el centinela categoria = '''': produce una solicitud que parece valida, entra al matching y no matchea nada -- falla silenciosa.';
comment on column public.refill_items.precio_referencia is
  'Nullable desde el batch 15 (D3/D4). Se rechazo el centinela precio_referencia = 0 por el mismo motivo que categoria = ''''. OJO en el mapper: node-postgres devuelve numeric como string, y Number(null) === 0 -- una conversion ingenua reintroduce exactamente el centinela que esta decision rechaza (design.md, callout de row types).';

-- ============================================================
-- 4. Indexes
-- ============================================================
-- Invariante de D-D.2 expresada en Postgres, no solo en el caso de uso: como
-- maximo UN borrador abierto por (usuario, consumo). El caso de uso igual hace
-- el read-and-skip para que el camino normal sea un no-op limpio; este indice
-- es la red que cubre el TOCTOU de dos eventos concurrentes. Mismo patron de
-- indice parcial unico que provider_catalog_company_catalog_product_uidx
-- (batch 11). Usa 'borrador': por eso este archivo NO puede fusionarse con el
-- batch 14 (ver su cabecera).
create unique index refill_requests_borrador_por_consumo_uidx
  on public.refill_requests (user_id, consumption_id)
  where estado = 'borrador' and consumption_id is not null;
```

**Tres cosas que estas migraciones NO necesitan, verificadas:**

- **Sin grant nuevo.** `20260804090500_10_…` ya corre `grant select, insert, update on public.refill_requests to service_role` y lo mismo para `refill_items`; los grants a nivel de tabla cubren columnas agregadas después.
- **Sin cambio de RLS.** `refill_requests_authenticated_select_own` y la política `EXISTS` de `refill_items` son agnósticas de columnas. Un usuario pasa a poder leer `consumption_id` **de sus propias filas** — es su propio dato.
- **Sin tocar `20260803120400_04_refill_matching.sql`.** Fix-forward, D9. Sus comentarios stale se corrigen en el spec y en los `comment on column` de arriba, nunca editando el archivo aplicado.

### Micro-decisión declarada: el default `'abierta'` se queda

`refill_requests.estado` conserva `default 'abierta'`. Bajo D3 ese default pasa a ser **fail-open**: un insert que omitiera `estado` produciría una solicitud matchable en vez de fallar. Cambiarlo a `'borrador'` sería fail-closed pero contradice la migración `04` y `db-schema-refill-matching`, y ninguno de los dos está en scope. **Se neutraliza por construcción**: `KyselyRefillRepository` escribe `estado` **siempre explícito**, nunca se apoya en el default — garantía verificable leyendo el insert. Queda anotado en Riesgos residuales.

---

## D-B · Forma exacta de la unión discriminada (Q2)

**Choice**: `RefillItem` **conserva su forma exacta de hoy** y pasa a significar "ítem completo"; nace `RefillItemBorrador` al lado; `RefillRequest` se vuelve una unión discriminada sobre `estado` que **estrecha el tipo del array de ítems** en cada variante — exactamente la forma de `Offer`.

### El hallazgo que decide el nombre de los tipos

La opción obvia era `RefillItem = RefillItemBorrador | RefillItemCompleto`. **Rompe `catalogo`.**

`catalogo/contracts/catalog-query.port.ts` declara `buscarCoincidencias(itemsSolicitados: RefillItem[], companyId?)` e importa `RefillItem` de `@repon/types`. Si `RefillItem` pasa a ser una unión con `categoria?: string`, el puerto **congelado** (C1–C8, archivado) cambia de significado y `KyselyCatalogQueryAdapter` deja de compilar. Arreglarlo exige editar `catalogo`, contra el criterio de éxito literal *"`catalogo` no se modifica en ningún archivo de este cambio"*, y contra la firma de un contrato que ya se cerró.

La alternativa "cambiar la firma del puerto a `RefillItemCompleto[]`" es peor: es un delta sobre un `contracts/` archivado, que es precisamente lo que D1 evitó al diferir el matching por zona.

Así que el tipo que ya existe se queda quieto y el tipo nuevo es el del borrador. El nombre `RefillItem` sigue significando lo mismo que significaba: **un ítem matchable**.

### Lo que eso compra, y es lo mejor de esta decisión

`RefillItemBorrador[]` **no es asignable** a `RefillItem[]` (`categoria?: string` no es asignable a `categoria: string`). Y como la variante borrador de `RefillRequest` estrecha `items` a `RefillItemBorrador[]`, **pasar los ítems de un borrador a `buscarCoincidencias` es un error de compilación**.

D3 dice "una solicitud en `'borrador'` **nunca** aparece en el matching". Bajo esta forma eso deja de ser un chequeo en runtime que alguien puede olvidar y pasa a ser una propiedad del sistema de tipos. El 409 de D-F sigue existiendo — es el contrato observable por HTTP —, pero ya no es la única defensa.

### La forma exacta

```ts
// packages/types/src/refill-matching.ts

/** D11: hoy es una unión inline dentro de RefillRequest. Se promueve a tipo
 *  nombrado porque `crearSolicitud` la recibe como parámetro y los eventos la
 *  publican — es vocabulario DE ESTE dominio (consumo se niega, con razón, a
 *  publicarla en sus propios payloads). */
export type Urgencia = 'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias';

/** D3/D11. 'borrador' va primero, en el mismo orden que el enum de Postgres
 *  después del batch 14 (D-A) — el tipo y el enum se leen igual. */
export type RefillEstado = 'borrador' | 'abierta' | 'ofertada' | 'confirmada';

/** Los 3 estados en los que la solicitud está completa y es matchable.
 *  `Exclude<>` y no una segunda lista literal: una sola fuente de verdad, y
 *  agregar un 5º estado obliga a decidir de qué lado cae. */
export type RefillEstadoActivo = Exclude<RefillEstado, 'borrador'>;

interface RefillItemCommon {
  id: string;
  nombre: string;
  /** Opcional por diseño (Q4, `db-schema-refill-matching`): el usuario puede
   *  pedir un producto que no está en `catalog_products`. */
  catalogProductId?: string;
}

/**
 * Ítem COMPLETO — el único que el matching acepta. Su forma es byte a byte la
 * de hoy, a propósito: `CatalogQueryPort.buscarCoincidencias(itemsSolicitados:
 * RefillItem[])` está congelado (C1–C8) y `catalogo` no se toca en este cambio.
 */
export interface RefillItem extends RefillItemCommon {
  categoria: string;
  precioReferencia: number;
}

/**
 * Ítem de una solicitud en 'borrador' (D3/D4). `categoria`/`precioReferencia`
 * son OPCIONALES, no `?: never`: la columna es nullable y sin CHECK, así que
 * la fila puede legalmente llevar valor, y un tipo incapaz de representar una
 * fila legal obliga al mapper a perder datos en silencio. `?: never` se
 * reserva para exclusividad estructural real — ver abajo.
 * `RefillItem` SÍ es asignable a este tipo (un ítem completo es un borrador
 * válido); la dirección peligrosa está bloqueada.
 */
export interface RefillItemBorrador extends RefillItemCommon {
  categoria?: string;
  precioReferencia?: number;
}

interface RefillRequestCommon {
  id: string;
  userId: string;
  urgencia: Urgencia;
  /** Clave de correlación hacia `consumo` (design.md D-D). Presente solo en
   *  las solicitudes nacidas de `RefillAutoSolicitado`; sobrevive a la
   *  transición a 'abierta', por eso vive acá y no en la variante borrador. */
  consumptionId?: string;
}

export type RefillRequestBorrador = RefillRequestCommon & {
  estado: 'borrador';
  items: RefillItemBorrador[];
  direccion?: string;
  comuna?: string;
};

export type RefillRequestActiva = RefillRequestCommon & {
  estado: RefillEstadoActivo;
  items: RefillItem[];
  direccion: string;
  comuna: string;
};

/**
 * Discriminada sobre `estado`, mismo patrón que `Offer` sobre `kind`:
 * interfaz `Common` + variantes por intersección + el array hijo estrechado
 * por variante (`items: RefillItemReactiva[]` allá, `items: RefillItem[]`
 * acá). `if (r.estado === 'borrador')` narrowea a la variante borrador; el
 * `else` narrowea a la activa, y ahí `direccion`/`comuna` son `string` y
 * `items` es `RefillItem[]` — sin un solo `!` ni cast en todo el dominio.
 */
export type RefillRequest = RefillRequestBorrador | RefillRequestActiva;

/**
 * D11. Entrada de `crearSolicitud`, sin `id` (lo genera el caso de uso con
 * `randomUUID()`, precedente uniforme del repo). Los campos son REQUERIDOS:
 * la ruta manual nace 'abierta' y 'abierta' exige completitud (D12). El
 * camino del borrador no tiene entrada del cliente en absoluto — lo arma el
 * listener desde `StockBajoPayload`. Sin decoradores de validación: eso vive
 * en el DTO de `adapters/http/`, igual que `NuevoProductoProveedor`.
 */
export interface NuevoRefillItem {
  nombre: string;
  categoria: string;
  precioReferencia: number;
  catalogProductId?: string;
}
```

### Desviación declarada: `?: never` no se usa acá, y por qué

D4 cita `OfferItemReactiva`/`OfferItemProactiva` "con `?: never`" como identificación del patrón. Se mira el patrón entero: **interfaz `Common` + variantes por intersección + discriminante literal + array hijo estrechado**. Todo eso se copia literalmente. Lo que **no** se copia es el `?: never`, y es una decisión, no un olvido:

En `Offer`, `refillRequestId?: never` expresa un **error de categoría**: una oferta proactiva, por definición, no tiene solicitud de origen. Nunca puede tenerla, en ningún estado del mundo.

Un borrador **sin** dirección no es un error de categoría: es un dato **que todavía no se conoce**. La columna es nullable y no tiene CHECK — Postgres acepta un borrador con dirección. Declararlo `?: never` haría que el mapper de persistencia no pueda representar una fila legal, y su única salida sería descartar el valor en silencio o lanzar. D4, además, dice literalmente "variante borrador con esos campos **opcionales**".

La unión sigue siendo segura sin `?: never`: el discriminante ya bloquea las dos direcciones (`RefillEstadoActivo` no es asignable a `'borrador'` ni al revés).

### `CompletarRefillItemInput` NO va a `@repon/types`

Completar un borrador necesita una entrada por ítem (`{ refillItemId, categoria, precioReferencia, catalogProductId? }`) — ver D-E. Podría parecer una 5ª incorporación a `@repon/types` más allá de las 4 de D11. **No lo es**, y el precedente del repo está partido a propósito:

| Caso | Dónde vive | Por qué |
|---|---|---|
| `NuevoProductoProveedor`, `ArchivoCarga` (`catalogo`), `NuevoRefillItem` (D11) | `@repon/types` | El `SPEC.md` del dominio **los nombra** en la firma del puerto. Promoverlos es "pasar prosa del SPEC a código real" |
| `NuevaMascotaInput`, `NuevoConsumoInput` (`consumo`) | Declarados **dentro del propio `ports-in/*.use-case.ts`** | Ningún `SPEC.md` los nombra |

`completarBorrador` no existe en ningún `SPEC.md` (nace con D3), así que su entrada sigue el segundo camino: `export interface CompletarRefillItemInput` dentro de `ports-in/completar-borrador.use-case.ts`. **D11 se queda exactamente en 4 incorporaciones.**

---

## D-C · Payloads de `RefillCreado` y `MatchEncontrado` (Q3)

**La regla, antes que los campos** — se hereda de D-D de `consumo`, que este cambio acaba de validar consumiéndola, y se le agrega la mitad que le faltaba:

> `refill-matching` publica **los hechos que posee y las salidas que él mismo computó**, en su propio vocabulario, más las claves de correlación que le hacen falta a un consumidor para actuar. **Nunca re-publica el vocabulario de otro dominio** — ni el enum ajeno, ni la *forma* de una entidad ajena, aunque la tenga en la mano.

`Urgencia` y `RefillEstado` son vocabulario **propio** (D11), así que publicarlos es exactamente correcto — es el reverso exacto de por qué `consumo` se negó a publicar `urgencia`.

### Decisión 1: `RefillCreado` marca la entrada a `'abierta'`, no el insert de la fila

Un borrador **no publica `RefillCreado`**. Si lo hiciera, `ofertas` notificaría proveedores sobre una solicitud sin dirección, sin comuna y sin categorías: exactamente la falla silenciosa que D3 existe para evitar, exportada a otro dominio.

| Origen | ¿Publica `RefillCreado`? |
|---|---|
| `crearSolicitud` (manual, nace `'abierta'`) | **Sí**, después del commit (D14) |
| `completarBorrador` (`'borrador'` → `'abierta'`) | **Sí**, después del commit — es cuando la solicitud se vuelve real |
| El listener de `RefillAutoSolicitado` (crea `'borrador'`) | **No. Cero eventos.** |

### Decisión 2: solo referencias, jamás snapshots de `ProviderCatalogItem`

Q3 pregunta si `MatchEncontrado` lleva los `ProviderCatalogItem` completos. **No**, y hay tres razones independientes; cualquiera alcanza:

1. **Es vocabulario de `catalogo`.** `ProviderCatalogItem` (`precioBase`, `precioMaximo`, `stock`, `disponible`) es un tipo de `catalogo`. Embeberlo en un evento de `refill-matching` significa que un cambio en `catalogo` rompe un evento de `refill-matching`: acoplamiento al revés, la falla exacta que la regla de D-D nombra.
2. **Los precios quedan viejos al instante.** Entre el match y la oferta puede haber minutos; un snapshot le da a `ofertas` un precio que ya no rige, **sin ninguna forma de saber que es viejo**.
3. **Congela el filtro de visibilidad de C4.** Los ítems de una empresa que se suspenda dos minutos después seguirían vivos dentro del evento, y `ofertas` no tiene acceso a la proyección para re-filtrar.

`ofertas` **sí puede** re-consultar: `catalogo/contracts/` es importable cross-dominio (a diferencia de `refill-matching`, que no tiene `contracts/` — D7), así que `ofertas` importará `CatalogoModule` igual que este cambio.

### Decisión 3: los dos eventos son autosuficientes

`ofertas` necesita los ítems de la solicitud para poder llamar a `buscarCoincidencias(items, companyId)`. Si esos ítems viajaran solo en `RefillCreado`, `ofertas` tendría que **guardar estado de un evento para poder procesar el otro** — la dependencia de orden que D-D de `consumo` rechazó explícitamente. Los dos eventos comparten el mismo payload base y cada uno se basta solo.

### Los payloads

```ts
// domains/refill-matching/events/refill-solicitud.payload.ts
//   Forma compartida por los DOS eventos, mismo criterio que
//   `StockBajoPayload` en consumo.

export interface RefillSolicitudItemPayload {
  /** `refill_items.id`. La clave con la que `ofertas` arma
   *  `OfferItemReactiva.refillItemId` sin volver a consultar nada. */
  readonly refillItemId: string;
  readonly nombre: string;
  /** Requeridos y no opcionales: estos eventos SOLO se publican sobre una
   *  solicitud activa (Decisión 1), y `RefillRequestActiva` los garantiza. */
  readonly categoria: string;
  readonly precioReferencia: number;
  readonly catalogProductId: string | null;
}

export interface RefillSolicitudPayload {
  readonly refillRequestId: string;
  /** `ofertas` denormaliza `offers.user_id` A PROPOSITO (su SPEC.md) para no
   *  derivarlo por join contra `refill_requests`. Bajo D7 no existe camino
   *  síncrono de vuelta: si no viaja acá, no hay de dónde sacarlo. */
  readonly userId: string;
  /** Clave estructurada de zona de despacho: un proveedor la necesita para
   *  cotizar `costoDespacho`/`tiempoEntregaHoras`. */
  readonly comuna: string;
  /**
   * `direccion` NO viaja, y es una decisión de privacidad, no un olvido: es
   * texto libre con PII y NO hace falta para componer una oferta. Entra en
   * juego recién en `pedidos-pagos`, al despachar. La regla: el evento lleva
   * lo mínimo para ACTUAR, no todo lo que el emisor tiene en la mano.
   */
  readonly urgencia: Urgencia;
  readonly items: readonly RefillSolicitudItemPayload[];
}
```

```ts
// events/refill-creado.event.ts
export class RefillCreado implements DomainEvent {
  readonly type = 'refill.creado';
  readonly occurredAt = new Date();
  constructor(readonly payload: RefillSolicitudPayload) {}
}

// events/match-encontrado.payload.ts
export interface MatchEncontradoPayload extends RefillSolicitudPayload {
  /** Empresas con al menos una coincidencia. Deduplicado, orden estable
   *  (primera aparición). ESTA es la lista de a quién notificar. */
  readonly companyIds: readonly string[];
  /** Ids de `provider_catalog` que matchearon. Registro preciso y SIN precios
   *  de qué matcheó en este instante; re-derivarlo con `buscarCoincidencias`
   *  daría un resultado distinto si el catálogo cambió. */
  readonly providerCatalogItemIds: readonly string[];
}

// events/match-encontrado.event.ts
export class MatchEncontrado implements DomainEvent {
  readonly type = 'refill.match_encontrado';
  readonly occurredAt = new Date();
  constructor(readonly payload: MatchEncontradoPayload) {}
}
```

`occurredAt` ya da el instante: **no se duplica un `buscadoAt`**. `estado` **no viaja**: es constante por construcción de cada evento, y publicarlo invita a un consumidor a ramificar sobre él. **`consumptionId` no viaja**: `ofertas` no lo necesita para nada y R6 dice que estos payloads se congelan — agregar un campo después es aditivo y barato; sacarlo, no.

### `MatchEncontrado` se publica también con cero coincidencias

Con `companyIds: []`. Es un hecho que este dominio posee ("buscamos y no hay nadie") y es accionable por `ofertas`. Suprimirlo haría que "no hay proveedores" y "el matching nunca corrió" fueran indistinguibles desde afuera — la misma familia de falla silenciosa que D3 y Q6/D-F combaten. C8 ya garantiza que un `[]` del puerto significa genuinamente "ninguno" y nunca una degradación.

### Cómo cierra el circuito de `ofertas`, sin un solo callback

```
RefillCreado{ refillRequestId, userId, comuna, urgencia, items[] }
   -> ofertas guarda / notifica

MatchEncontrado{ ...lo mismo..., companyIds[], providerCatalogItemIds[] }
   -> por cada companyId:
        catalogQueryPort.buscarCoincidencias(items.map(toRefillItem), companyId)   // C7: companyId? acota
        -> ProviderCatalogItem[] de ESE proveedor, con precios FRESCOS
        -> arma Offer{ kind:'reactiva', refillRequestId, userId, items:[{refillItemId, precio}] }
```

`items` del payload mapea 1:1 a `RefillItem` (`refillItemId` → `id`), así que `ofertas` puede llamar al puerto sin inventar nada. **Cero consultas de vuelta a `refill-matching`, que es exactamente lo que Q3 exige dado D7.**

### Corrección declarada sobre `refill-matching/SPEC.md`

`SPEC.md` dice: *"`RefillCreado` — lo escucha `ofertas` para notificar a los proveedores compatibles"*. **Bajo D15 eso es imposible**: cuando se publica `RefillCreado` el matching todavía no corrió, así que no hay proveedores compatibles que notificar. Quien lleva esa lista es `MatchEncontrado`. Delta declarado (ver §Deltas).

---

## D-D · Ciclo de vida del borrador y deduplicación (Q4)

Tres sub-preguntas, tres respuestas separadas.

### D-D.1 · ¿El borrador expira? **No, y el motivo es estructural**

**Verificado**: `RefillRequest` no tiene `consumptionId` en `packages/types/src/refill-matching.ts`, y `refill_requests` no tiene `consumption_id` en la migración `04`.

Expirar borradores exige uno de dos mecanismos, y los dos están cerrados:

1. **Un job programado** que barra borradores viejos → exige `adapters/scheduling/`, y **D8 dice literalmente que esa carpeta MUST be omitted** en este dominio. Construirlo contradice D8 de frente.
2. **Un barrido perezoso en una lectura** → una escritura escondida en un camino de query. El repo no hace eso en ningún lado.

Y un tercer costo: "expirado" sería un **quinto valor del enum**, que la propia proposal puso en la columna "caro de cambiar después" (quitar un valor exige recrear el tipo).

**Decisión: no expira.** El volumen queda acotado por el debounce ya archivado de `consumo` (un evento por episodio de stock bajo, no uno por día) más el skip de D-D.3. Se nombra como riesgo residual con su camino de salida: un estado `'descartada'` + una ruta de descarte es aditivo y no necesita ningún job.

### D-D.2 · `consumption_id`: cambio ADICIONAL, declarado como tal

Esto va más allá de lo que D3/D4 declararon, y se nombra explícitamente en vez de colarse:

| Artefacto | Cambio | Estado |
|---|---|---|
| `refill_requests.consumption_id uuid null` | **Columna nueva** | **Adicional a D3/D4** (batch 15) |
| Índice parcial único `(user_id, consumption_id) where estado='borrador'` | **Índice nuevo** | **Adicional** (batch 15) |
| `RefillRequestCommon.consumptionId?: string` | **Campo nuevo** | **Adicional a D11** |
| `RefillRequestsTable.consumption_id: string \| null` | Row type | Cae de D10 |

Por qué se agrega ahora y no después:

- **Es la clave de correlación que `consumo` publica *para esto*.** El doc comment de `StockBajoPayload.consumptionId` dice literalmente que es "el único identificador con el que un consumidor puede deduplicar o apuntar de vuelta a este consumo". Recibirla y tirarla a la basura es desperdiciar la única cosa que el productor puso ahí a propósito.
- **El dato es irrecuperable.** Agregar la columna después es DDL barato, pero las filas creadas mientras tanto **no tienen de dónde backfillear**: el evento ya pasó. Hoy hay cero filas; el día que `refill-matching` esté vivo, no.
- **Sin ella, la deduplicación de D-D.3 no es expresable.** Dos borradores del mismo consumo son indistinguibles entre sí.

Y qué NO se hace: **sin FK**. Es una clave que llega por el bus de eventos, no una relación que este dominio posea o pueda validar. Una FK haría fallar una escritura de `refill-matching` por el estado de una tabla ajena, y se rompe el día que `consumo` se extraiga. Es una diferencia deliberada con `refill_items.catalog_product_id` (que sí es FK, porque el usuario elige ese producto y `catalogo` se consulta síncronamente por contrato). Razonada, no inconsistente.

### D-D.3 · Deduplicación: **skip**, porque los dos borradores serían idénticos

Escenario real: episodio 1 → borrador A; el usuario lo ignora; el stock sube (el cron limpia el marcador) o el usuario reconfigura el ítem (`configurarConsumo` limpia el marcador); el stock vuelve a bajar → episodio 2 → ¿borrador B?

Lo que decide la respuesta es **cuánto contenido tiene un borrador**: el listener solo puede llenar `nombre` (no hay `categoria` — `consumo` se niega, con razón, a mapear `kind`; no hay precio; no hay `catalogProductId`). Los dos borradores serían **byte a byte idénticos salvo el `id`**. Saltear no pierde absolutamente nada: el borrador A ya dice "te estás quedando sin X".

```
existe refill_requests where user_id = $1 and consumption_id = $2 and estado = 'borrador'
   -> SI  : log 'refill.borrador_omitido' + return. CERO inserts, CERO eventos.
   -> NO  : crear el borrador.
```

Y el caso que parece un agujero se resuelve solo: si el usuario **sí completó** el borrador A, esa fila ya no está en `'borrador'`, el predicado no matchea, y el episodio 2 crea un borrador nuevo. El comportamiento correcto cae del predicado, sin un caso especial.

**Se rechaza "actualizar el borrador existente"**: no hay nada que actualizar (mismo contenido) y pisaría cualquier edición parcial que un flujo futuro permita.

El índice parcial único de D-A es la red: el read-and-skip es un TOCTOU y dos eventos concurrentes podrían pasarlo. El caso de uso igual hace la lectura, para que el camino normal sea un no-op limpio y no una excepción del driver.

---

## D-E · Superficie HTTP exacta y roles (Q5)

### `listarMisSolicitudes` NO se construye

| Argumento | Peso |
|---|---|
| **No está en `refill-matching/SPEC.md`** | Construirlo es un delta declarado sin ningún requisito detrás |
| **`consumo` no expone ningún listado** — su única ruta de lectura es `GET .../dias-restantes`, una query de negocio | Es el precedente más reciente y es explícito: **listar filas propias se sirve por lectura directa con RLS**, no por `core-api` |
| **La capacidad ya existe** | La migración `04` corre `grant select on public.refill_requests to authenticated` + `refill_requests_authenticated_select_own` + la política `EXISTS` de `refill_items` **exactamente para esto**. El cliente lista sus borradores contra Supabase, sin `core-api` |
| No contradice `openspec/config.yaml` | La regla es *"client apps call core-api for **business logic**"*; listar filas propias por RLS no es lógica de negocio, y es el patrón que el esquema ya habilitó en todos los lotes |

**Consecuencia nombrada**: el comentario de índice de la migración `04` menciona *"las consultas del caso de uso (`listarMisSolicitudes`)"* — un caso de uso que no va a existir. Comentario stale, misma clase que los tres de D9: **se corrige en `db-schema-refill-matching`, nunca editando la migración aplicada**.

### El matching es `POST`, no `GET`

`buscarProveedoresCompatibles` **publica `MatchEncontrado`** (D15). Un `GET` con efectos es un error de contrato HTTP, y acá tiene consecuencia concreta: un prefetch del cliente, un reintento automático o un proxy cacheador dispararían `MatchEncontrado` de más, fan-outeando auto-ofertas duplicadas hacia `ofertas`. Precedente del repo: `POST /consumo/mis-consumos/:id/dosis` — una acción, no un recurso. El único `GET` de lectura pura del repo (`GET .../dias-restantes`) es puro precisamente porque **no inyecta `EVENT_PUBLISHER`**; este caso de uso sí lo inyecta.

### Tabla de rutas

| Método + ruta | Guard | Caso de uso | Body | Éxito |
|---|---|---|---|---|
| `POST /refill/mis-solicitudes` | autenticado (sin `@Roles`) | `crearSolicitud` | `{ items: NuevoRefillItemDto[], direccion, comuna, urgencia }` | **201** `RefillRequestResponseDto` |
| `POST /refill/mis-solicitudes/:refillRequestId/completar` | autenticado (sin `@Roles`) | `completarBorrador` | `{ direccion, comuna, urgencia?, items: CompletarRefillItemDto[] }` | **200** `RefillRequestResponseDto` |
| `POST /refill/mis-solicitudes/:refillRequestId/matching` | autenticado (sin `@Roles`) | `buscarProveedoresCompatibles` | — | **200** `ProveedorCompatibleDto[]` |
| — | — | `marcarComoOfertada` / `marcarComoConfirmada` | — | **Sin ruta. Nunca** (D6) |
| — | — | `crearBorradorRefill` | — | **Sin ruta. Nunca** (D-G.1) |
| — | — | `listarMisSolicitudes` | — | **No existe** (arriba) |

**Prefijo `refill` y no `refill-matching`.** Los 3 controllers existentes usan el nombre del dominio (`identidad`, `catalogo`, `consumo`), y los 3 son de una sola palabra. Este dominio tiene guión, y `matching` es una **operación** sobre una solicitud, no una familia de recursos. Se fija la regla que `pedidos-pagos` va a necesitar igual: **un dominio con nombre compuesto expone su familia de recursos, no su nombre interno**. Desviación declarada y barata de revertir (una línea, cero clientes hoy).

**`mis-` codifica D13 en el espacio de URLs**, igual que `mis-consumos` y `mi-catalogo`. No existe —y no debe existir— `/refill/usuarios/:userId/...`: un path param de dueño es una invitación permanente a pasárselo al caso de uso en vez de `actor.profileId`. Ningún DTO lleva `userId`.

**Sin `@Roles()`, y es una decisión.** `refill_requests.user_id` referencia `profiles(id)` sin restricción de rol, y su política RLS es `user_id = auth.uid()` sin chequeo de rol. `@Roles('user')` haría la API más estricta que la base de datos y que cualquier spec, y dejaría a un perfil `provider` —que también es una persona con una mascota— sin poder pedir un refill. Misma forma y mismo razonamiento que `consumo`. La seguridad cross-tenant no la da el rol: la da D13 en los 3 casos de uso.

### La entrada de `completarBorrador`

```ts
// ports-in/completar-borrador.use-case.ts — LOCAL, no @repon/types (ver D-B)
export interface CompletarRefillItemInput {
  /** DEBE referenciar un `refill_items.id` del borrador. */
  refillItemId: string;
  categoria: string;
  precioReferencia: number;
  catalogProductId?: string;
}
```

**Los ítems se actualizan en su lugar, nunca se reemplazan.** Reemplazarlos exigiría borrar los del borrador, y el criterio de éxito de la proposal es literal: *"ningún DELETE físico introducido"*. Consecuencia derivada, no arbitraria: la entrada **debe cubrir exactamente** los ítems del borrador — ni faltar ninguno (quedaría incompleto) ni traer ids desconocidos. Agregar o sacar ítems al completar queda como follow-up nombrado.

### Errores de dominio

`RefillExceptionFilter` con `@UseFilters` a nivel de controlador, espejo exacto de `ConsumoExceptionFilter`/`CatalogoExceptionFilter`: mapa keyeado por constructor, envelope `{ statusCode, code, message }`, `@Catch()` acotado para no competir con el filtro global.

| Error de dominio | HTTP | `code` | Cuándo |
|---|---|---|---|
| `RefillRequestNotFoundError` | **404** | `REFILL_REQUEST_NOT_FOUND` | No existe **o** es de otro usuario. Byte a byte idéntico (D13) |
| `SolicitudEnBorradorError` | **409** | `REFILL_REQUEST_EN_BORRADOR` | Matching sobre un borrador **propio** (D-F) |
| `TransicionInvalidaError` | **409** | `TRANSICION_INVALIDA` | Completar algo que no es borrador; `marcarComoOfertada` sobre un borrador; etc. |
| `SolicitudIncompletaError` | 400 | `REFILL_REQUEST_INCOMPLETA` | La transición a `'abierta'` no queda completa (D4) |
| `RefillItemDesconocidoError` | 400 | `REFILL_ITEM_DESCONOCIDO` | Un `refillItemId` que no pertenece a esa solicitud |
| `SolicitudInvalidaError` | 400 | `SOLICITUD_INVALIDA` | `crearSolicitud` con 0 ítems, campos vacíos, precio negativo |
| **`CatalogQueryUnavailableError`** | **503** | **`CATALOG_UNAVAILABLE`** | C8/D15. **Importado de `catalogo/contracts/`** — la única subruta importable cross-dominio |

`SolicitudEnBorradorError` y `TransicionInvalidaError` son dos clases y no una porque son dos modos de falla distintos: uno es "esta operación de **lectura** no aplica en este estado", el otro es "esta **transición** no es legal". Q6 exige que el primero sea explícito y nombrado; fusionarlos lo diluiría. Los dos 404 y el 409 de `EN_BORRADOR` son contrato de API observable — la proposal ya los pone en la columna "caro de cambiar después".

---

## D-F · `buscarProveedoresCompatibles` sobre un `'borrador'` (Q6)

**Choice**: **409 Conflict**, `SolicitudEnBorradorError`, `code: 'REFILL_REQUEST_EN_BORRADOR'`.

| Opción | Veredicto |
|---|---|
| `[]` | **Rechazada por la proposal y con razón**: indistinguible de "no hay proveedores", que es un resultado legítimo y accionable. Reintroduce exactamente la falla silenciosa que D3 existe para evitar, y contradice el espíritu de C8 un nivel más arriba |
| **404** | **Rechazada**: el recurso **existe y es tuyo**. El 404 de D13 protege la existencia **cross-tenant**; usarlo acá lo vacía de significado y vuelve los dos casos indistinguibles en los tests y en el cliente. Además le mentiría al dueño sobre su propio borrador |
| **409** ✅ | El recurso existe, el caller tiene derecho a verlo, pero **su estado no admite esta operación**. Es el significado de manual del 409, y el repo ya lo usa así (`EmailYaRegistradoError`, `CompanyNotSuspendedError` en `identidad`) |
| 422 | Rechazada: cero precedentes en el repo; el envelope usa 400/404/409/503 |

**El orden de los chequeos importa y es parte de la decisión**: los dos chequeos de 404 corren **antes** que el de estado, así que el borrador **de otro usuario** devuelve **404, nunca 409**. Un 409 sobre un recurso ajeno confirmaría su existencia — exactamente lo que D13 cierra. **El 409 solo es alcanzable sobre un borrador propio.**

Y no es la única defensa: bajo D-B, pasar `RefillItemBorrador[]` a `buscarCoincidencias` **no compila**. El 409 es el contrato observable por HTTP; el tipo es la garantía estructural.

---

## D-G · Vacíos que ninguna pregunta abierta nombró

Aparecieron al mapear los casos de uso contra los puertos y los SPEC existentes. Los cuatro son deltas declarados.

### D-G.1 · El listener no puede llamar a `crearSolicitud` → nace un 6º caso de uso

`refill-matching/SPEC.md` dice que `RefillAutoSolicitado` *"dispara `crearSolicitud` sin intervención del usuario"*. **Bajo D3 + D12 eso es imposible**: `crearSolicitud(userId, items, direccion, comuna, urgencia)` exige dirección y comuna (que el sistema no tiene) y produce `'abierta'` (que es justo lo que D3 prohíbe para esta ruta).

```ts
// ports-in/crear-borrador-refill.use-case.ts  (interno: sin ruta, sin @Roles)
async execute(entrada: { consumptionId: string; userId: string; nombre: string }): Promise<void>
```

Misma clase que `procesarConsumosVencidos` en `consumo`: caso de uso interno, sin superficie HTTP, sin actor humano. La proposal dibujó 5 casos de uso ("los 4 de SPEC.md + el de completar borrador"); son **6**.

`urgencia` de un borrador: se persiste `'lo_antes_posible'` como valor de arranque (la columna es `NOT NULL` y no se relaja — D4 no la nombra), y el usuario la confirma o la cambia al completar (por eso `urgencia?` es opcional en el body de completar). Elección declarada: el disparo automático es una condición de stock bajo, no una urgencia medida.

### D-G.2 · `RefillRepository` necesita dos métodos más

```ts
export interface RefillRepository {
  /** Upsert de la solicitud + TODOS sus ítems, keyeado por id. Sirve al insert
   *  de `crearSolicitud` y al update in-place de `completarBorrador` — nunca
   *  borra ítems (criterio de éxito: cero DELETE físico). Bajo D14 el caller
   *  SIEMPRE pasa `tx`. */
  save(request: RefillRequest, tx?: TransactionContext): Promise<void>;

  /** Trae la solicitud con sus ítems (1 select con join). */
  findById(id: string, tx?: TransactionContext): Promise<RefillRequest | null>;

  /** D-D.3 — dedup del listener. NUEVO. */
  findBorradorByConsumption(
    userId: string, consumptionId: string, tx?: TransactionContext,
  ): Promise<RefillRequestBorrador | null>;

  /** D6 — transición pura de estado, sin reescribir ítems. NUEVO.
   *  `save()` reescribiría la fila entera desde un snapshot: mismo motivo por
   *  el que el cron de `consumo` tiene prohibido usar `save()`. */
  actualizarEstado(
    id: string, estado: RefillEstadoActivo, tx?: TransactionContext,
  ): Promise<void>;
}
```

### D-G.3 · `SPEC.md` promete algo que D15 hace imposible

*"`RefillCreado` — lo escucha `ofertas` para notificar a los proveedores compatibles"*: cuando se publica `RefillCreado`, el matching **todavía no corrió** (D15 los separa a propósito). La lista de proveedores la lleva `MatchEncontrado`. Corrección declarada, no re-interpretación silenciosa.

### D-G.4 · El default `'abierta'` es fail-open bajo D3

Ver D-A. Se conserva la columna como está y se neutraliza escribiendo `estado` siempre explícito desde el adaptador. Anotado en Riesgos residuales.

---

## Diagrama 1 · `crearSolicitud`: la transacción (D12 + D13 + D14 + D15)

```
 usuario           RefillController          CrearSolicitudUseCase          RefillRepository        EventPublisher
                   (adapters/http)           (ports-in)                     (ports-out)             (kernel)
    |                     |                          |                            |                     |
 POST /refill/mis-solicitudes
 body: { items:[{nombre,categoria,precioReferencia,catalogProductId?}], direccion, comuna, urgencia }
                                                <-- el DTO NO tiene userId. NO PUEDE tenerlo (D13).
    |-------------------->|                          |                            |                     |
    |                (1)  AuthGuard resuelve el actor. Sin @Roles (ver §Superficie HTTP).
    |                (2)  Validacion de DTO: >=1 item, nombre/categoria no vacios,
    |                     precioReferencia >= 0, urgencia en el enum. Falla -> 400 SOLICITUD_INVALIDA.
    |                (3)  |--- execute(actor.profileId, items, direccion, comuna, urgencia) --->|
    |                     |      D13: el dueno SIEMPRE se deriva del actor.       |
    |                     |                          |                            |
    |                     |                    (4)  ids: randomUUID() para la request y para
    |                     |                         cada item -- nunca el default de la DB
    |                     |                         (precedente uniforme del repo).
    |                     |                          |
    |                     |                    (5)  entidad = crearSolicitudActiva(...)  <-- domain/
    |                     |                         Invariantes: >=1 item, direccion/comuna no
    |                     |                         vacias, estado = 'abierta' por construccion.
    |                     |                         El tipo devuelto es RefillRequestActiva (D-B).
    |                     |                          |
    |                     |                    (6)  runInTransaction (D14) ==========================
    |                     |                          |                            |
    |                     |                    6a.  |--- save(request, tx) ------>|  INSERT refill_requests
    |                     |                          |                            |    (estado EXPLICITO,
    |                     |                          |                            |     nunca el default -- D-G.4)
    |                     |                          |                            |  INSERT refill_items x N
    |                     |                          |                            |    (una sentencia, no N)
    |                     |                          |                            |
    |                     |                          |    Dos escrituras acopladas y una firma que
    |                     |                          |    devuelve Promise<RefillRequest>: CERO canal
    |                     |                          |    para reportar exito parcial. Una request sin
    |                     |                          |    items entra al matching y no matchea nada
    |                     |                          |    -- la misma falla silenciosa que D3 rechaza.
    |                     |                          |
    |                     |                    ---- COMMIT ----------------------------------------
    |                     |                          |                            |
    |                     |                    (7)  |--- publish(RefillCreado{ refillRequestId, ---->|
    |                     |                          |      userId, comuna, urgencia, items[] })     |
    |                     |                          |    DESPUES del commit, nunca dentro: `ofertas`
    |                     |                          |    no puede reaccionar a una solicitud que se
    |                     |                          |    revirtio.  `direccion` NO viaja (D-C).
    |                     |                          |
    |                     |                    (8)  EL MATCHING NO CORRE ACA (D15). Si corriera, una
    |                     |                         caida del catalogo convertiria una creacion YA
    |                     |                         COMMITEADA en un 5xx, y ademas meteria el puerto
    |                     |                         dentro de la transaccion, violando C2.
    |<-- 201 RefillRequestResponseDto ---------------|
```

`completarBorrador` tiene **exactamente la misma forma**, con tres diferencias: (a) abre con `findById` **dentro** de la transacción y rechaza si no es del actor (404) o no es `'borrador'` (409 `TRANSICION_INVALIDA`); (b) valida completitud con la unión discriminada de D-B antes de escribir (`SolicitudIncompletaError` → 400); (c) responde 200 en vez de 201.

---

## Diagrama 2 · `buscarProveedoresCompatibles`: fuera de toda transacción (D13 + D14 + D15 + D-F)

```
 usuario         RefillController      BuscarProveedoresCompatiblesUseCase        RefillRepository   CatalogQueryPort   EventPublisher
                 (adapters/http)       (ports-in)                                 (ports-out)        (catalogo/contracts) (kernel)
    |                   |               == LO QUE ESTE CASO DE USO NO INYECTA ==
    |                   |                  Constructor: REFILL_REPOSITORY + CATALOG_QUERY_PORT + EVENT_PUBLISHER.
    |                   |                  **NO TRANSACTION_MANAGER. JAMAS.**  <-- D14/R3: la garantia no es un
    |                   |                  comentario ni un test (con el puerto mockeado el deadlock NO aparece),
    |                   |                  es la ausencia del token en el constructor. Verificable por inspeccion.
 POST /refill/mis-solicitudes/{refillRequestId}/matching        <-- POST y no GET: publica un evento (D-E)
    |------------------>|                          |                        |                |            |
    |               (1) AuthGuard. ParseUUIDPipe sobre :refillRequestId.
    |               (2) |--- execute(actor.profileId, refillRequestId) ---->|                |            |
    |                   |                          |                        |                |            |
    |                   |                    (3)  |--- findById(refillRequestId) ---------->|            |
    |                   |                          |     SIN tx: no hay transaccion que pasar.
    |                   |                          |<-- RefillRequest | null ----------------|            |
    |                   |                          |
    |                   |                    (4)  null  ==> RefillRequestNotFoundError ==> 404
    |                   |                    (5)  r.userId !== actor.profileId ==> EL MISMO ERROR ==> 404
    |                   |                          |     Byte a byte identico al caso "no existe" (D13/R2).
    |                   |                          |     404 y NO 403: un 403 confirma que el recurso existe
    |                   |                          |     y es de otro, filtrando existencia por enumeracion
    |                   |                          |     de UUIDs. Con RLS bypasseada en service-role, este
    |                   |                          |     chequeo es la UNICA defensa.
    |                   |                          |
    |                   |                    (6)  r.estado === 'borrador' ==> SolicitudEnBorradorError ==> 409 (D-F)
    |                   |                          |     DESPUES de (4)/(5), a proposito: el borrador AJENO
    |                   |                          |     devuelve 404, nunca 409. El 409 solo es alcanzable
    |                   |                          |     sobre un borrador PROPIO.
    |                   |                          |     Nunca [] : indistinguible de "no hay proveedores".
    |                   |                          |
    |                   |                    (7)  TypeScript narrowea a RefillRequestActiva (D-B):
    |                   |                          |     r.items es RefillItem[], r.comuna es string.
    |                   |                          |     Los ItemS de un borrador NO COMPILARIAN aca.
    |                   |                          |
    |                   |                    (8)  |--- buscarCoincidencias(r.items) --------------------->|          |
    |                   |                          |     C1: la firma no tiene `tx?`. Esa ausencia ES la senal.
    |                   |                          |     C2: llamarlo con una transaccion abierta = auto-deadlock
    |                   |                          |         por agotamiento del pool. Acá es imposible: no hay
    |                   |                          |         TransactionManager que pudiera abrir una.
    |                   |                          |     C7: catalogProductId presente -> match exacto;
    |                   |                          |         ausente -> categoria exacta + nombre por trigram.
    |                   |                          |     C4: las empresas ocultas ya quedan afuera por el
    |                   |                          |         anti-join contra catalog_hidden_companies --
    |                   |                          |         por eso D5 NO consume EmpresaSuspendida acá.
    |                   |                          |     D1: SIN filtro por comuna. Matching NACIONAL.
    |                   |                          |
    |                   |                    8a.  |<-- ProviderCatalogItem[] (puede ser []) --------------|          |
    |                   |                    8b.  |<-- throw CatalogQueryUnavailableError ----------------|          |
    |                   |                          |     NO SE CAPTURA. Sube tal cual hasta el filtro.
    |                   |                          |     El puerto nunca devuelve [] degradado (C8), asi que
    |                   |                          |     un [] que llega acá significa genuinamente "ninguno".
    |<-- 503 { code:'CATALOG_UNAVAILABLE' } -------|
    |                   |                          |
    |                   |                    (9)  companyIds = dedup(items.map(i => i.companyId))   <-- salida propia
    |                   |                          |--- publish(MatchEncontrado{ ...RefillSolicitudPayload, ------>|
    |                   |                          |        companyIds, providerCatalogItemIds })                  |
    |                   |                          |     Se publica TAMBIEN con companyIds = [] (D-C): "buscamos
    |                   |                          |     y no hay nadie" es un hecho accionable. Sin precios ni
    |                   |                          |     stock: eso es vocabulario de `catalogo`.
    |<-- 200 ProveedorCompatibleDto[] -------------|
```

---

## Diagrama 3 · El listener de `RefillAutoSolicitado` (D2 + D3 + D8 + D-D + R5)

```
 consumo                       RefillAutoSolicitadoListener        CrearBorradorRefillUseCase      RefillRepository
 procesarConsumosVencidos      adapters/events/ (D8)               ports-in (D-G.1, interno)       (ports-out)
    |                                    |                                    |                          |
 publish(RefillAutoSolicitado{ StockBajoPayload })  -- emitAsync
    |----------------------------------->|                                    |                          |
    |                            (1) @OnEvent('consumo.refill_auto_solicitado')
    |                                Suscripcion por NOMBRE DE CANAL STRING. NUNCA se importa la
    |                                clase de evento de `consumo`: el payload se tipa con una interfaz
    |                                LOCAL en adapters/events/consumo-event.payloads.ts, con los 3
    |                                campos que este dominio consume y ninguno mas. Mismo patron
    |                                literal que catalogo/adapters/events/identidad-event.payloads.ts.
    |                                { consumptionId, userId, nombre }
    |                                    |
    |                            (2) NO HAY @OnEvent('consumo.stock_bajo_detectado'). D2, y no es
    |                                ahorro de trabajo: es AUTORIZACION. Los dos eventos llevan el
    |                                MISMO payload, pero StockBajoDetectado se emite para toda
    |                                condicion de stock bajo, y RefillAutoSolicitado solo cuando
    |                                autoCrearRefill es true -- lleva CONSENTIMIENTO. Suscribirse a
    |                                los dos crearia solicitudes para usuarios que no las pidieron.
    |                                    |
    |                            (3) try {                                     |
    |                                  |--- execute({ consumptionId, userId, nombre }) --->|
    |                                    |                                    |            |
    |                                    |                              3a.  runInTransaction ==========
    |                                    |                                    |            |
    |                                    |                              3b.  |--- findBorradorByConsumption(userId, consumptionId, tx) -->|
    |                                    |                                    |<-- RefillRequestBorrador | null -------------------------|
    |                                    |                                    |
    |                                    |                              3c.  != null ==> log 'refill.borrador_omitido' + RETURN.
    |                                    |                                    |    CERO inserts, CERO eventos (D-D.3): los dos
    |                                    |                                    |    borradores serian identicos salvo el id.
    |                                    |                                    |
    |                                    |                              3d.  crearBorrador({ id, userId, consumptionId,
    |                                    |                                    |    urgencia:'lo_antes_posible',
    |                                    |                                    |    items:[{ id, nombre }] })     <-- domain/
    |                                    |                                    |    SIN direccion, SIN comuna, SIN categoria,
    |                                    |                                    |    SIN precioReferencia: el sistema no tiene
    |                                    |                                    |    de donde leerlos (D3). El tipo lo permite;
    |                                    |                                    |    'abierta' no lo permitiria.
    |                                    |                                    |
    |                                    |                              3e.  |--- save(borrador, tx) ---->| INSERT refill_requests
    |                                    |                                    |                            |   (estado='borrador' EXPLICITO)
    |                                    |                                    |                            | INSERT refill_items x1
    |                                    |                                    |    Red del TOCTOU: el indice parcial unico de
    |                                    |                                    |    D-A hace fallar el segundo insert concurrente.
    |                                    |                              ---- COMMIT --------------------------
    |                                    |                                    |
    |                                    |                              3f.  CERO EVENTOS. `RefillCreado` marca la entrada a
    |                                    |                                    'abierta', no el insert de la fila (D-C).
    |                                    |                                    Publicarlo acá haria que `ofertas` notificara
    |                                    |                                    proveedores sobre una solicitud sin direccion
    |                                    |                                    y sin categorias.
    |                                    |                                    |
    |                            (4) } catch (error) { this.logger.error(...) }   <-- NUNCA re-lanza (R5)
    |                                    |
    |<-- resuelve --------------------- |
    |   EventEmitterPublisher.publish usa emitAsync: un rechazo acá propagaria DE VUELTA al
    |   procesarConsumosVencidos de `consumo`, abortando el resto de los items de esa corrida
    |   diaria. Patron ya establecido y verificado en CompanyVisibilityListener: catch-and-log,
    |   jamas re-throw. Es uno de los 4 tests obligatorios de D17.
```

---

## Wiring de módulos y tokens

### `refill-matching.module.ts` — de `@Module({})` a providers reales

```ts
@Module({
  // CatalogoModule es la PRIMERA arista de dependencia entre dos modulos de
  // dominio del repo (Rollback Plan, excepcion 2). Es puramente aditiva:
  // consume CATALOG_QUERY_PORT, un token que CatalogoModule YA exporta
  // (VERIFICADO: catalogo.module.ts:61 dice `exports: [CATALOG_QUERY_PORT]`),
  // y no modifica un solo archivo de `catalogo`. DatabaseModule es redundante
  // (es @Global) pero explicito: mismo estilo que Identidad/Catalogo/Consumo.
  imports: [DatabaseModule, CatalogoModule],
  controllers: [RefillController],
  providers: [
    { provide: REFILL_REPOSITORY, useClass: KyselyRefillRepository },
    CrearSolicitudUseCase,
    CompletarBorradorUseCase,
    BuscarProveedoresCompatiblesUseCase,
    MarcarComoOfertadaUseCase,        // sin ruta, sin caller (D6)
    MarcarComoConfirmadaUseCase,      // sin ruta, sin caller (D6)
    CrearBorradorRefillUseCase,       // interno: sin ruta, sin @Roles (D-G.1)
    RefillAutoSolicitadoListener,     // en `providers`, no `controllers`:
                                      // DiscoveryService encuentra @OnEvent igual
  ],
  // VACIO, a proposito (D7): este dominio no tiene contracts/ y no expone
  // nada cross-dominio. Segundo dominio sin contracts/, despues de consumo.
  exports: [],
})
export class RefillMatchingModule {}
```

**`app.module.ts` no se toca** — `RefillMatchingModule` ya está importado (verificado, línea 50). `EventEmitterModule.forRoot()` ya está registrado globalmente por `shared/event-bus/event-bus.module.ts`, que es lo que hace posible el `@OnEvent`. **Cero dependencias externas nuevas** — primer vertical del repo que no agrega ningún paquete.

### Estructura de archivos

```
domains/refill-matching/
├── domain/
│   ├── refill-request.entity.ts       (factories crearSolicitudActiva / crearBorrador,
│   │                                   transicion completar() con la invariante de D4,
│   │                                   maquina de estados marcarOfertada/marcarConfirmada)
│   └── refill.errors.ts               (las 6 clases de la tabla de errores)
├── ports-in/
│   ├── crear-solicitud.use-case.ts
│   ├── completar-borrador.use-case.ts         (+ CompletarRefillItemInput, local — D-B)
│   ├── buscar-proveedores-compatibles.use-case.ts  ── SIN TRANSACTION_MANAGER (D14/R3)
│   ├── marcar-como-ofertada.use-case.ts       ── sin ruta, sin caller (D6)
│   ├── marcar-como-confirmada.use-case.ts     ── sin ruta, sin caller (D6)
│   └── crear-borrador-refill.use-case.ts      ── interno, solo el listener (D-G.1)
├── ports-out/
│   └── refill-repository.port.ts      (+ findBorradorByConsumption, + actualizarEstado — D-G.2)
├── events/
│   ├── refill-solicitud.payload.ts    (RefillSolicitudPayload + RefillSolicitudItemPayload)
│   ├── refill-creado.event.ts
│   ├── match-encontrado.payload.ts
│   └── match-encontrado.event.ts
├── adapters/
│   ├── http/          refill.controller.ts · refill.mapper.ts
│   │                  refill-exception.filter.ts · dto/*.dto.ts
│   ├── persistence/   kysely-refill.repository.ts   (mapper numeric->number, ojo con NULL)
│   └── events/        consumo-event.payloads.ts     (interfaz LOCAL del payload)
│                      refill-auto-solicitado.listener.ts   (D2/D8)
└── refill-matching.module.ts

SIN `contracts/`            — D7. Ningun SPEC.md pide una lectura sincrona sobre este dominio:
                              ofertas resuelve su acceso con su propia tabla + offers.user_id
                              denormalizado a proposito.
SIN `adapters/scheduling/`  — D8. Cero comportamiento recurrente declarado. Es tambien lo que
                              cierra la expiracion de borradores (D-D.1).
CON `adapters/events/`      — D8. Segundo @OnEvent del repo, despues de CompanyVisibilityListener.
```

Este cambio es el **primer caso que ejercita las tres reglas condicionales** de `core-api-hexagonal-layout` a la vez. Se agregan escenarios de confirmación, ningún requisito nuevo.

---

## Mapa de transacciones

| Operación | ¿`runInTransaction`? | Sentencias | Razón |
|---|---|---|---|
| **`crearSolicitud`** | **Sí (D14)** | 1 insert request + 1 insert bulk de N ítems | Dos escrituras acopladas y `Promise<RefillRequest>`: **cero canal para reportar parcialidad**. Una request sin ítems entra al matching y no matchea nada. Ver Diagrama 1 |
| **`completarBorrador`** | **Sí** | 1 select (dueño + estado) + 1 update request + 1 upsert de N ítems | Misma forma. La transición a `'abierta'` solo es válida si **toda** la completitud aterriza; una mitad deja una solicitud `'abierta'` con ítems sin categoría — el centinela que D3 rechaza, por la puerta de atrás. El select va **dentro**, sobre el mismo `tx`, igual que `marcarDosisTomada` |
| **`buscarProveedoresCompatibles`** | **No — estructuralmente imposible** | 1 select + 1 llamada al puerto (fuera de la DB de este dominio) | **D14 + C2.** El caso de uso **no inyecta `TRANSACTION_MANAGER`**: la garantía no depende de que alguien recuerde no usarlo. Y no hay nada que atomizar — hay **cero escrituras**. Ver Diagrama 2 |
| **listener → `crearBorradorRefill`** | **Sí** | 1 select (dedup) + 1 insert request + 1 insert de 1 ítem | Las mismas dos escrituras acopladas de `crearSolicitud`. El select de dedup entra al `tx` porque no cuesta nada; el índice parcial único de D-A es la red real contra el TOCTOU |
| `marcarComoOfertada` / `marcarComoConfirmada` | No | 1 select + 1 update de estado | Una sola escritura, y `actualizarEstado` es una sentencia angosta que **no reescribe ítems** (D-G.2) |

**Confirmación explícita de que ninguna transacción se cuela en el matching** (Q3/D14 lo exigen), con dos propiedades verificables por inspección, no por convención:

1. `BuscarProveedoresCompatiblesUseCase` **no inyecta `TRANSACTION_MANAGER`** — misma garantía por construcción que `cargarCatalogoMasivo` y `procesarConsumosVencidos`.
2. `CatalogQueryPort.buscarCoincidencias` **no acepta `tx?`** (C1), así que ni siquiera existe un parámetro por el cual una transacción pudiera filtrarse.

R3 dice que este deadlock **no aparece en tests unitarios con el puerto mockeado**, solo bajo carga real. Por eso la defensa es estructural y se testea leyendo un constructor.

---

## Row types de Kysely (`shared/database/schema.ts`, D10)

```ts
export type RefillUrgenciaRow = 'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias';
/** Orden IDENTICO al del enum de Postgres tras el batch 14 (D-A): 'borrador' primero. */
export type RefillEstadoRow = 'borrador' | 'abierta' | 'ofertada' | 'confirmada';

export interface RefillRequestsTable {
  id: Generated<string>;
  user_id: string;                    // D13: el campo que hace expresable el chequeo de dueño
  direccion: string | null;           // D4: nullable desde el batch 15
  comuna: string | null;              // D4
  urgencia: RefillUrgenciaRow;        // NOT NULL sin default -> no Generated
  estado: Generated<RefillEstadoRow>; // tiene default 'abierta' -> Generated.
                                      // El adaptador lo escribe SIEMPRE explicito (D-G.4).
  consumption_id: string | null;      // D-D.2. Sin FK, a proposito.
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RefillItemsTable {
  id: Generated<string>;
  refill_request_id: string;
  catalog_product_id: string | null;
  nombre: string;
  categoria: string | null;           // D4
  precio_referencia: string | null;   // numeric(12,2) -> STRING, y ademas nullable. Ver el callout.
  created_at: Generated<string>;      // sin updated_at: refill_items es inmutable en el esquema
                                      // (no hay trigger), pero completarBorrador SI la actualiza.
                                      // Ver Riesgos residuales.
}

// DB += { refill_requests: RefillRequestsTable; refill_items: RefillItemsTable; }
```

> ### ⚠️ El detalle mecánico de mayor riesgo del cambio: `Number(null) === 0`
>
> `precio_referencia numeric(12,2)` vuelve del driver como **`string`** (parser por defecto del OID 1700, para no perder precisión) — el gotcha que D-C de `catalogo` descubrió con `precio_base` y que D10 manda aplicar acá.
>
> **Pero acá se combina con D4 y produce algo peor.** La columna ahora también puede ser `NULL`, y en JavaScript:
>
> ```
> Number('1990.00') === 1990     ✅
> Number(null)     === 0         ☠️   <-- el centinela que D3 RECHAZA EXPLICITAMENTE
> Number('')       === 0         ☠️
> Number(undefined)=== NaN
> ```
>
> Un mapper que haga `precioReferencia: Number(row.precio_referencia)` convierte el ítem de un borrador —cuyo precio es desconocido a propósito— en un ítem con **`precioReferencia: 0`**: exactamente la solicitud que "parece válida, entra al matching y no matchea nada", la falla silenciosa que D3 existe para impedir. La decisión de diseño más cara del cambio la puede anular una línea de conversión ingenua.
>
> **La forma obligatoria**, en `adapters/persistence/` y en ningún otro lado:
>
> ```ts
> precioReferencia: row.precio_referencia === null ? undefined : Number(row.precio_referencia),
> categoria:        row.categoria ?? undefined,   // '' NO es lo mismo que NULL
> ```
>
> Y el sentido inverso importa igual: al escribir, `undefined` debe llegar a Postgres como `NULL`, nunca como `0` ni como `''`. Se cubre con un test de adaptador que hace round-trip de un borrador y afirma `undefined`, no `0`.

---

## Deltas de SPEC.md que `sdd-spec` debe absorber

Los 6 primeros ya venían declarados en la proposal; los **8 restantes** los agrega este documento y **no** pueden aterrizar en silencio (regla `rules.specs` de `openspec/config.yaml`).

| Archivo | Delta | Origen |
|---|---|---|
| `refill-matching/SPEC.md` | `'borrador'` como cuarto estado + invariante de la transición | D3 (proposal) |
| `refill-matching/SPEC.md` | `EmpresaSuspendida` **no** se consume — la exclusión ya ocurre transitivamente por `CatalogQueryPort` | D5 (proposal) |
| `refill-matching/SPEC.md` | `crearSolicitud` gana `comuna` | D12 (proposal) |
| `refill-matching/SPEC.md` | Firmas con dueño derivado del actor; 404 cross-tenant | D13 (proposal) |
| `packages/types/SPEC.md` | `Urgencia`, `RefillEstado`, unión discriminada, `NuevoRefillItem` | D11 (proposal) |
| `db-schema-refill-matching` + `docs/ARCHITECTURE.md:42` + `packages/types/src/refill-matching.ts:9` | Corrección del encuadre "Edge Function de matching" | D9 (proposal) |
| `db-schema-refill-matching` | **`refill_requests.consumption_id`, sin FK, + el índice parcial único de un borrador por consumo** | **D-D.2/D-D.3** |
| `db-schema-refill-matching` | **El comentario de índice de la migración `04` nombra `listarMisSolicitudes`, un caso de uso que este cambio decide NO construir** — comentario stale, misma clase que los tres de D9 | **D-E** |
| `db-schema-refill-matching` | **La migración de D3/D4 son DOS archivos, y es una restricción de Postgres**, no una preferencia de estilo | **D-A** |
| `refill-matching/SPEC.md` | **`RefillCreado` NO puede llevar los proveedores compatibles** — cuando se publica, el matching todavía no corrió (D15). Esa lista la lleva `MatchEncontrado` | **D-G.3** |
| `refill-matching/SPEC.md` | **Los payloads exactos de los 2 eventos, y la regla que los gobierna**: se publican hechos propios y salidas propias, jamás la *forma* de una entidad ajena (`ProviderCatalogItem`); `direccion` no viaja | **D-C** |
| `refill-matching/SPEC.md` | **`RefillAutoSolicitado` NO dispara `crearSolicitud`** (la firma lo hace imposible bajo D3+D12): dispara un 6º caso de uso interno, `crearBorradorRefill`. Y `RefillRepository` suma `findBorradorByConsumption` + `actualizarEstado` | **D-G.1 / D-G.2** |
| `refill-matching/SPEC.md` | **La superficie HTTP: 3 rutas, sin `listarMisSolicitudes`, matching por `POST`; el matching sobre un borrador es 409, nunca `[]` ni 404** | **D-E / D-F** |
| `core-api-hexagonal-layout` | **Sin cambio de regla.** Escenarios de confirmación: primer dominio con `adapters/events/` **y** sin `contracts/` **y** sin `adapters/scheduling/` a la vez | D7/D8 (proposal) |

---

## Secuencia de implementación (7 PRs encadenados)

Cada PR deja `main` verde y coherente. Bajo **D17 (strict TDD, sin excepciones)**, cada uno arranca por sus tests. Los providers de `refill-matching.module.ts` se agregan **incrementalmente** en el PR que los necesita; el PR 7 es la auditoría final, no el primer cableado.

| PR | Slice | Contenido | Por qué acá |
|---|---|---|---|
| **1** | 0 · groundwork | **Migraciones 14 y 15** (D-A/D-D.2); los 2 row types + `DB` (D10); los 4+1 tipos de `@repon/types` (D11/D-B); **`RefillRepository` en su forma final** (D-G.2); `domain/refill.errors.ts` | Cero comportamiento, puras costuras. **Las dos migraciones suben al PR 1**: el row type tiene que incluir las columnas igual, y una migración descubierta a mitad de slice es una interrupción. El PR donde se descubre si D-B rompe `catalogo` — `pnpm typecheck` es el juez |
| **2** | 1 · dominio | Factories `crearSolicitudActiva`/`crearBorrador`, transición `completar()` con la invariante de D4, máquina de estados de 4 valores | Jest puro, sin contenedor Nest. Todo lo demás depende de esto |
| **3** | 2 · persistencia | `KyselyRefillRepository` (los 4 métodos) **con el mapper de `numeric` + NULL** | El PR donde vive el callout de `Number(null) === 0`. Test de round-trip que afirma `undefined`, nunca `0` |
| **4** | 3 · creación | `CrearSolicitudUseCase` transaccional (D14) + `comuna` (D12) + dueño del actor (D13); `RefillCreado` + `RefillSolicitudPayload` (D-C); controller + filter + mapper + DTOs + `POST /refill/mis-solicitudes` | Fija la forma del payload compartido con **cero** consumidores (R6). Primer PR con superficie HTTP |
| **5** | 4 · matching | `BuscarProveedoresCompatiblesUseCase`; import de `CatalogoModule`; **404 cross-tenant (D13)**, **409 en borrador (D-F)**, **503 `CATALOG_UNAVAILABLE` (D15)**; `MatchEncontrado`; `POST .../matching` | **Después del 4 a propósito**: con la ruta transaccional ya cerrada, la ausencia de `TRANSACTION_MANAGER` acá es visible en el diff. **El PR que más merece review dedicada**: cierra R2 y R3 |
| **6** | 5 · auto | `CrearBorradorRefillUseCase` (D-G.1); `consumo-event.payloads.ts`; `RefillAutoSolicitadoListener` (D2/D8); dedup (D-D.3); `POST .../completar` + `CompletarBorradorUseCase` | Los 4 negativos obligatorios de D17 se cierran acá. Test e2e de contrato con **`await moduleRef.init()`**, no solo `.compile()` |
| **7** | 6 · cierre | `MarcarComoOfertada`/`Confirmada` (D6, sin caller); auditoría de `refill-matching.module.ts` (`exports: []`); los 14 deltas de la tabla de arriba; corrección de `docs/ARCHITECTURE.md:42` (D9) | Los SPEC.md se actualizan cuando el comportamiento ya existe, no antes |

**Presupuesto de review (R10)**: los PRs 4, 5 y 6 son los que más peso llevan; **el 6 es el candidato #1 a partirse** en 6a (listener + borrador) y 6b (completar), porque son dos caminos de escritura independientes. La decisión de PRs encadenados la toma `sdd-tasks` bajo `delivery_strategy: ask-on-risk`, no este documento; acá quedan dibujadas las unidades de trabajo autónomas y marcado dónde está el corte natural.

---

## Estrategia de testing (D17: todo esto se escribe primero)

| Capa | Qué se prueba | Cómo | ¿CI? |
|---|---|---|---|
| Unit | **Negativo de autorización, el primero que se escribe**: usuario A → `refillRequestId` de B → `RefillRequestNotFoundError`; solicitud inexistente → **el mismo error** (D13/R2) | Ports mockeados | Sí |
| Unit | **Un `'borrador'` nunca matchea (D3/D-F)**: `SolicitudEnBorradorError`, **nunca `[]`**. Y el borrador **ajeno** → 404, no 409 (orden de chequeos) | Mocks | Sí |
| Unit | **`BuscarProveedoresCompatiblesUseCase` no inyecta `TRANSACTION_MANAGER`** (D14/R3) — inspección del constructor | Jest | Sí |
| Unit | `CatalogQueryUnavailableError` **no se captura** y el filtro lo mapea a 503 `CATALOG_UNAVAILABLE` (D15/C8) | Puerto mockeado que lanza | Sí |
| Unit | **`crearSolicitud` (D14)**: `runInTransaction` invocado, `tx` propagado a `save`, `publish` **después** del commit, y un fallo en el insert de ítems **no deja la request persistida** | Mocks | Sí |
| Unit | **La transición rechaza incompletitud (D4)**: sin `direccion`, sin `comuna`, o con cualquier ítem sin `categoria`/`precioReferencia` → `SolicitudIncompletaError` | Jest puro | Sí |
| Unit | **`StockBajoDetectado` no crea nada; solo `RefillAutoSolicitado` lo hace** (D2/D17) | Listener + mocks | Sí |
| Unit | **El listener captura y loguea, nunca re-lanza** (R5/D17): el caso de uso lanza y `onRefillAutoSolicitado` resuelve igual | Mocks | Sí |
| Unit | **Dedup (D-D.3)**: dos `RefillAutoSolicitado` del mismo `consumptionId` con borrador abierto → **un solo** insert. Y si el primero ya se completó → **dos** solicitudes | Mocks | Sí |
| Unit | **El adaptador escribe `estado` explícito**, nunca se apoya en el default (D-G.4) | Kysely mockeado / query builder | Sí |
| Tipos | **`RefillItemBorrador[]` no compila contra `buscarCoincidencias`** (D-B) — test de tipos (`@ts-expect-error`) | `tsc` | Sí |
| Integración (opt-in) | El índice parcial único rechaza el segundo borrador concurrente. **`numeric` vuelve como `string` y `NULL` sobrevive el round-trip como `undefined`, jamás como `0`** | `supabase start` local | No (requiere DB) |
| E2E | 401 sin token; **404 cross-tenant** en las 2 rutas con `:refillRequestId`; **409** sobre borrador propio; 400 de DTO; **503** con el puerto caído; `/health` sigue 200; **no existe ninguna ruta que alcance `crearBorradorRefill`, `marcarComoOfertada` ni `marcarComoConfirmada`** | `supertest` + `ACTOR_PORT`/`JWT_VERIFIER` sobreescritos | Sí |
| E2E contrato | El listener se registra de verdad: publicar un `RefillAutoSolicitado` **real** por el `EVENT_PUBLISHER` real crea el borrador. **Con `await moduleRef.init()`, no solo `.compile()`** — sin `init()` el hook `onApplicationBootstrap` no corre, `@OnEvent` no se registra y el test pasa sin probar nada (bug real capturado en PR8b de `catalogo`) | `moduleRef.init()` | Sí |
| Regresión | **Suites completas de `identidad`, `catalogo` y `consumo` verdes.** `catalogo` importa especialmente: D-B lo toca por tipos aunque no por archivos | Sin cambios | Sí |

---

## Riesgos residuales y preguntas abiertas

Los 10 de la proposal siguen vigentes tal como están escritos (R1 matching nacional, R2 cross-tenant, R3 auto-deadlock, R4 borradores huérfanos, R5 listener que re-lanza, R6 payloads congelados, R7 sin cantidad por ítem, R8 nullabilidad irreversible, R9 row types faltantes, R10 presupuesto de review). Lo que este documento agrega o precisa:

- [ ] **R4 se acota pero no se cierra: el borrador no expira** (D-D.1). Un usuario que ignora un borrador lo tiene ahí para siempre, y ese borrador **bloquea** todo borrador automático futuro de ese mismo consumo (D-D.3). Consecuencia aceptada: el borrador pendiente ya dice lo que hay que decir. El camino de salida es aditivo y **no necesita ningún job**: un estado `'descartada'` + una ruta de descarte. Construir expiración hoy exigiría `adapters/scheduling/`, que **D8 prohíbe explícitamente**.
- [ ] **`consumption_id` es un cambio de esquema y de tipos más allá de D3/D4** (D-D.2). Se declara como tal. El riesgo si se difiriera es peor que el de agregarlo: el dato es **irrecuperable** una vez que el evento pasó.
- [ ] **`MatchEncontrado` no está deduplicado.** El usuario puede invocar el matching N veces y publicar N eventos; con `ofertas` encima, eso podría ser N fan-outs de auto-oferta. Se acota parcialmente con el `POST` (D-E: un `GET` lo habría hecho prefetcheable y reintentable). Mitigaciones **nombradas, no construidas**: idempotencia por `refillRequestId` del lado de `ofertas`, o una guarda de estado (`solo si estado === 'abierta'`) — que hoy no se pone porque sería más restrictiva de lo que ningún spec pide.
- [ ] **El matching se permite sobre `'ofertada'` y `'confirmada'`.** Solo `'borrador'` se rechaza (Q6 pregunta exactamente por eso). Re-matchear una solicitud ya confirmada es semánticamente dudoso; hoy es inalcanzable porque D6 deja esas transiciones sin caller. Se revisa cuando `ofertas` las cablee.
- [ ] **El default `estado = 'abierta'` es fail-open bajo D3** (D-G.4). Se neutraliza escribiendo `estado` siempre explícito desde el adaptador, con test. No se cambia el default: sería un delta sobre la migración `04` fuera del alcance de D3/D4.
- [ ] **`refill_items` no tiene `updated_at` ni trigger** — la migración `04` la declara "inmutable una vez creada". `completarBorrador` la **actualiza**. La afirmación del comentario ya no es cierta; no se agrega la columna (delta de esquema sin requisito detrás), pero **se declara la contradicción** en `db-schema-refill-matching` para que no quede como sorpresa.
- [ ] **`Number(null) === 0` puede anular D3 desde el mapper.** El riesgo mecánico de mayor impacto del cambio (ver el callout de row types). Mitigado con conversión explícita, revisión dirigida en el PR 3 y un test de round-trip.
- [ ] **Un borrador solo lleva `nombre`.** `kind` no viaja a `categoria` (`consumo` se niega, con razón), no hay precio y no hay `catalogProductId`. El usuario completa desde cero. **El follow-up de mayor valor sigue siendo el que `consumo` ya nombró**: `user_consumption.catalog_product_id` (columna nullable, puramente aditivo) haría que el borrador naciera con un `catalogProductId` real y que el matching de C7 fuera exacto en vez de difuso por nombre.
- [ ] **El prefijo `refill` rompe 3/3 de precedente** (los otros controllers usan el nombre del dominio). Desviación declarada, con la regla que la justifica ("un dominio con nombre compuesto expone su familia de recursos"), y `pedidos-pagos` la va a heredar. Cero clientes hoy: revertirla es una línea.
- [ ] **`?: never` no se usa en la unión discriminada** (D-B), a diferencia de `Offer`. Desviación declarada con su razón: acá no hay exclusividad estructural, hay un dato desconocido, y un tipo incapaz de representar una fila legal fuerza al mapper a perder datos en silencio.
- [ ] **`RefillCreado`/`MatchEncontrado` se congelan con cero consumidores** (R6). Este documento fija además la **regla** que los gobierna, que es lo que de verdad tiene que sobrevivir: hechos propios y salidas propias, jamás la forma de una entidad ajena. Si `ofertas` necesita un campo más, agregarlo es aditivo; sacar uno, no.
- [ ] **`ALTER TYPE … ADD VALUE` no es reversible** (R8 + D-A). Con cero filas, recrear el tipo es trivial; después de que `ofertas` tenga FKs contra `refill_requests`, no.
- [ ] **`CatalogoModule` es la primera arista entre dos módulos de dominio** del repo. Puramente aditiva y revertible quitando un import, pero es la que marca el precedente de cómo se consume un `contracts/` ajeno. Si sale mal, la historia de extracción a microservicios se redibuja mal para los dos dominios que faltan.

---

## Reconciliación con `specs/` (para `sdd-tasks`)

`sdd-spec` terminó en paralelo sobre la misma proposal y tomó **elecciones conservadoras declaradas como provisorias** en las dos preguntas que este documento resuelve con autoridad (Q5 y Q6: sus propios títulos dicen *"pending design.md confirmation"* y *"reconcile at `sdd-tasks` time"*). Las divergencias, con quién gana y por qué:

| # | `specs/` dice | `design.md` dice | Gana | Motivo |
|---|---|---|---|---|
| 1 | Q6 → 409 **`REFILL_REQUEST_NOT_READY`** | 409 **`REFILL_REQUEST_EN_BORRADOR`**, clase `SolicitudEnBorradorError` | **design** (el spec defiere explícitamente) | Mismo status y mismo razonamiento; solo cambia el string del `code`. `EN_BORRADOR` nombra el estado concreto, en el vocabulario español del dominio (regla `rules.apply`), en vez de una condición genérica |
| 2 | Q5 → prefijo `/refill-matching`, `PATCH .../completar`, **`GET .../proveedores-compatibles`** | prefijo `/refill`, `POST .../completar`, **`POST .../matching`** | **design** (el spec defiere explícitamente) | El `GET → POST` es **load-bearing**: el caso de uso publica `MatchEncontrado`, así que no es seguro ni idempotente y un prefetch/reintento fan-outea auto-ofertas duplicadas (D-E). El prefijo y el verbo de `completar` son cosméticos y baratos de revertir |
| 3 | El listener invoca **"`crearSolicitud`'s borrador path"** | El listener invoca un **6º caso de uso interno**, `crearBorradorRefill` | **design** | No es preferencia: bajo D3+D12, `crearSolicitud(userId, items, direccion, comuna, urgencia)` exige dirección y comuna (que el sistema no tiene) y produce `'abierta'`. No existe un "borrador path" dentro de esa firma (D-G.1). El **comportamiento observable** que el spec exige (exactamente un `'borrador'` por evento) es idéntico |
| 4 | Título: **"`RefillRequest` **y `RefillItem`** become discriminated unions"** | `RefillItem` **conserva su forma exacta**; nace `RefillItemBorrador` al lado | **design**, y es la divergencia más importante | Volver `RefillItem` una unión rompe la compilación de `catalogo` (`buscarCoincidencias(itemsSolicitados: RefillItem[])`, contrato congelado C1–C8), contra un criterio de éxito literal de la proposal. **Los escenarios del spec no exigen lo contrario** — solo prueban las variantes de `RefillRequest`, y las dos siguen pasando. Es el título/prosa lo que hay que ajustar (D-B) |
| 5 | `db-schema` deja Q1 explícitamente a `sdd-design` | **Dos migraciones** (14 y 15), `ADD VALUE 'borrador' BEFORE 'abierta'` | **design** | Restricción de Postgres, no estilo (D-A) |
| 6 | `db-schema` no menciona `consumption_id` | Columna + índice parcial único, **declarados como adicionales a D3/D4** | **design agrega**, el spec necesita un requisito nuevo | D-D.2/D-D.3. Es scope declarado, no expandido en silencio |
| 7 | `core-api` spec no cubre los payloads de los 2 eventos ni el hecho de que un `'borrador'` **no** publica `RefillCreado` | D-C los fija | **design agrega** | R6: se congelan con cero consumidores; deben quedar en el SPEC |
| 8 | Nombre del caso de uso: `completarBorrador` | (alineado en esta revisión) | — | El design.md se ajustó al nombre del spec: es más preciso |

Ninguna divergencia es un conflicto de comportamiento observable salvo la #2 (`GET` vs `POST`) y la #4 (que es un requisito de compilación, no de comportamiento). `sdd-tasks` debe tomar `design.md` como fuente para las 8 filas y emitir los ajustes de prosa correspondientes sobre `specs/`.
