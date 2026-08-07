# Design: `catalogo` — segundo vertical, primer contrato cross-dominio y primera proyección event-driven

Cierra las 3 preguntas que `proposal.md` difirió a esta fase (**Q1**, **Q2**, **Q5b**) y fija el cableado que los 4 dominios restantes van a copiar: cómo se declara un contrato cross-dominio *domain-owned*, cómo se mantiene una proyección desnormalizada alimentada por eventos, y cómo se ordena la superficie HTTP de un vertical de proveedor.

No re-abre D1–D16. No define escenarios Given/When/Then (eso es `sdd-spec`, corriendo en paralelo sobre la misma proposal). Diagramas en ASCII: convención existente del repo (`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, el `design.md` de la fundación); no hay mermaid en ninguna parte.

## Qué cierra este documento

| Sección | Cierra | Respuesta en una línea |
|---|---|---|
| **D-A** | **Q1** — esquema de la proyección de visibilidad | Tabla dedicada `catalog_hidden_companies` (deny-list, PK `company_id`, flag `oculto`), **no** columna en `provider_catalog`. Sin FK a `companies`. Sin DELETE físico |
| **D-B** | **Q2** — semántica de falla de `CatalogQueryPort` | **Lanza** `CatalogQueryUnavailableError`. Nunca devuelve `[]` degradado. Sin `tx?` en la firma, a propósito. El caller mapea a 503 |
| **D-C** | **Q5b** — columnas del índice único parcial | Dos índices parciales **mutuamente excluyentes**: `(company_id, catalog_product_id) WHERE catalog_product_id IS NOT NULL` y `(company_id, lower(btrim(nombre)), lower(btrim(categoria))) WHERE catalog_product_id IS NULL` |
| **D-D** | Wiring de `reactivarEmpresa` (D16) | Espejo de `suspenderEmpresa` **más una precondición**: `status === 'suspendido'` o 409. Asimetría deliberada, explicada |
| **D-E** | Gate de escritura self-service (D9) | `companyStatus` viaja como escalar derivado del actor hasta los 4 casos de uso mutantes. Delta de spec declarado |
| §Diagramas | Los 3 flujos complejos | Carga masiva, visibilidad (ida y vuelta), rechazo cross-tenant |
| §Wiring · §HTTP · §Transacciones · §Migraciones · §Secuencia | Detalle que `sdd-tasks` necesita | Providers, rutas, quién abre transacción, DDL exacto, 9 PRs encadenados |

---

## D-A · Proyección de visibilidad (Q1)

**Choice**: **tabla dedicada `public.catalog_hidden_companies`**, propiedad de `catalogo`, deny-list keyed por `company_id`, con flag `oculto` en vez de borrado físico. **No** una columna desnormalizada en `provider_catalog`.

### Por qué tabla y no columna

| Criterio | Columna en `provider_catalog` | **Tabla deny-list** |
|---|---|---|
| Costo de escritura por evento | **O(N)** — un `UPDATE` sobre todas las filas de esa empresa, dentro del request HTTP del admin que suspende (`emitAsync` espera al listener) | **O(1)** — una fila, sin importar si la empresa tiene 5 o 5.000 productos |
| Atomicidad del efecto | Un `UPDATE` masivo que falla a la mitad deja el catálogo **parcialmente oculto** — un estado que nadie puede diagnosticar | Una sola fila: la proyección está aplicada o no lo está. Nunca a medias |
| Backfill | Necesita una migración de datos que **lea `companies`** — justo el join cross-dominio que D9 existe para evitar | Ninguno. Tabla vacía = nadie oculto |
| Colisión de escritores | **Riesgo real**: D-C convierte `cargarCatalogoMasivo` en un `INSERT … ON CONFLICT … DO UPDATE SET`. Si el `doUpdateSet` no excluye explícitamente la columna de visibilidad, **re-subir un archivo des-oculta en silencio a una empresa suspendida**. Es un fail-open de seguridad a un `SET` de distancia | Imposible por construcción: el proveedor escribe `provider_catalog`, el listener escribe `catalog_hidden_companies`. Cero solapamiento |
| Historia de extracción a microservicio | La columna viaja pegada a la tabla de negocio | La proyección es una tabla aparte, exactamente la forma que `catalogo/SPEC.md` ya prescribe para el caché de `refill-matching` |

El cuarto criterio es el decisivo: no es una diferencia de performance, es una diferencia entre "correcto" y "un `doUpdateSet` distraído desactiva una suspensión".

### Esquema exacto

```sql
create table public.catalog_hidden_companies (
  company_id  uuid primary key,               -- SIN references public.companies (id) — ver abajo
  oculto      boolean     not null default true,
  motivo      text,                            -- copiado del evento, solo para diagnóstico
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

- **Sin FK a `companies`**, deliberadamente. La fuente de verdad de esta fila es el *payload de un evento de otro bounded context*, no una relación local; una FK haría que la extracción de `catalogo` a su propia base sea una mentira (habría que dropearla igual). El modo de falla de no tenerla es inocuo y verificable: un `company_id` basura no matchea ninguna fila de `provider_catalog`, así que **oculta exactamente nada**. Una FK compra integridad contra un riesgo que no existe (el único escritor es el listener) y vende la propiedad que motivó la tabla.
- **Sin índice adicional.** La PK es el único camino de acceso (el anti-join prueba por `company_id`) y la tabla se espera en el orden de decenas de filas.
- **`oculto boolean` en vez de borrado físico.** El repo no tiene `DELETE` en ningún grant (`20260804090500_10_…` es explícito: *"no DELETE anywhere in this schema"*). La regla de producto (`docs/ARCHITECTURE.md`, "Principio de dar de baja") está escrita para entidades de negocio, y esta tabla no lo es — pero pedir `grant delete` para una proyección sería la primera excepción a una convención uniforme, a cambio de ahorrar una columna. Con el flag: **todas las escrituras son upsert/update, idempotentes por construcción**, y la propiedad esencial del deny-list se conserva intacta — *fila ausente ⇒ empresa visible*, cero backfill.
- **RLS habilitada, cero políticas, cero grants a `anon`/`authenticated`.** Ningún cliente lee esta tabla jamás; es estado interno de `catalogo`.

Row type de Kysely (extiende D13, que solo nombraba dos tablas):

```ts
export interface CatalogHiddenCompaniesTable {
  company_id: string;
  oculto: Generated<boolean>;
  motivo: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}
```

### Dónde se aplica el filtro (corrección a un criterio de éxito)

`buscarProductos(query, categoria?)` devuelve **`CatalogProduct[]`** — filas de `catalog_products`, el catálogo de referencia compartido, que **no tiene columna `company_id`**. No hay nada que filtrar ahí, y filtrarlo sería incorrecto: ocultar un producto de referencia porque *un* proveedor fue suspendido corrompería el buscador para todos los usuarios. El criterio de éxito de la proposal (*"`buscarProductos` … deja de devolver ítems de esa empresa"*) es más ancho de lo que el tipo de retorno permite; se declara como delta para `sdd-spec` (ver §Deltas).

Regla precisa, que sí es implementable:

| Camino de lectura | ¿Filtra por la proyección? | Por qué |
|---|---|---|
| `CatalogQueryPort.buscarCoincidencias` | **Sí** | Lectura de matching cross-tenant — es el caso que D9 nombra |
| `CatalogRepository.findMatching` | **Sí** | Devuelve `ProviderCatalogItem[]` de cualquier empresa: misma superficie marketplace |
| `CatalogRepository.findByCompany` | **No** | Es la vista del proveedor sobre **su propio** catálogo. D-E de la fundación ya lo fijó: *"un proveedor con empresa suspendida sigue autenticado y debe poder leer su propio estado"* |
| `buscarProductos` | **No aplica** | `catalog_products` no tiene dimensión de empresa |

Predicado, idéntico en ambas queries filtradas:

```sql
and not exists (
  select 1 from public.catalog_hidden_companies h
  where h.company_id = pc.company_id and h.oculto
)
```

### Qué eventos consume el listener (y por qué `EmpresaAprobada` NO es redundante)

| Evento | Efecto en la proyección |
|---|---|
| `empresa.suspendida` | `ocultarEmpresa(companyId, motivo)` — upsert `oculto = true` |
| `empresa.reactivada` (D16) | `mostrarEmpresa(companyId)` — `UPDATE … SET oculto = false WHERE company_id = $1` |
| `empresa.aprobada` | **mismo handler que `reactivada`** |

Consumir `EmpresaAprobada` parece redundante bajo un deny-list (una empresa `pendiente` nunca estuvo en la lista, así que el `UPDATE` toca 0 filas). **No lo es**, y esto se verificó en código: `AprobarEmpresaUseCase` **no tiene precondición de estado** — hace `findById` y setea `activo` venga de donde venga. Un admin que aprueba una empresa **suspendida** la deja `activo` publicando `EmpresaAprobada`. Si el listener no lo consumiera, esa empresa quedaría activa con su catálogo oculto para siempre: un fail-**closed** silencioso, invisible en `companies`. Consumirlo cuesta un decorador `@OnEvent` extra sobre el mismo método, mantiene intacta la lista *"Eventos que consume"* de `catalogo/SPEC.md` (cero delta ahí) y hace del `UPDATE` de 0 filas el caso normal, no el excepcional.

> Follow-up nombrado, fuera de scope: agregarle a `aprobarEmpresa` la precondición `status === 'pendiente'`. Tocarlo acá violaría la mitigación de R9 (`identidad` se toca **solo** de forma aditiva).

### Cómo el listener se acopla a `identidad` — y cómo no

El listener suscribe por **el nombre del canal** (`'empresa.suspendida'`) y tipa su parámetro con una interfaz **declarada localmente** en `catalogo/adapters/events/`:

```ts
// domains/catalogo/adapters/events/identidad-event.payloads.ts
export interface EmpresaOcultablePayload { readonly companyId: string; readonly motivo?: string }
```

**No importa las clases de evento de `identidad`.** La regla de ESLint no lo prohíbe hoy (`events/` no está en `RESTRICTED_SUBPATHS`), pero importarlas haría que `catalogo` dejara de compilar el día que `identidad` se extraiga — el acoplamiento exacto que la desnormalización event-driven existe para evitar. Un consumidor de broker deserializa contra su propio esquema; esto es la versión in-process de lo mismo. `catalogo` depende de `{ companyId }` y de nada más (nótese que `motivo` es opcional en el payload local aunque `EmpresaSuspendida` lo tenga obligatorio: el consumidor no debe poder romperse si el productor lo vuelve opcional).

**Costo de esa decisión, y su mitigación**: sin import no hay chequeo en compilación, así que renombrar el `type` de un evento en `identidad` rompe el listener en silencio. Mitigación obligatoria: **un test de contrato en `services/core-api/test/`** (fuera de `domains/`, donde la regla de zonas no aplica) que publique instancias **reales** de `EmpresaSuspendida`/`EmpresaReactivada`/`EmpresaAprobada` por el `EVENT_PUBLISHER` real y afirme que la proyección cambió. Ese test es lo que convierte el riesgo de ruptura silenciosa en un fallo de CI.

### El listener nunca relanza

`EventEmitterPublisher.publish` usa `emitAsync`: si un listener rechaza, **rechaza el `publish()` del productor** — es decir, el error del listener de `catalogo` explotaría dentro del request HTTP de `suspenderEmpresa`, **después** de que su transacción ya commiteó. El admin recibiría 5xx por una operación exitosa y reintentaría algo ya hecho.

Regla: **el listener captura todo, loguea `logger.error` con `{ evento, companyId }`, y no relanza.** La proyección es fail-open por diseño (R4, aceptado y acotado: `provider_catalog` con `disponible = true` ya es vista pública de marketplace, no hay fuga de datos), y ese log es el insumo del follow-up de reconciliación que la proposal ya dejó fuera de scope. Es la misma familia que la rama A3 de D-B de la fundación (*"logger.error({ orphanUid }) … NO se reintenta"*), sin el `throw` porque acá no hay nada que el caller pueda remediar.

---

## D-B · Semántica de falla de `CatalogQueryPort` (Q2)

**Choice**: `buscarCoincidencias` **lanza** `CatalogQueryUnavailableError` ante cualquier fallo de infraestructura. **Nunca** devuelve un resultado vacío o degradado.

### Cuál es el modo de falla real

`refill-matching` → `catalogo` es una llamada a un método de una clase, en el mismo proceso Node, dentro del mismo request. **La partición de red no existe.** Lo que sí puede pasar, en orden de probabilidad real:

1. **Agotamiento del pool** (el peligroso). `pg.Pool` corre hoy con `max` por defecto (10) y **`connectionTimeoutMillis` sin setear, es decir: esperar para siempre** (verificado en `shared/database/pool.provider.ts`). Si el caller ya tiene una conexión tomada — por ejemplo, está dentro de su propia transacción — y encima pide una segunda para esta query, N requests concurrentes se auto-bloquean: cada una con 1 conexión, todas esperando la 2ª, pool vacío, espera infinita. **No cuelga este endpoint: cuelga toda la API.**
2. **Query lenta**: tampoco hay `statement_timeout`.
3. Postgres caído / conexión reseteada → `pg` lanza.
4. Bug de SQL → lanza.

### Por qué lanza y no degrada

- **`[]` ya es una respuesta de negocio válida** — "ningún proveedor tiene estos productos". Si el puerto colapsa "la base no contesta" en "no hay coincidencias", el caller no puede distinguirlas y `refill-matching` toma una decisión de negocio equivocada, visible para el usuario y probablemente persistida, causada por un hipo de infraestructura. Es exactamente la clase de fail-open que D-E de la fundación ya prohibió: *"Fallo de infraestructura es 503, jamás allow"*.
- **La degradación es política del caller, no del puerto.** El caller puede querer reintentar, caer a un caché, o devolver 503. El puerto no puede saberlo. Un caller que quiere degradar escribe `catch { return [] }` en tres líneas; un caller que quiere corrección **no puede recuperar** la información que el puerto ya tiró. La asimetría de reversibilidad decide.
- **Consistente con el repo**: `ActorPort.findActorById` lanza ante DB caída y el guard responde 503; `CompanyRepository.findById` devuelve `null` **solo** para "la fila no está". Regla uniforme: **`null`/`[]` significa "los datos dicen que no"; una excepción significa "no pude preguntar".**

### El contrato, tal como `refill-matching` lo va a leer

```ts
// domains/catalogo/contracts/catalog-query.port.ts   (D1: interfaz + token acá; clase concreta en adapters/persistence/)
import type { ProviderCatalogItem, RefillItem } from '@repon/types';

/** Tope defensivo por ítem solicitado. Subirlo es aditivo; introducirlo después, no. */
export const MAX_COINCIDENCIAS_POR_ITEM = 50;

/** Único error del contrato. `cause` preserva el error original del driver. */
export class CatalogQueryUnavailableError extends Error {
  constructor(message = 'El catálogo no pudo responder la consulta.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogQueryUnavailableError';
  }
}

export interface CatalogQueryPort {
  buscarCoincidencias(
    itemsSolicitados: RefillItem[],
    companyId?: string,
  ): Promise<ProviderCatalogItem[]>;
}

export const CATALOG_QUERY_PORT = Symbol('CATALOG_QUERY_PORT');
```

| # | Cláusula del contrato | Detalle |
|---|---|---|
| **C1** | **Sin `tx?`, a propósito** | Todo método de todo ports-out del repo lleva `tx?: TransactionContext` (D-A de la fundación). **Este no.** Aceptarlo invitaría a un caller a enlistar la lectura de catálogo en *su* transacción, compartiendo ciclo de vida transaccional entre dos dominios — un acoplamiento peor que compartir una tabla, y sin sentido el día que esto sea HTTP. **La ausencia de `tx?` es la señal estructural de que esto es `contracts/` y no `ports-out/`** |
| **C2** | **El caller NO debe invocarlo con una transacción abierta** | Consecuencia directa de C1: el puerto toma su propia conexión del pool. Llamarlo desde adentro de un `runInTransaction` es la receta del auto-deadlock del punto 1. Va escrito en el doc comment de la interfaz, que es lo único que el consumidor va a leer |
| **C3** | **Solo lectura, sin efectos** | Prohibido cachear escribiendo, contar invocaciones, o mutar nada. Garantiza que sea seguro llamarlo N veces y que mañana pueda ir a una réplica de lectura |
| **C4** | **El filtro de visibilidad va adentro** (D9) | Nunca devuelve ítems de una empresa oculta. El consumidor **no puede** re-filtrar: no tiene acceso a la proyección |
| **C5** | **Filtra `disponible = true`; NO filtra por `stock`** | `disponible` es literalmente el campo de disponibilidad y es el mismo predicado que la política RLS pública. `stock` se devuelve crudo: `RefillItem` **no tiene campo de cantidad** (verificado en `packages/types/src/refill-matching.ts`), así que decidir "cuánto stock alcanza" es imposible acá y le corresponde al consumidor |
| **C6** | **Un solo round-trip para todo el array** | `itemsSolicitados` se resuelve con una query, no con N. Un refill de 10 ítems no puede costar 10 viajes a la base |
| **C7** | **Semántica de matching** | Por ítem: si `catalogProductId` está presente → match exacto por `provider_catalog.catalog_product_id`; si no → `categoria` exacta + `nombre` por trigram (los índices GIN ya existen). Unión de todos los ítems, deduplicada por `provider_catalog.id`, tope `MAX_COINCIDENCIAS_POR_ITEM` por ítem solicitado. `companyId?` acota a un solo proveedor (uso previsto: ofertas proactivas de `ofertas`) |
| **C8** | **Mapeo HTTP para el consumidor** | Quien lo exponga por HTTP **debe** mapear `CatalogQueryUnavailableError` a **503 `CATALOG_UNAVAILABLE`**. Nunca 200 con lista vacía, nunca 500 |

**El adaptador envuelve, siempre.** `KyselyCatalogQueryAdapter` captura cualquier error de Kysely/`pg` y lo re-lanza como `CatalogQueryUnavailableError` con `cause`. Sin el wrap, un `DatabaseError` de `pg` cruzaría el borde cross-dominio y `refill-matching` terminaría haciendo `instanceof` contra la clase del driver de `catalogo` — precisamente el acoplamiento que `contracts/` existe para impedir.

### Un timeout finito es parte del contrato, no un detalle operativo

"Lanza ante fallo" es vacío si el fallo es una espera infinita. Cambio in-scope, contenido, en `shared/database/pool.provider.ts`:

```ts
new Pool({
  connectionString,
  connectionTimeoutMillis: 2_000,          // agotamiento del pool -> error, jamás cuelgue
  options: '-c statement_timeout=5000',    // query lenta -> error, jamás cuelgue
})
```

Ambos aplican a **todo** el proceso, no solo a este puerto — es la corrección de un default peligroso que hoy afecta también a `identidad`. `statement_timeout` es **por sentencia**, así que ni el bucle fila-a-fila de la carga masiva ni la transacción de `ajustarPreciosPorCategoria` se ven afectados (cada `INSERT`/`UPDATE` individual está órdenes de magnitud por debajo de 5 s). Los valores son defaults declarados, revisables con una medición; lo no negociable es que sean **finitos**.

---

## D-C · Índices únicos parciales de `provider_catalog` (Q5b)

**Choice**: **dos** índices únicos parciales con predicados **mutuamente excluyentes y exhaustivos**.

```sql
-- Ítems ligados al catálogo de referencia
create unique index provider_catalog_company_catalog_product_uidx
  on public.provider_catalog (company_id, catalog_product_id)
  where catalog_product_id is not null;

-- Ítems propios del proveedor, no listados en el catálogo de referencia
create unique index provider_catalog_company_nombre_categoria_uidx
  on public.provider_catalog (company_id, lower(btrim(nombre)), lower(btrim(categoria)))
  where catalog_product_id is null;
```

### Por qué `(company_id, nombre, categoria)` es la única opción posible — verificado

`provider_catalog` tiene exactamente estas columnas portadoras de identidad: `catalog_product_id`, `nombre`, `categoria` (verificado contra `20260803120300_03_catalogo.sql` y `ProviderCatalogItem` en `packages/types/src/catalogo.ts`). **No hay SKU, no hay código de barras, y `presentacion` existe en `catalog_products` pero NO en `provider_catalog`.** El candidato de la proposal no es solo razonable: es el único conjunto disponible.

**¿Alcanza?** El caso preocupante es un mismo proveedor vendiendo dos presentaciones del mismo producto ("Alimento Premium" 3 kg y 15 kg). Sin columna `presentacion`, el modelo de datos **obliga** al proveedor a codificar el formato dentro de `nombre` — no tiene otro campo — así que en la práctica los dos nombres difieren y el índice los distingue correctamente. El riesgo real es el inverso: **sub-normalización**. `"Alimento Premium 3Kg"` vs `"alimento premium 3kg "` son la misma fila para un humano y dos filas para Postgres, lo que rompe la idempotencia del re-upload que D15 existe para garantizar. De ahí `lower(btrim(…))`: ambas funciones son `IMMUTABLE`, así que son indexables, y normalizan exactamente el ruido que un CSV produce (mayúsculas y espacios) **sin** tocar dígitos ni unidades, que son justamente lo que distingue las presentaciones.

**Riesgo residual, nombrado**: si un proveedor sube dos productos genuinamente distintos con nombre y categoría idénticos, el segundo **actualiza** al primero en vez de crear una fila. `ResultadoCargaMasiva` lo reporta como cargado, no como colisión. Mitigación disponible sin cambiar el esquema: `sdd-spec` puede exigir que el parser rechace **filas duplicadas dentro del mismo archivo** (detección en memoria, O(N), antes de tocar la base) — eso cubre el 100% de los casos accidentales dentro de un upload y deja fuera solo la colisión entre uploads distintos, que ya es una decisión consciente del proveedor.

### Por qué los predicados deben ser mutuamente excluyentes (lo que hace que el upsert funcione)

`ON CONFLICT` sólo puede nombrar **un** conflict target. Si el segundo índice fuera incondicional, una fila con `catalog_product_id` no nulo quedaría cubierta por **los dos** índices; el `INSERT` declararía uno como target y la violación del *otro* saldría como un `unique_violation` 23505 crudo que `ON CONFLICT` **no atrapa** — es decir, la fila fallaría con un error de driver en vez de hacer upsert, de forma intermitente y dependiente de los datos. Con `IS NOT NULL` / `IS NULL`, **toda fila cae en exactamente un índice**, así que hay siempre un único target correcto y ningún 23505 sorpresivo es posible.

Consecuencia directa para `KyselyCatalogRepository.save`: **el upsert se bifurca según haya o no `catalogProductId`**.

```
catalogProductId presente ->  ON CONFLICT (company_id, catalog_product_id)
                              WHERE catalog_product_id IS NOT NULL
                              DO UPDATE SET nombre, categoria, precio_base, precio_maximo,
                                            stock, disponible, imagen_url

catalogProductId ausente  ->  ON CONFLICT (company_id, lower(btrim(nombre)), lower(btrim(categoria)))
                              WHERE catalog_product_id IS NULL
                              DO UPDATE SET nombre, categoria, precio_base, precio_maximo,
                                            stock, disponible, imagen_url
```

Dos reglas duras del `DO UPDATE SET`:

- **Nunca setea `catalog_product_id`.** En la rama 1 es la clave del conflicto; en la rama 2, setearlo movería la fila del índice B al índice A. Ligar un ítem suelto a un producto de referencia es una operación aparte, no un efecto colateral de re-subir un archivo.
- **Nunca setea `company_id`.** Es parte de la clave y el upsert siempre se construye con el `companyId` forzado por D8.

`nombre` **sí** se refresca (`DO UPDATE SET nombre = excluded.nombre`): el índice normaliza para *identificar*, pero la fila guarda el casing tal como el proveedor lo escribió por última vez.

### Ventana para crear los índices: ahora, no después

`provider_catalog` está **vacía** — no existe ningún escritor en el repo (`catalogo` es hoy un `@Module({})` vacío). Por eso `CREATE UNIQUE INDEX` no puede fallar por duplicados preexistentes y no necesita `CONCURRENTLY`. En el momento en que la primera carga masiva corra sin el índice, agregarlo se convierte en un problema de limpieza de datos. **Los índices van en el PR 1, no "antes del slice 3".**

### Gotcha de `numeric` que bloquearía el adaptador (descubierto acá, sin precedente en el repo)

`precio_base`/`precio_maximo` son `numeric(12,2)`, y **node-postgres devuelve `numeric` como `string`** (parser por defecto del OID 1700, para no perder precisión en float). Son las primeras columnas numéricas no enteras del esquema: `companies`, `profiles`, `admin_roles` y `audit_log` no tienen ninguna, así que no hay precedente que copiar y el bug aparecería como `"1200.00" >= "300.00" === false` en una comparación de strings.

- Row type: `precio_base: string`, `precio_maximo: string`. La conversión a `number` vive en el mapper de `adapters/persistence/`, junto al resto del cruce `snake_case ⇄ camelCase`.
- **El caso de uso redondea a 2 decimales antes de escribir** (`Math.round(x * 100) / 100`) y **valida la invariante sobre los valores ya redondeados**. Así Postgres nunca re-redondea, y la afirmación de D5 ("el redondeo es monótono, no puede invertir el orden") se cumple con el redondeo que el dominio hizo, no con uno que la base aplicó por su cuenta a espaldas de la entidad.

---

## D-D · Wiring de `reactivarEmpresa` (D16)

Espejo exacto de `SuspenderEmpresaUseCase` — mismos 4 puertos inyectados (`COMPANY_REPOSITORY`, `AUDIT_LOG_PORT`, `EVENT_PUBLISHER`, `TRANSACTION_MANAGER`), misma estructura `runInTransaction { findById → save → auditLogPort.record }` y `publish` después del commit — **con una diferencia deliberada**:

**`reactivarEmpresa` exige `company.status === 'suspendido'`; si no, lanza `CompanyNotSuspendedError` → 409.**

`suspenderEmpresa` no tiene precondición y está bien que no la tenga: su estado destino (`suspendido`) es alcanzable desde cualquier estado y es **restrictivo** — fallar hacia ahí es fallar seguro. El destino de `reactivarEmpresa` (`activo`) es **permisivo**: sin precondición, `POST /empresas/:id/reactivacion` sobre una empresa `pendiente` la activa saltándose la aprobación y dejando una traza de auditoría que dice `reactivar_empresa` cuando lo que pasó fue una aprobación. Asimetría de riesgo ⇒ asimetría de guarda. No es re-abrir D16 (que fijó *la forma*: admin-mutante, auditado en la misma transacción, publica evento); es el detalle de wiring que D16 delegó.

Todo lo que toca `identidad` es **aditivo** (mitigación de R9):

| Archivo | Cambio |
|---|---|
| `ports-in/reactivar-empresa.use-case.ts` | **Nuevo** |
| `events/empresa-reactivada.event.ts` | **Nuevo** — `type = 'empresa.reactivada'`, `(companyId, motivo)` |
| `adapters/http/dto/reactivacion.dto.ts` | **Nuevo** — un `motivo`, idéntico a `SuspensionDto`. Se duplican 6 líneas en vez de reusar un DTO llamado `SuspensionDto` en una ruta de reactivación: el nombre engañoso está en un borde sensible a seguridad, y reusarlo obligaría a tocar `identidad-dto.spec.ts` (existente, verde) |
| `domain/identidad.errors.ts` | **Append** de `CompanyNotSuspendedError` — ninguna clase existente cambia |
| `adapters/http/identidad-exception.filter.ts` | **Append** de una entrada al `ERROR_STATUS_MAP` (409 `COMPANY_NOT_SUSPENDED`) y del nombre a `@Catch(...)`. El mapa está keyeado por constructor justamente para que esto sea *"a one-line append"* (su propio comentario) |
| `identidad.module.ts` | **Append** de `ReactivarEmpresaUseCase` a `providers`. Nada más: los 4 tokens que necesita ya están provistos |
| `adapters/http/identidad.controller.ts` | **Append** de un método |

---

## D-E · Gate de escritura self-service (D9), sin adivinanzas

D9 resuelve el gate con `actor.companyStatus === 'activo'`. Falta decir **dónde** se chequea. D-E de la fundación ya lo asignó: *"que no pueda ofertar es una regla de negocio de `ofertas`/`catalogo`, chequeada en el caso de uso"*.

**Los 4 casos de uso mutantes reciben `companyStatus` como segundo escalar derivado del actor**, junto a `companyId`. Es la misma regla de D8 aplicada al mismo lugar: el controlador pasa escalares del actor, nunca el actor.

- **Un guard de ruta** (`@EmpresaActiva()`) evitaría el delta de firma, pero pone autorización en el adaptador: cualquier caller no-HTTP futuro la saltea, y bajo D14 el test negativo obligatorio ("empresa pendiente → rechazo") pasaría de ser un test unitario con puertos mockeados a un e2e — justo el tipo de test que strict TDD quiere escribir **primero** y barato.
- Es **un delta declarado, no cuatro**: una regla, cuatro aplicaciones (misma forma que D8).

`buscarProductos` no lo recibe: leer el catálogo de referencia no requiere empresa activa.

---

## Diagrama 1 · `cargarCatalogoMasivo` de punta a punta (D2 + D3 + D11 + D-C)

```
 cliente          CatalogoController              CargarCatalogoMasivoUseCase        CatalogRepository    EventPublisher
                  (adapters/http, D11)            (ports-in, D2)                     (ports-out)          (shared)
    |                     |                                |                              |                  |
 POST /catalogo/mi-catalogo/carga-masiva                    |                              |                  |
 multipart/form-data: archivo=<csv>                         |                              |                  |
    |-------------------->|                                |                              |                  |
    |                (P1) FileInterceptor('archivo') + validación de ENVOLTORIO en el DTO:
    |                     |   mimetype text/csv, tamaño <= 2 MB, 1 <= filas <= 500, cabecera esperada
    |                     |   falla ==> 400 ARCHIVO_CARGA_INVALIDO   (nada se escribió, nada se emitió)
    |                (P2) csv-parse -> ArchivoCarga { filas: [{ numero, producto }] }
    |                     |   SOLO forma: mapea columnas a claves y castea con Number() (NaN permitido).
    |                     |   CERO validación de valores acá: si el DTO validara fila por fila, una
    |                     |   sola fila mala haría 400 de todo el archivo y D2 dejaría de cumplirse.
    |                (P3) |--- execute(actor.companyId, actor.companyStatus, archivo) ------>|
    |                     |     D8: ningún DTO acepta companyId; D-E: companyStatus va como escalar
    |                     |                                |                              |                  |
    |                     |                          (1)  companyStatus !== 'activo'
    |                     |                                |   ==> EmpresaNoActivaError ==> 403
    |                     |                                |
    |                     |                          (2)  POR CADA fila  --- SIN runInTransaction (D2) ---
    |                     |                                |   la garantía no es un test: este caso de uso
    |                     |                                |   NO inyecta TRANSACTION_MANAGER en absoluto.
    |                     |                                |
    |                     |                                |  2a. ProviderCatalogItem.crear(companyId, fila.producto)
    |                     |                                |      nombre/categoria no vacíos; precios finitos y >= 0;
    |                     |                                |      redondeo a 2 decimales; precioMaximo >= precioBase;
    |                     |                                |      stock entero >= 0
    |                     |                                |      lanza -> fallos.push({numero, motivo}); CONTINÚA
    |                     |                                |
    |                     |                                |  2b. |--- save(item) ---------->|  upsert D-C,
    |                     |                                |      |                          |  target según
    |                     |                                |      |                          |  catalogProductId
    |                     |                                |      |<-- ok -------------------|  cargados++
    |                     |                                |      |<-- throw ----------------|  fallos.push({numero,
    |                     |                                |                                 |  motivo}); CONTINÚA
    |                     |                                |
    |                     |                          (3)  |--- publish(CatalogoCargaMasivaCompletada
    |                     |                                |        { companyId, totalCargados, totalFallidos }) --->|
    |                     |                                |    EXACTAMENTE UNO, siempre — incluso con 0 cargados.
    |                     |                                |    Cero ProductoAgregado por fila (D3: emitAsync
    |                     |                                |    serializa N fan-outs dentro de este mismo request).
    |                     |                                |
    |<-- 200  ResultadoCargaMasiva { totalFilas, totalCargados, totalFallidos, fallos:[{numero,motivo}] }
    |
    |  Reintento del MISMO archivo: cada fila colisiona con su índice único (D-C) y hace UPDATE.
    |  totalCargados idéntico, cero filas nuevas. Esa es la propiedad que D15 compra.
```

**`numero` es 1-based, excluyendo la cabecera.** Sin el número de fila, "3 filas fallaron" es un reporte que el proveedor no puede accionar; con él, `ResultadoCargaMasiva` es una lista de correcciones.

---

## Diagrama 2 · Visibilidad: suspensión, reactivación y el efecto en las lecturas (D9 + D16 + D-A)

```
 admin       identidad/ports-in            EventPublisher   catalogo/adapters/events    catalogo/ports-in      catalogo/ports-out
             Suspender / Reactivar         (emitAsync)      CompanyVisibilityListener   Ocultar/Restaurar      CatalogVisibilityProjection
   |                 |                          |                     |                        |                        |
 POST /identidad/empresas/:id/suspension        |                     |                        |                        |
   |---------------->|                          |                     |                        |                        |
   |            (1)  runInTransaction: UPDATE companies -> 'suspendido'  +  INSERT audit_log
   |                 |   ---- COMMIT ---- (el evento se publica DESPUÉS del commit, nunca dentro)
   |            (2)  |--- publish(EmpresaSuspendida{companyId, motivo}) --->|
   |                 |                          |--- @OnEvent('empresa.suspendida') --->|
   |                 |                     (3)  |    lee SOLO { companyId, motivo } contra una interfaz
   |                 |                          |    declarada en catalogo; NO importa la clase de identidad
   |                 |                          |                     |--- execute(companyId, motivo) --->|
   |                 |                          |                     |                        |--- ocultarEmpresa() -->|
   |                 |                          |                     |                        |  INSERT (company_id,
   |                 |                          |                     |                        |  oculto, motivo)
   |                 |                          |                     |                        |  ON CONFLICT (company_id)
   |                 |                          |                     |                        |  DO UPDATE SET oculto=true
   |<-- 204 ---------|                          |                     |                        |
   |
   |  == FALLO DEL LISTENER (rama obligatoria) ============================================================
   |     (4) catch { logger.error({ evento, companyId }) }  y NO relanza.
   |         emitAsync propaga el rechazo al publisher: relanzar convertiría un 204 correcto en 5xx
   |         sobre una mutación YA commiteada. Fail-open aceptado (R4); el log alimenta la
   |         reconciliación, que es follow-up nombrado y fuera de scope.
   |
   |  == EFECTO EN LAS LECTURAS (inmediato, sin caché) ====================================================
   |     buscarCoincidencias / findMatching agregan a su WHERE:
   |         and not exists (select 1 from catalog_hidden_companies h
   |                         where h.company_id = pc.company_id and h.oculto)
   |     findByCompany  -> NO filtra  (el proveedor sigue viendo su propio catálogo)
   |     buscarProductos-> NO aplica  (catalog_products no tiene company_id)
   |
   |  == REVERSO: reactivación (D16) ======================================================================
 POST /identidad/empresas/:id/reactivacion
   |---------------->|                          |                     |                        |                        |
   |            (5)  company.status !== 'suspendido'  ==> CompanyNotSuspendedError ==> 409  (D-D)
   |            (6)  runInTransaction: UPDATE companies -> 'activo'  +  INSERT audit_log('reactivar_empresa')
   |            (7)  |--- publish(EmpresaReactivada{companyId, motivo}) --->|
   |                 |                          |--- @OnEvent('empresa.reactivada') --->|
   |                 |                          |--- @OnEvent('empresa.aprobada') ----->|   MISMO handler (D-A):
   |                 |                          |         aprobarEmpresa no tiene precondición de estado, así que
   |                 |                          |         puede sacar de 'suspendido' publicando EmpresaAprobada.
   |                 |                          |         Sin este @OnEvent la empresa quedaría activa y oculta
   |                 |                          |         para siempre — fail-CLOSED invisible.
   |                 |                          |                     |--- execute(companyId) ----------->|
   |                 |                          |                     |                        |--- mostrarEmpresa() -->|
   |                 |                          |                     |                        |  UPDATE ... SET oculto=false
   |                 |                          |                     |                        |  WHERE company_id = $1
   |                 |                          |                     |                        |  (0 filas = ya visible: OK)
   |<-- 204 ---------|
```

---

## Diagrama 3 · `actualizarPrecio`: rechazo cross-tenant (D7 + D8)

```
 proveedor de EMPRESA A     CatalogoController        ActualizarPrecioUseCase        CatalogRepository
        |                          |                          |                             |
  PUT /catalogo/mi-catalogo/{itemId de la EMPRESA B}/precio
  body: { precioBase, precioMaximo }     <-- el DTO NO tiene companyId. No existe tal campo (D8)
        |------------------------->|                          |                             |
        |                     (1)  @Roles('provider') ya pasó; el actor trae companyId = A
        |                     (2)  |--- execute(actor.companyId=A, actor.companyStatus,
        |                          |            itemId, precioBase, precioMaximo) --------->|
        |                          |                          |                             |
        |                          |                     (3)  |--- findById(itemId) ------->|
        |                          |                          |<-- item { companyId: B } ---|
        |                          |                          |
        |                          |                     (4)  item.companyId (B) !== companyId (A)
        |                          |                          |   throw CatalogItemNotFoundError
        |<-- 404 { statusCode:404, code:'CATALOG_ITEM_NOT_FOUND' } -------------------------|
        |
        |  Byte a byte idéntico a la rama "el ítem no existe" ((3) devuelve null).
        |  404 y NO 403, a propósito: un 403 confirmaría que el ítem existe y es de otra
        |  empresa, filtrando existencia cross-tenant por enumeración de itemId (D7).
        |  El log interno SÍ distingue ambos casos; la respuesta HTTP no.
        |
        |  == CAMINO FELIZ (mismo proveedor, ítem propio) =============================
        |                     (4') item.companyId === companyId
        |                     (5)  item.actualizarPrecio(base, max)  <- redondea a 2 decimales
        |                          |    y valida precioMaximo >= precioBase EN LA ENTIDAD.
        |                          |    El CHECK de Postgres es una red de seguridad, no el validador.
        |                     (6)  |--- save(item) ------------------------------------->|
        |                     (7)  |--- publish(PrecioActualizado) -->
        |<-- 204 ------------------|
```

**Sin transacción, y es correcto.** El par `findById` + `save` tiene ventana TOCTOU teórica, pero: (i) el chequeo de propiedad no se puede correr — `company_id` nunca cambia; (ii) dos updates concurrentes del mismo tenant sobre el mismo ítem son ambos intencionales, y último-gana es la semántica esperada; (iii) el riesgo clásico de un upsert-por-id (que la fila desaparezca entre el `findById` y el `save`, y el upsert la re-cree con datos viejos) **no existe en este esquema**: no hay `DELETE` en ningún grant.

---

## Wiring de módulos y tokens

### `catalogo.module.ts` — de `@Module({})` a providers reales

```ts
@Module({
  imports: [DatabaseModule],                       // redundante (es @Global) pero explícito: mismo estilo que IdentidadModule
  controllers: [CatalogoController],
  providers: [
    { provide: CATALOG_REPOSITORY,            useClass: KyselyCatalogRepository },
    { provide: CATALOG_QUERY_PORT,            useClass: KyselyCatalogQueryAdapter },
    { provide: CATALOG_VISIBILITY_PROJECTION, useClass: KyselyCatalogVisibilityProjection },
    BuscarProductosUseCase,
    CargarProductoCatalogoUseCase,
    CargarCatalogoMasivoUseCase,
    ActualizarPrecioUseCase,
    AjustarPreciosPorCategoriaUseCase,
    OcultarCatalogoEmpresaUseCase,
    RestaurarCatalogoEmpresaUseCase,
    CompanyVisibilityListener,                     // @OnEvent: se registra por estar en providers
  ],
  exports: [CATALOG_QUERY_PORT],                   // ÚNICO export. Nada más cruza el borde
})
export class CatalogoModule {}
```

`app.module.ts` **no cambia** (ya importa `CatalogoModule`). `TRANSACTION_MANAGER`, `EVENT_PUBLISHER` y `DATABASE` vienen del shared kernel `@Global()`. `AUDIT_LOG_PORT` **no se inyecta en ningún lado de este dominio** (D10, decisión explícita).

### Tokens y ubicación

| Token | Interfaz | Carpeta | ¿Cross-dominio? |
|---|---|---|---|
| `CATALOG_QUERY_PORT` | `CatalogQueryPort` | **`contracts/`** (D1) | **Sí** — único importable desde afuera |
| `CATALOG_REPOSITORY` | `CatalogRepository` | `ports-out/` | No — persistencia interna |
| `CATALOG_VISIBILITY_PROJECTION` | `CatalogVisibilityProjection` | `ports-out/` | No — persistencia interna |

La clase que implementa `CatalogQueryPort` (`KyselyCatalogQueryAdapter`) vive en **`adapters/persistence/`**, no en `contracts/` (D1). `contracts/` guarda **solo interfaz + token**: es lo único que `ofertas`/`refill-matching` necesitan (`@Inject(CATALOG_QUERY_PORT)` + el tipo), y la regla de ESLint (`import-x/no-restricted-paths`) ya bloquea `adapters/persistence/` desde otro dominio sin configuración nueva.

### Estructura de archivos nueva

```
domains/catalogo/
├── contracts/
│   └── catalog-query.port.ts                 (movido desde ports-out/ — interfaz + token + error + tope)
├── domain/
│   ├── provider-catalog-item.entity.ts       (crear/actualizarPrecio/aplicarPorcentaje + invariante D5)
│   └── catalogo.errors.ts
├── ports-in/
│   ├── buscar-productos.use-case.ts
│   ├── cargar-producto-catalogo.use-case.ts
│   ├── cargar-catalogo-masivo.use-case.ts
│   ├── actualizar-precio.use-case.ts
│   ├── ajustar-precios-por-categoria.use-case.ts
│   ├── ocultar-catalogo-empresa.use-case.ts      ── proyección interna, SIN superficie HTTP
│   └── restaurar-catalogo-empresa.use-case.ts    ── proyección interna, SIN superficie HTTP
├── ports-out/
│   ├── catalog-repository.port.ts            (+ findById, + saveMany)
│   └── catalog-visibility-projection.port.ts (nuevo)
├── events/
│   ├── producto-agregado.event.ts
│   ├── precio-actualizado.event.ts
│   ├── catalogo-carga-masiva-completada.event.ts
│   └── precios-categoria-ajustados.event.ts  (D6)
├── adapters/
│   ├── http/  catalogo.controller.ts · catalogo.mapper.ts · catalogo-exception.filter.ts
│   │          carga-masiva.parser.ts · dto/*.dto.ts
│   ├── persistence/  kysely-catalog.repository.ts · kysely-catalog-query.adapter.ts
│   │                 kysely-catalog-visibility.projection.ts
│   └── events/  company-visibility.listener.ts · identidad-event.payloads.ts
└── catalogo.module.ts
```

> `OcultarCatalogoEmpresaUseCase` / `RestaurarCatalogoEmpresaUseCase` **no** son casos de uso de producto y **no** forman parte de `CatalogoInboundPort`: son mantenimiento de proyección interna, sin ruta HTTP. Existen como ports-in en vez de que el listener llame a `ports-out` directo porque `adapters/events/` es un adaptador **conductor** (igual que `adapters/http/`), y este cambio es el que sienta el precedente para los 4 dominios restantes. Beneficio concreto bajo D14: la regla ("oculto significa una fila con `oculto = true`") se testea unitariamente con el puerto mockeado, y el listener se testea aparte solo por su traducción evento → escalar.

### Puertos extendidos

```ts
// ports-out/catalog-repository.port.ts
export interface CatalogRepository {
  save(item: ProviderCatalogItem, tx?: TransactionContext): Promise<void>;
  saveMany(items: ProviderCatalogItem[], tx?: TransactionContext): Promise<void>;   // D4 — nace con forma de lote
  findById(itemId: string, tx?: TransactionContext): Promise<ProviderCatalogItem | null>;   // D7
  findByCompany(companyId: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>;
  findByCompanyAndCategoria(companyId: string, categoria: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>;
  findMatching(categoria: string, nombre: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>;
}

// ports-out/catalog-visibility-projection.port.ts   (nuevo)
export interface CatalogVisibilityProjection {
  ocultarEmpresa(companyId: string, motivo: string | null, tx?: TransactionContext): Promise<void>;
  mostrarEmpresa(companyId: string, tx?: TransactionContext): Promise<void>;
}
export const CATALOG_VISIBILITY_PROJECTION = Symbol('CATALOG_VISIBILITY_PROJECTION');
```

`findByCompanyAndCategoria` es nuevo: `ajustarPreciosPorCategoria` con enfoque A (D4) necesita traer **solo** la categoría afectada; usar `findByCompany` y filtrar en memoria traería todo el catálogo del proveedor para tocar una fracción. Todos los métodos llevan `tx?` — convención repo-wide de D-A de la fundación —, en contraste deliberado con `CatalogQueryPort` (C1).

---

## Superficie HTTP

| Método + ruta | Guard | Caso de uso | Éxito |
|---|---|---|---|
| `GET /catalogo/productos?q=&categoria=` | autenticado (sin `@Roles`) | `buscarProductos` | 200 `CatalogProduct[]` |
| `POST /catalogo/mi-catalogo` | `@Roles('provider')` | `cargarProductoCatalogo` | 201 `ProviderCatalogItemResponseDto` |
| `POST /catalogo/mi-catalogo/carga-masiva` | `@Roles('provider')` | `cargarCatalogoMasivo` | 200 `ResultadoCargaMasiva` |
| `PUT /catalogo/mi-catalogo/:itemId/precio` | `@Roles('provider')` | `actualizarPrecio` | 204 |
| `POST /catalogo/mi-catalogo/ajustes-de-precio` | `@Roles('provider')` | `ajustarPreciosPorCategoria` | 204 |
| `POST /identidad/empresas/:id/reactivacion` | `@AdminRoles('super_admin','soporte')` | `reactivarEmpresa` (D16) | 204 |

**`mi-catalogo` codifica D8 en el espacio de URLs.** No existe —y no debe existir— una ruta `/catalogo/empresas/:companyId/...`: un path param de empresa es una invitación permanente a que alguien lo pase al caso de uso en vez de `actor.companyId`. Con `mi-catalogo` la única fuente posible de `companyId` es el actor.

- **`GET /catalogo/productos` no es `@Public()`**: los grants de la tabla son `authenticated`-only (Q6 de `db-schema-catalogo`), así que una ruta pública mentiría sobre lo que la base permite.
- **`ajustes-de-precio` es `POST` y devuelve 204**, no el `totalActualizados`: la firma de SPEC es `Promise<void>` y la proposal declaró exactamente 2 deltas para `catalogo`; agregar un tercero acá sería un cambio de producto de contrabando. Queda como pregunta abierta.
- **`PUT` para precio, `POST` para el ajuste**: fijar el precio de un ítem es idempotente (mismo body ⇒ mismo estado); aplicar +10% no lo es (dos veces ⇒ +21%). El verbo lo dice antes que la documentación.
- Errores: `CatalogoExceptionFilter` con `@UseFilters` a nivel de controlador, espejo exacto de `IdentidadExceptionFilter` (mapa keyeado por constructor, envelope `{ statusCode, code, message }`, `@Catch()` acotado para no competir con el filtro global).

| Error de dominio | HTTP | `code` |
|---|---|---|
| `CatalogItemNotFoundError` | 404 | `CATALOG_ITEM_NOT_FOUND` |
| `EmpresaNoActivaError` | 403 | `EMPRESA_NO_ACTIVA` |
| `PrecioInvalidoError` | 400 | `PRECIO_INVALIDO` |
| `PorcentajeInvalidoError` | 400 | `PORCENTAJE_INVALIDO` |
| `ArchivoCargaInvalidoError` | 400 | `ARCHIVO_CARGA_INVALIDO` |
| `CatalogQueryUnavailableError` (D-B) | 503 | `CATALOG_UNAVAILABLE` |

---

## Mapa de transacciones

| Operación | ¿`runInTransaction`? | Sentencias | Razón |
|---|---|---|---|
| `buscarProductos` | No | 1 select | Lectura |
| `CatalogQueryPort.buscarCoincidencias` | **No, y no puede** | 1 select | C1/C2: no acepta `tx?` y no debe correr dentro de una |
| `cargarProductoCatalogo` | No | 1 upsert | Una sentencia. Sin auditoría (D10) |
| **`cargarCatalogoMasivo`** | **No — estructuralmente imposible** | N upserts autocommiteados | D2. **El caso de uso no inyecta `TRANSACTION_MANAGER`**: la garantía no depende de que alguien recuerde no usarlo |
| `actualizarPrecio` | No | 1 select + 1 upsert | Sin invariante cross-sentencia; el upsert no puede crear una fila fantasma porque no hay `DELETE` en el esquema |
| **`ajustarPreciosPorCategoria`** | **Sí** | 1 select + `saveMany` | Ver abajo |
| `ocultar`/`restaurarCatalogoEmpresa` | No | 1 upsert / 1 update | Una sentencia |
| **`identidad.reactivarEmpresa`** | **Sí** | `UPDATE companies` + `INSERT audit_log` | Regla D-C de la fundación: toda mutación auditada escribe su entrada en la misma transacción |

**Por qué `ajustarPreciosPorCategoria` sí y `cargarCatalogoMasivo` no** — la asimetría no es arbitraria, la dicta el tipo de retorno. `cargarCatalogoMasivo` devuelve `ResultadoCargaMasiva`: el éxito parcial es un resultado de primera clase, reportable fila por fila, así que la atomicidad sería un costo sin beneficio (y una fila mala abortaría 299 buenas). `ajustarPreciosPorCategoria` devuelve `Promise<void>`: **no tiene forma de reportar una aplicación parcial**, así que una categoría a medio ajustar es un desastre de precios que el proveedor no puede ni detectar ni corregir. Sin canal para reportar parcialidad ⇒ la parcialidad no es aceptable ⇒ transacción. El volumen está acotado a una categoría de un proveedor, y como el puerto ya nace con forma de lote (D4), migrar el loop del adaptador a `UPDATE ... FROM (VALUES ...)` después no toca ni el caso de uso ni sus tests.

---

## Migraciones (forma exacta del DDL)

Dos migraciones nuevas, fix-forward, ventana de timestamps propia (la tanda 01a–08 usó `20260803120000`–`20260803120800`; las de grants, `20260804090000`/`20260804090500`). Ninguna edita una migración aplicada.

**`supabase/migrations/20260805120000_11_catalogo_provider_catalog_upsert_index.sql`** (cierra D15/Q5b)

```sql
-- Sección 4 (Indexes) del layout estándar. Cero tablas, cero RLS: solo índices.
create unique index provider_catalog_company_catalog_product_uidx
  on public.provider_catalog (company_id, catalog_product_id)
  where catalog_product_id is not null;

create unique index provider_catalog_company_nombre_categoria_uidx
  on public.provider_catalog (company_id, lower(btrim(nombre)), lower(btrim(categoria)))
  where catalog_product_id is null;

comment on index public.provider_catalog_company_nombre_categoria_uidx is
  'Predicado complementario EXACTO del índice ..._catalog_product_uidx: toda fila cae en uno y solo uno, de modo que ON CONFLICT siempre tiene un único target válido y ninguna violación 23505 puede escaparse del upsert.';
```

**`supabase/migrations/20260805120100_12_catalogo_hidden_companies.sql`** (cierra D9/Q1)

```sql
-- 2. Tabla
create table public.catalog_hidden_companies (
  company_id  uuid primary key,
  oculto      boolean     not null default true,
  motivo      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.catalog_hidden_companies is
  'Proyección desnormalizada propiedad de catalogo (deny-list). La mantiene un listener @OnEvent sobre EmpresaSuspendida/EmpresaReactivada/EmpresaAprobada. Sin FK a companies A PROPÓSITO: la fuente de verdad es el payload de un evento de otro bounded context, y esta tabla debe sobrevivir la extracción de catalogo a su propia base. Fila ausente = empresa visible (sin backfill).';

-- 5. Trigger updated_at (función pública del lote 00)
create trigger catalog_hidden_companies_set_updated_at
  before update on public.catalog_hidden_companies
  for each row execute function public.set_updated_at();

-- 6. Grants (revoke-all -> grant estrecho)
alter table public.catalog_hidden_companies enable row level security;
revoke all on public.catalog_hidden_companies from anon, authenticated;
grant select, insert, update on public.catalog_hidden_companies to service_role;
-- Sin DELETE (convención uniforme del esquema): "restaurar" es UPDATE oculto = false.
-- Sin grant a authenticated y sin políticas RLS: ningún cliente lee esta tabla jamás.

-- 7. RLS: ninguna política, a propósito (ver arriba).
```

Row types de Kysely (`shared/database/schema.ts`, D13 + esta extensión): `CatalogProductsTable`, `ProviderCatalogTable` (con **`precio_base: string`** y **`precio_maximo: string`** — ver D-C), `CatalogHiddenCompaniesTable`, y las tres agregadas a `DB`.

---

## Secuencia de implementación (9 PRs encadenados)

Cada PR deja `main` verde y coherente. Bajo D14, **cada uno arranca por sus tests**.

| PR | Slice | Contenido | Por qué acá |
|---|---|---|---|
| **1** | 0a · DB | Migraciones 11 y 12; los 3 row types + `DB`; `connectionTimeoutMillis` + `statement_timeout` en el pool (D-B) | Los índices únicos son gratis con la tabla vacía y caros con datos. `schema.ts` bloquea todo adaptador (R8/D13) |
| **2** | 0b · costuras | `@repon/types`: `ArchivoCarga`, `FilaCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` (D12). `contracts/catalog-query.port.ts` (movido + contrato de falla D-B); borra `ports-out/catalog-query.port.ts`. `CatalogRepository` extendido; `CatalogVisibilityProjection` nuevo | Cero comportamiento, solo costuras. La regla de borde de ESLint valida el movimiento con **cero** consumidores (R2) |
| **3** | 1 · lectura | `domain/` (entidad + invariante D5 + errores); `KyselyCatalogRepository` (`findById`/`findByCompany`/`findByCompanyAndCategoria`/`findMatching` **con el anti-join de visibilidad**); `KyselyCatalogQueryAdapter` (filtro + wrap de errores); `buscarProductos`; `GET /catalogo/productos` | **El filtro pertenece a la query, no al listener.** Meterlo acá evita reescribir los tests del PR 3 durante el PR 8. Con la proyección vacía el filtro es un no-op: cero cambio de comportamiento observable |
| **4** | 2 · escrituras unitarias | `cargarProductoCatalogo`; `actualizarPrecio` (404 cross-tenant, **test negativo primero**); controller, DTOs, mapper, `CatalogoExceptionFilter`; `ProductoAgregado`/`PrecioActualizado` | R1 se cierra acá. Es el PR que más merece review dedicada |
| **5** | 3a · carga masiva | `csv-parse` + `FileInterceptor` + DTO de envoltorio; `CargarCatalogoMasivoUseCase` fila-a-fila; `ResultadoCargaMasiva`; `CatalogoCargaMasivaCompletada` | Depende del índice del PR 1 para que el upsert tenga target |
| **6** | 3b · ajuste por categoría | `saveMany`; `AjustarPreciosPorCategoriaUseCase` (matemática D5, rechazo de `porcentaje <= -100`, transacción); `PreciosCategoriaAjustados` (D6) | Separado de la carga masiva: distinta semántica transaccional, distinta matemática, distinto test |
| **7** | 4a · identidad | `ReactivarEmpresaUseCase` + `CompanyNotSuspendedError` + `EmpresaReactivada` + `ReactivacionDto` + ruta + wiring (D-D) | **Antes** del PR 8: el listener necesita que el evento exista. Corre la suite completa de `identidad` (111 unit + 17 e2e) — R9 |
| **8** | 4b · visibilidad | `adapters/events/` (listener + payloads locales); los 2 casos de uso de proyección; `KyselyCatalogVisibilityProjection`; **test de contrato en `test/`** publicando los eventos reales | Cierra WARNING-2 en la práctica. El filtro ya existe desde el PR 3: acá solo aparece el escritor |
| **9** | 5 · cierre | Deltas declarados de `catalogo/SPEC.md`, `identidad/SPEC.md`, `packages/types/SPEC.md`; auditoría final de `exports` del módulo; docs | Los SPEC.md se actualizan cuando el comportamiento ya existe, no antes |

**Cambio de orden respecto del sketch de la proposal**, con motivo: el slice 4 de la proposal juntaba listener y `reactivarEmpresa`; acá se parten (PR 7 → PR 8) por dependencia real. Y las dos migraciones suben al PR 1 en vez de "antes del slice 3/4": una migración descubierta a mitad de slice es una interrupción, y el filtro de lectura del PR 3 necesita que la tabla exista.

**Dependencias nuevas** (única adición externa del cambio): `csv-parse` (MIT, orientado a servidor, API síncrona `csv-parse/sync`) y `@types/multer` (el `multer` runtime ya llega con `@nestjs/platform-express`). **XLSX queda fuera de scope**: toda librería de XLSX es un orden de magnitud más pesada, y D11 ya aisló el parser en `adapters/http/` justamente para que sumar un formato después sea un cambio confinado. Rechazado también recibir `application/json` con las filas ya parseadas: trasladaría el contrato de parseo a N clientes, y un cliente móvil parseando CSV es peor que el servidor haciéndolo una vez.

---

## Deltas de SPEC.md que `sdd-spec` debe absorber

Los 4 primeros ya estaban declarados en la proposal; los 4 últimos los agrega este documento y **no** pueden aterrizar en silencio (regla `rules.specs` de `openspec/config.yaml`).

| Archivo | Delta | Origen |
|---|---|---|
| `catalogo/SPEC.md` | `actualizarPrecio(companyId, itemId, precioBase, precioMaximo)` | D7 (proposal) |
| `catalogo/SPEC.md` | Nuevo evento `PreciosCategoriaAjustados` | D6 (proposal) |
| `identidad/SPEC.md` | Nuevo caso de uso `reactivarEmpresa` + evento `EmpresaReactivada` | D16 (proposal) |
| `packages/types/SPEC.md` | `ArchivoCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` (+ `FilaCarga`) | D12 (proposal) |
| `catalogo/SPEC.md` | **Los 4 casos de uso mutantes reciben también `companyStatus`** (escalar derivado del actor). Una regla, cuatro aplicaciones | **D-E** |
| `catalogo/SPEC.md` | **El filtro de visibilidad aplica a `buscarCoincidencias` y `findMatching`, NO a `buscarProductos` ni a `findByCompany`.** El criterio de éxito de la proposal es más ancho de lo que el tipo de retorno de `buscarProductos` (`CatalogProduct[]`, sin dimensión de empresa) permite | **D-A** |
| `catalogo/SPEC.md` | **`CatalogRepository` suma `findById`, `saveMany` y `findByCompanyAndCategoria`**; `CatalogQueryPort` se declara en `contracts/` con `CatalogQueryUnavailableError`, tope de resultados y **sin `tx?`** | D1/D4/D7 + **D-B** |
| `identidad/SPEC.md` | **`reactivarEmpresa` exige `status === 'suspendido'`** (409 en otro caso). Asimetría explícita frente a `suspenderEmpresa`, que no tiene precondición | **D-D** |

---

## Estrategia de testing (D14: todo esto se escribe primero)

| Capa | Qué se prueba | Cómo | ¿CI? |
|---|---|---|---|
| Unit | Entidad: invariante `precioMaximo >= precioBase`, redondeo a 2 decimales, `porcentaje <= -100` rechazado, escalado proporcional de D5 | Jest puro, sin contenedor Nest | Sí |
| Unit | **Negativos de autorización**: proveedor de A → ítem de B → `CatalogItemNotFoundError`; ítem inexistente → el mismo error; `companyStatus !== 'activo'` → `EmpresaNoActivaError` en los 4 mutantes | Ports-out mockeados | Sí |
| Unit | `cargarCatalogoMasivo`: N filas con M inválidas → `totalCargados = N-M`, `fallos` con los `numero` correctos, **exactamente un** `publish`, y `TRANSACTION_MANAGER` ausente del constructor | Ports-out + `EventPublisher` mockeados | Sí |
| Unit | `ajustarPreciosPorCategoria`: **exactamente un** `PreciosCategoriaAjustados`, y `runInTransaction` **sí** invocado con el `tx` propagado a `saveMany` | Mocks | Sí |
| Unit | Listener: mapea evento → escalar; **captura y no relanza** cuando la proyección falla; los 3 canales enrutan al handler correcto | Ports-in mockeados | Sí |
| Unit | `reactivarEmpresa`: happy path audita dentro de la transacción; `status !== 'suspendido'` → `CompanyNotSuspendedError`; empresa inexistente → `CompanyNotFoundError` | Espejo de `suspender-empresa.use-case.spec.ts` | Sí |
| Integración (opt-in) | El índice único parcial rechaza el duplicado y el `ON CONFLICT` hace UPDATE en las **dos** ramas; `numeric` vuelve como `string` | `supabase start` local | No (requiere DB) |
| E2E | Rutas protegidas: 401 sin token, 403 con rol equivocado, 404 cross-tenant, 400 de DTO; `/health` sigue 200 | `supertest` + `ACTOR_PORT`/`JWT_VERIFIER` sobreescritos | Sí |
| **Contrato** | Publicar instancias **reales** de `EmpresaSuspendida`/`EmpresaReactivada`/`EmpresaAprobada` por el `EVENT_PUBLISHER` real y afirmar el cambio de proyección | `test/` (fuera de `domains/`) | Sí |
| Regresión | Suite completa de `identidad` — 111 unit + 17 e2e — verde (R9) | Sin cambios | Sí |

---

## Riesgos residuales y preguntas abiertas

- [ ] **Lectura directa a Supabase saltea la proyección.** La política RLS `provider_catalog_authenticated_select_public` (`disponible = true`) **no** conoce `catalog_hidden_companies`, así que un cliente que consulte Postgres directo seguiría viendo el catálogo de una empresa oculta. Aceptado: `openspec/config.yaml` fija que los clientes van por core-api para lógica de negocio, y `provider_catalog` disponible ya es vista pública de marketplace (no hay fuga de datos). **Follow-up nombrado**: agregar el mismo predicado `NOT EXISTS` a esa política.
- [ ] **El proveedor no tiene endpoint para listar su propio catálogo**, así que el `itemId` de `actualizarPrecio` solo es obtenible desde la respuesta de la carga masiva o de una lectura directa a Supabase (la política de owner existe). No se inventa una ruta: ningún SPEC.md declara ese caso de uso. Decisión de producto.
- [ ] **`ajustarPreciosPorCategoria` devuelve 204 sin `totalActualizados`.** Útil para el proveedor, pero sería un tercer delta de spec no autorizado por la proposal. El dato **sí** viaja en `PreciosCategoriaAjustados` (D6).
- [ ] **Colisión `(company_id, nombre, categoria)` entre uploads distintos** (D-C): el segundo producto actualiza al primero y se reporta como cargado. Mitigación disponible sin tocar el esquema: rechazar duplicados **dentro del mismo archivo** en el parser (`sdd-spec`).
- [ ] **Valores de timeout** (`connectionTimeoutMillis: 2000`, `statement_timeout: 5000`): defaults declarados, no medidos. Lo no negociable es que sean finitos (D-B).
- [ ] **`aprobarEmpresa` sigue sin precondición de estado** y puede sacar a una empresa de `suspendido`. Cubierto reactivamente (el listener consume `EmpresaAprobada`, D-A), pero la causa raíz es un follow-up: tocarlo violaría la mitigación aditiva de R9.
- [ ] **Reconciliación de la proyección ante evento perdido** — fuera de scope por la proposal (R4). El `logger.error` del listener es el insumo diseñado para ese follow-up.
- [ ] **Límites del upload** (2 MB / 500 filas en el diagrama) son placeholders: **Q4 es de `sdd-spec`**, que fija los valores duros en el DTO.
