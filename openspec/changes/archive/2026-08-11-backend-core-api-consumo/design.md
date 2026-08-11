# Design: `consumo` — tercer vertical, primer job programado y primer binding real del kernel de notificaciones

Cierra las **7 preguntas** que `proposal.md` difirió a esta fase (**Q1–Q7**) y fija el cableado que `refill-matching`, `ofertas` y `pedidos-pagos` van a copiar: cómo se declara un adaptador conductor programado, cómo se hace idempotente un job diario sin lock distribuido, y cómo nace un puerto de infraestructura compartida cuyo backend todavía no existe.

No re-abre D1–D16. No define escenarios Given/When/Then (eso es `sdd-spec`, corriendo en paralelo sobre la misma proposal). Diagramas en ASCII: convención existente del repo (`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, los `design.md` de la fundación y de `catalogo`); no hay mermaid en ninguna parte.

## Qué cierra este documento

| Sección | Cierra | Respuesta en una línea |
|---|---|---|
| **D-A** | **Q1** — forma del estado de debounce | **Una** columna: `user_consumption.stock_bajo_notificado_at timestamptz null`. NULL = sin alerta abierta. La escribe un **compare-and-set**, nunca `save()`. La limpian el propio cron (stock repuesto) y `configurarConsumo`. **Se rechaza** cualquier dependencia de un evento futuro de `refill-matching` |
| **D-B** | **Q2** — dónde vive el umbral | **Constante de dominio** `UMBRAL_STOCK_BAJO_DIAS = 7` en `domain/consumo.constants.ts`. No env, no columna. La ruta a "umbral por usuario" y a "umbral por `kind`" queda abierta y es **puramente aditiva** (la segunda ni siquiera necesita migración). Se marca lo que es genuinamente decisión de producto |
| **D-C** | **Q3** — predicado de `findDueForCheck()` | Filtro en SQL, forma **multiplicativa** (sin división), **unión** de "puede disparar" ∪ "puede limpiarse". `findDueForCheck(umbralDias)` gana un parámetro. El filtro es un **superconjunto estricto** de la decisión del dominio, nunca la decisión misma. Sin índice nuevo |
| **D-D** | **Q4** — payload de los eventos | Regla: **`consumo` publica hechos que posee, en su propio vocabulario, más una clave de correlación. Nunca publica el enum ni la interpretación de otro dominio.** Se publica `consumoDiario` (la salida de la fórmula), no sus 3 insumos. `StockBajoDetectado` y `RefillAutoSolicitado` comparten el mismo juego de campos, a propósito |
| **D-E** | **Q5** — cron con N instancias | **Sin advisory lock, y no hace falta para la corrección**: el CAS de D-A hace el cron idempotente por construcción. N réplicas cuestan N scans redundantes, jamás eventos duplicados. Se agrega un kill-switch (`CONSUMO_CRON_ENABLED`), que es también la palanca de "N−1 réplicas con el job apagado" |
| **D-F** | **Q6** — horario, zona y solapamiento | `0 9 * * *`, `timeZone: 'America/Santiago'`. **09:00 porque corre después de la ventana de la dosis matinal** y porque **no cae en la ventana de DST de Chile**. Sin guarda de re-entrada: el CAS ya la hace innecesaria; el solapamiento es aritméticamente inalcanzable a la escala de lanzamiento |
| **D-G** | **Q7** — cliente Expo y `profileId → token` | **Ninguna dependencia nueva de Expo.** Hoy el camino de envío es inalcanzable, así que se difiere el cliente y se entrega **la costura**: `PushTokenResolver` + `NullPushTokenResolver`. Se recomienda `expo-server-sdk` para el cambio futuro, con el razonamiento escrito ahora. **`@nestjs/schedule` queda como la única dependencia nueva del cambio** |
| **D-H** | Vacíos que ninguna Q nombró | `registrarMascota` **no tiene puerto de persistencia** → nace `PetRepository`. `marcarDosisTomada` necesita un decremento **atómico** → nace `descontarStock`. `configurarConsumo` acepta un `petId` del cliente → necesita el mismo chequeo de propiedad de D7 |
| §Diagramas | Los 3 flujos complejos | Cron de punta a punta, `marcarDosisTomada` transaccional, rechazo cross-tenant |
| §Wiring · §HTTP · §Transacciones · §Migración · §Secuencia | Detalle que `sdd-tasks` necesita | Providers, rutas, quién abre transacción, DDL exacto, 7 PRs encadenados |

---

## D-A · Estado de debounce (Q1)

**Choice**: **una sola columna nullable** en `user_consumption`.

```sql
stock_bajo_notificado_at timestamptz   -- NULL = no hay alerta abierta
```

### Por qué una columna y no dos

La proposal ofrecía tres opciones: un `timestamptz`, un booleano `refill_auto_abierto`, o ambos.

**Dos columnas se rechazan primero, porque son las que más caro salen.** Dos banderas producen 4 estados, de los cuales 2 son contradictorios (`refill_auto_abierto = true` con `ultima_notificacion = NULL`, y su inverso) y **ninguna transición del sistema puede alcanzarlos**. Estado inalcanzable-pero-representable es exactamente el estado que existe para convertirse en bug: el día que alguien escriba una de las dos columnas y olvide la otra, no hay tipo, CHECK ni test que lo frene.

Y no hay nada que separar. Los dos eventos se evalúan **en la misma iteración del loop, sobre la misma condición**: `StockBajoDetectado` siempre, `RefillAutoSolicitado` además si `autoCrearRefill`. No existe ningún camino en el que uno se dispare y el otro no por una razón distinta de ese booleano, que ya vive en la fila. Un segundo marcador no distinguiría nada.

**El `timestamptz` le gana al booleano** sin costar una columna extra:

| | `boolean refill_auto_abierto` | **`timestamptz stock_bajo_notificado_at`** |
|---|---|---|
| ¿Hay alerta abierta? | Sí | Sí (`IS NOT NULL`) |
| ¿Desde cuándo? | No | Sí |
| Diagnóstico bajo R7 (la push no se entrega) | Ninguno | **Es la única traza persistida de que el cron efectivamente decidió alertar ese ítem** |
| Política futura "re-alertar a los N días" | Necesita migración | **Cambio puro de aplicación, cero migración** |
| Test de debounce | Afirma `true` | Afirma un instante concreto, comparable entre corridas |

La cuarta fila es la que decide, y se conecta con D-E: el modo de falla que D-E elige a propósito (alerta perdida antes que alerta duplicada) deja un hueco — un ítem que se marcó y nunca alertó no vuelve a alertar hasta que el stock suba. **La columna `timestamptz` es la que hace que tapar ese hueco después sea gratis.** Las dos decisiones se sostienen mutuamente.

### La escritura es un compare-and-set, no un `save()`

Regla dura, y es la pieza técnica central de este documento:

```sql
-- "reclamar" la alerta: gana exactamente un escritor
update public.user_consumption
   set stock_bajo_notificado_at = $2
 where id = $1
   and stock_bajo_notificado_at is null
returning id;          -- 0 filas => otro proceso ya la reclamó => NO emitir
```

Tres propiedades caen de acá, sin infraestructura adicional:

1. **Idempotencia entre días** (R2/D5): la segunda corrida encuentra la columna no nula, la cláusula `WHERE` no matchea, `intentarMarcarStockBajo` devuelve `false`, y el caso de uso no emite. Es el mismo mecanismo que resuelve el requisito de D5 y el de D-E, no dos mecanismos.
2. **Idempotencia entre procesos concurrentes** (R10/Q5): el row-lock que Postgres ya toma en el `UPDATE` serializa a los competidores. Dos réplicas, o dos corridas solapadas, no pueden ambas ganar la misma fila. **Sin esto, D5 sería una lectura seguida de una escritura no atómica — y un advisory lock sería obligatorio.** Ver D-E.
3. **El cron nunca llama `save()`.** `save(item)` es last-write-wins y escribiría la fila **entera** desde un snapshot leído al principio del loop: un `marcarDosisTomada` concurrente que decrementó el stock quedaría pisado. El cron toca `user_consumption` solo por los dos métodos angostos de abajo, y esa restricción es verificable leyendo el caso de uso.

Métodos nuevos en `ConsumptionRepository` (delta declarado):

```ts
/** true = este llamador ganó el claim y DEBE emitir. false = ya estaba reclamada. */
intentarMarcarStockBajo(consumptionId: string, notificadoAt: Date, tx?: TransactionContext): Promise<boolean>;

/** Idempotente: 0 filas afectadas cuando ya estaba limpia, y eso es éxito. */
limpiarMarcaStockBajo(consumptionId: string, tx?: TransactionContext): Promise<void>;
```

### Qué limpia el marcador

| Origen | ¿Limpia? | Razón |
|---|---|---|
| **El propio cron**, al ver `diasRestantes >= UMBRAL` con el marcador abierto | **Sí — es el limpiador principal y obligatorio** | Auto-sanante, cero dependencias hacia afuera, y cierra el ciclo dentro del único componente que posee la columna. Es lo que obliga a que el predicado de D-C incluya también las filas **por encima** del umbral con marcador abierto |
| **`configurarConsumo`** | **Sí** | Reescribe la configuración completa, incluido `stockActual`. Un ítem reconfigurado es un contexto de alerta nuevo. Además tapa el único caso que el marcador único de arriba no cubre: el usuario **enciende `autoCrearRefill`** mientras la alerta ya está abierta — sin este clear, ese refill automático no se crearía nunca. El costo es una push extra en la próxima corrida, y es explicable ("lo cambiaste, lo reevaluamos") |
| **`marcarDosisTomada`** | **No** | Solo puede **bajar** el stock: jamás puede resolver la condición. No tocarlo mantiene la transacción de D6 en exactamente dos escrituras |
| **Un evento de vuelta desde `refill-matching`** | **No — rechazado explícitamente** | Es una dependencia hacia adelante sobre un dominio que **no existe**; invertiría la propiedad que D5 estableció (`consumo` posee la columna pero no la condición de limpieza); y obligaría a `consumo` a crear `adapters/events/`, contradiciendo D14 de frente. **El nivel de stock es la única fuente de verdad de la condición de alerta y ningún otro dominio tiene voto.** Si mañana un refill cumplido debe reponer el stock, lo hace escribiendo `stockActual` — que el cron ya observa |

---

## D-B · Dónde vive el umbral (Q2)

**Choice**: **constante de dominio**, un solo valor para todos los usuarios.

```ts
// domains/consumo/domain/consumo.constants.ts
/**
 * Umbral de "stock bajo", en días restantes. Valor de producto declarado,
 * no medido: debe ser >= el lead time realista de un refill (solicitud ->
 * ofertas -> aceptación -> despacho), porque la alerta solo sirve si queda
 * stock para cubrir la espera. `RefillRequest.urgencia` declara
 * `en_2_3_dias` como su tramo más lento; 7 días da ~2x de margen sobre ese
 * tramo. Subirlo o bajarlo es un cambio de una línea, cubierto por tests.
 */
export const UMBRAL_STOCK_BAJO_DIAS = 7;
```

### Por qué no una columna por consumo

Es la opción que la prosa de `consumo/SPEC.md` sugiere ("el umbral **configurado**"), y es la más cara de las tres por un margen amplio: columna + migración + campo en `@repon/types` (**un segundo delta de `shared-types-package`** más allá de D15) + campo en el DTO de `configurarConsumo` + validación de rango + un default de producto que nadie eligió + una pantalla que lo exponga. Todo eso para una decisión de producto que **no está tomada en ningún documento del repo**.

Y la asimetría de reversibilidad es total:

- **Constante → columna** es puramente aditivo y retrocompatible: columna nullable, y el caso de uso lee `consumption.umbralDias ?? UMBRAL_STOCK_BAJO_DIAS`. Las filas viejas siguen funcionando sin backfill.
- **Columna → constante** es pérdida de datos y regresión de producto: hay que borrar un valor que los usuarios ya eligieron.

### Por qué no una variable de entorno

Dos motivos independientes, y cualquiera de los dos alcanza:

1. **Es una regla de producto, no un parámetro operativo.** Cambiarla cambia lo que los usuarios experimentan, así que pertenece a código revisado y testeado, no a una variable de deploy que alguien puede tipear mal a las 2 AM.
2. **Rompe el precedente del repo.** `env.schema.ts` contiene hoy exclusivamente infraestructura: URLs, claves, puerto, modo de JWT. **Cero valores de negocio.** El precedente para un valor de negocio ajustable ya existe y es una constante exportada: `MAX_COINCIDENCIAS_POR_ITEM` en `catalogo/contracts/`.

### Lo que sí es decisión de producto — declarado, no resuelto acá

Dos dimensiones, y la segunda es más probable que la primera:

- **¿Cada usuario elige su propio umbral?** Genuinamente producto. Ruta aditiva descrita arriba.
- **¿El umbral debería depender de `kind`?** Quedarse sin un `medicamento` es un evento de salud; quedarse sin `alimento` es un mandado. Probablemente el primer refinamiento real — y **no necesita ninguna migración ni cambio de tipos**: reemplazar el escalar por un `Record<ConsumptionKind, number>` es un cambio confinado a `domain/consumo.constants.ts` y al caso de uso que lo lee.

El umbral **viaja en el payload del evento** (D-D) precisamente porque va a cambiar: un consumidor que registre eventos históricos necesita saber contra qué umbral se disparó cada uno.

---

## D-C · Predicado de `findDueForCheck()` (Q3)

**Choice**: filtro **en SQL**, con la forma multiplicativa de abajo, y `findDueForCheck` gana un parámetro (delta declarado).

```ts
findDueForCheck(umbralDias: number, tx?: TransactionContext): Promise<UserConsumption[]>;
```

```sql
select *
  from public.user_consumption
 where stock_bajo_notificado_at is not null                             -- (B) puede necesitar limpieza
    or stock_actual * frecuencia_dias                                    -- (A) puede necesitar disparo
         < ($1::numeric + 1) * dosis_por_toma * coalesce(array_length(horarios, 1), 0);
```

### Tres propiedades, cada una con su razón

**1. Es una unión, no un filtro de "bajo umbral".** Bajo D-A el cron tiene **dos** trabajos: disparar al cruzar hacia abajo y **limpiar el marcador al cruzar hacia arriba**. Si el SQL excluyera las filas ya debounceadas — la opción que la proposal pone sobre la mesa — el marcador **no se limpiaría nunca** y el debounce se volvería permanente en vez de temporal. La rama `(B)` es lo que hace que D-A sea reversible.

Y el filtro es **exacto, no aproximado**: toda fila excluida está simultáneamente por encima del umbral y sin alerta abierta, o sea que la iteración del loop sobre ella sería demostrablemente un no-op. No se pierde ningún trabajo.

**2. Es multiplicativa para no dividir nunca.** La forma natural es `stock_actual / (dosis_por_toma * n_horarios / frecuencia_dias) < umbral`. Se rechaza: `horarios` es `text[] not null` sin CHECK de no-vacío, así que `array_length` puede devolver NULL, y `dosis_por_toma numeric` no tiene CHECK de positividad. Una división por cero **aborta la query entera** — es decir, **una fila corrupta apagaría el chequeo diario de todos los usuarios**. Exactamente la clase de falla que D4 existe para impedir, colándose por debajo del loop donde el `try/catch` por ítem no la puede atrapar.

Con la forma multiplicativa la fila degenerada (`n_horarios = 0` o `dosis_por_toma = 0`) da RHS `= 0`, la comparación `stock * freq < 0` es falsa (`stock >= 0`, `freq >= 1`) y la fila **se excluye sola**, sin cláusula extra y sin poder tumbar nada. Ver §Riesgos residuales por la contrapartida.

**3. El SQL es un superconjunto, jamás la decisión.** La fórmula autoritativa vive en `domain/` y la corre el caso de uso sobre la entidad devuelta. El `+ 1` del predicado no es un margen arbitrario:

- La equivalencia exacta se cumple: para `n` entero, `floor(x) < n ⟺ x < n`. Así que `< umbralDias` a secas *sería* correcto.
- Pero esa equivalencia depende de que la división `numeric` de Postgres y la de `float64` de JS coincidan bit a bit en el borde. Casi siempre coinciden; "casi" no es una propiedad.
- Con `+ 1` el argumento deja de ser una equivalencia frágil y pasa a ser un **superconjunto estricto**: una fila incluida de más es inofensiva (el caso de uso la reevalúa y la salta), una fila excluida de menos sería una alerta perdida en silencio. El costo es traer la banda `[umbral, umbral+1)`, acotada y pequeña.

**Regla que se deriva y hay que escribir en el doc comment del puerto**: `findDueForCheck` devuelve **candidatas**, no ítems bajo umbral. El nombre miente un poco a propósito; la alternativa (`findCandidatasParaChequeo`) se descartó para no agregar un tercer delta cosmético sobre una firma que `consumo/SPEC.md` ya nombra.

### Sin índice nuevo, y por qué

La rama `(A)` es aritmética sobre 4 columnas: ningún b-tree simple la sirve. Un índice parcial sobre `(B)` (`where stock_bajo_notificado_at is not null`) es barato, pero **no compra nada para esta query**: con el `OR`, la rama `(A)` obliga igual a un seq scan, y el planner descartaría el BitmapOr.

**Se acepta un seq scan de `user_consumption`, una vez al día.** A escala de lanzamiento (miles de filas) son milisegundos. Escotilla nombrada, gatillada por medición y no por miedo: una **columna generada `stored`** con el consumo diario más un b-tree, o pasar `findDueForCheck` a una firma con cursor/lote. Lo segundo queda confinado al puerto, al adaptador y al loop — **la semántica del marcador no cambia**, así que los tests de D-A sobreviven intactos.

### "Activo" no existe

`consumo/SPEC.md` dice "cada `UserConsumption` **activo**". **`user_consumption` no tiene columna `status` ni `activo`** (verificado contra `20260803120200_02_consumo.sql`). "Activo" en esa prosa no tiene contraparte en el esquema, así que el predicado no puede filtrar por eso y **"activo" significa hoy "la fila existe"**.

Consecuencia real, no cosmética: **no hay forma de pausar un ítem** salvo el marcador de debounce. No se inventa la columna acá — no hay decisión de producto que la respalde ni scope que la cubra. Queda como delta declarado sobre `db-schema-consumo` (documentar la ausencia) y como pregunta de producto.

---

## D-D · Payload de los eventos (Q4)

**La regla, antes que los campos** — es lo que se está fijando de verdad, porque los campos van a crecer y la regla no:

> `consumo` publica **los hechos que posee, en su propio vocabulario**, más una clave de correlación estable. **Nunca publica el enum de otro dominio ni la interpretación de otro dominio.** Y cuando un hecho es la salida de una fórmula que `consumo` posee, publica **la salida**, no los insumos.

Las dos mitades tienen consecuencias concretas y verificables:

- **No se publica `urgencia`.** Es el vocabulario de `refill-matching` (`'lo_antes_posible' | 'hoy' | 'manana' | 'en_2_3_dias'`). Se publica `diasRestantes`, que es el hecho; mapearlo a urgencia es de quien posee el enum. Si `consumo` publicara `urgencia`, un cambio de ese enum rompería un evento de `consumo` — acoplamiento al revés.
- **No se publican `dosisPorToma` + `frecuenciaDias` + `horarios`.** Se publica **`consumoDiario`**, que el cron ya calculó. Publicar los tres insumos obliga a **cada** consumidor a re-implementar la fórmula, y el día que la fórmula cambie habrá N copias desincronizadas. Publicar la salida deja la fórmula donde vive.

### Lo que `refill-matching` va a necesitar, y lo que este dominio no puede darle

Contrastando contra `RefillRequest` / `RefillItem` (`packages/types/src/refill-matching.ts`), verificado campo por campo:

| Campo destino | ¿`consumo` lo tiene? | Resolución |
|---|---|---|
| `RefillRequest.userId` | **Sí** — `user_consumption.user_id` | Viaja en el payload |
| `RefillItem.nombre` | **Sí** | Viaja |
| `RefillItem.categoria` | **No.** `user_consumption` tiene `kind` (`medicamento`/`alimento`/`vacuna`/`suplemento`), que **no es** la `categoria` libre de `catalog_products` | Viaja `kind`. `consumo` **no inventa** un mapeo `kind → categoria`: no tiene autoridad sobre el vocabulario del catálogo. Es de `refill-matching` |
| `RefillItem.precioReferencia` | **No.** Cero datos de precio en este dominio | `refill-matching` lo resuelve por `CatalogQueryPort` (`catalogo/contracts/`, ya existe) |
| `RefillItem.catalogProductId` | **No.** `user_consumption` **no tiene** columna `catalog_product_id` | **El vacío de mayor valor del cambio.** Sin él, el matching solo puede ser difuso por nombre. Es puramente aditivo (columna nullable + campo opcional), pero fuera de scope acá: no hay decisión de producto ni autoridad de la proposal. Nombrado como follow-up de alta prioridad |
| `RefillRequest.direccion` / `comuna` | **No — y no existen en ninguna tabla del repo.** `profiles` tiene `nombre/email/telefono/company_id`, sin dirección | Problema entero de `refill-matching`. Nombrado para que su propio SDD no lo descubra a mitad de camino |
| `RefillRequest.urgencia` | Derivable, pero es vocabulario ajeno | Viaja `diasRestantes` + `umbralDias`; el mapeo es de `refill-matching` |

### Los payloads

```ts
// domains/consumo/events/stock-bajo.payload.ts — forma compartida por los DOS eventos
export interface StockBajoPayload {
  /** Clave de correlación. Estable, y el único identificador con el que un
   *  consumidor puede deduplicar o apuntar de vuelta a este consumo. */
  readonly consumptionId: string;
  readonly userId: string;
  readonly ownerType: OwnerType;
  /** Presente sii `ownerType === 'pet'`. NO viaja el nombre de la mascota:
   *  requeriría un lookup por ítem dentro del loop del cron (N+1), y el
   *  mensaje de push se compone acá dentro, donde no hace falta. */
  readonly petId: string | null;
  readonly kind: ConsumptionKind;
  readonly nombre: string;
  readonly unidad: string | null;
  readonly stockActual: number;
  /** Salida de la fórmula, no sus insumos. Unidades por día. */
  readonly consumoDiario: number;
  readonly diasRestantes: number;
  /** Sin esto, `diasRestantes` es ininterpretable: el umbral va a cambiar
   *  (D-B) y un consumidor que registre histórico necesita ambos. */
  readonly umbralDias: number;
}
```

```ts
export class StockBajoDetectado implements DomainEvent {
  readonly type = 'consumo.stock_bajo_detectado';
  readonly occurredAt = new Date();
  constructor(readonly payload: StockBajoPayload) {}
}

export class RefillAutoSolicitado implements DomainEvent {
  readonly type = 'consumo.refill_auto_solicitado';
  readonly occurredAt = new Date();
  constructor(readonly payload: StockBajoPayload) {}
}

export class DosisRegistrada implements DomainEvent {
  readonly type = 'consumo.dosis_registrada';
  readonly occurredAt = new Date();
  constructor(
    readonly consumptionId: string,
    /** Presente porque, bajo D14, ningún consumidor puede consultarlo de vuelta. */
    readonly userId: string,
    readonly tomadoAt: Date,
    readonly cantidad: number,
    /** Post-decremento: el consumidor ve el efecto, no solo el hecho. */
    readonly stockRestante: number,
  ) {}
}
```

`occurredAt` de `DomainEvent` ya da el instante: **no se duplica un `detectadoAt`**.

### Por qué dos eventos con el mismo payload

Es deliberado y hay que defenderlo, porque parece redundante.

- **Se rechaza que `RefillAutoSolicitado` lleve solo `{ consumptionId, userId }`** y dependa de que el consumidor ya haya procesado `StockBajoDetectado`. Crearía una dependencia de orden entre dos eventos sobre un emisor in-process que no garantiza orden cross-evento, y obligaría a que quien solo le importa el auto-refill se suscriba igual al otro.
- **Se rechaza fusionarlos en uno con un flag `autoCrearRefill`.** Los dos eventos tienen **audiencias y significados distintos**: `StockBajoDetectado` es *"se observó un hecho"* (analítica, notificaciones, un dashboard futuro); `RefillAutoSolicitado` es *"el usuario nos pre-autorizó a actuar"* — lleva **consentimiento**. Fusionarlos convertiría "¿el usuario consintió?" en un campo del payload en vez de un canal, que es el lugar equivocado para un hecho de autorización, y obligaría a cada consumidor a re-chequear el flag.

Canales con prefijo de dominio (`consumo.*`), siguiendo el precedente más reciente (`catalogo.precios_categoria_ajustados`). `identidad` usa `empresa.suspendida` (entidad.verbo): la inconsistencia existe y se resuelve a favor del más nuevo, no se propaga la duda.

**`refill-matching` declarará su propia interfaz local del payload** en su `adapters/events/`, sin importar estas clases — mismo patrón que `catalogo/adapters/events/identidad-event.payloads.ts` fijó (D-A de `catalogo`). Es responsabilidad del futuro cambio, no de este.

---

## D-E · Cron con múltiples instancias (Q5)

**Choice**: **sin advisory lock — y no hace falta uno para que el cron sea correcto.**

### El CAS ya resolvió el problema

R10 plantea el riesgo así: *"dos instancias pueden leer el marcador antes de que ninguna lo escriba"*. Eso es cierto para un debounce implementado como **leer-luego-escribir**. El de D-A **no lo es**: es un `UPDATE ... WHERE stock_bajo_notificado_at IS NULL RETURNING id`, una única sentencia sobre la que Postgres ya toma el row-lock. Dos instancias compiten, **una gana, la otra recibe 0 filas y no emite**.

| Escenario | Sin CAS (leer-luego-escribir) | **Con el CAS de D-A** |
|---|---|---|
| 1 réplica, 2 días seguidos | Duplicado si el marcador se lee mal | 1 evento |
| N réplicas, misma ventana | **N eventos, N pushes, N `RefillRequest`** | **1 evento.** N−1 pierden el claim |
| 2 corridas solapadas | Igual que arriba | **1 evento** |
| Costo residual de N réplicas | — | N seq scans redundantes al día. Desperdicio, jamás incorrección |

**Lo que un lock costaría de verdad** — no es el cambio de 5 líneas que aparenta:

- `pg_advisory_xact_lock` (scope de transacción, la variante limpia) **es estructuralmente incompatible con D4**, que prohíbe una transacción alrededor del loop. Se libera al terminar la transacción que lo tomó, así que no puede cubrir un loop sin transacción.
- Queda `pg_try_advisory_lock` (scope de sesión): exige **retener una conexión dedicada del pool** durante toda la corrida (`max` es 10), liberarla en un `finally`, y manejar la fuga cuando el proceso muere — el lock queda tomado hasta que Postgres declara muerta la conexión.

Es decir: se pagaría complejidad operativa real por una garantía que el CAS ya da gratis.

### Lo que sí se agrega: un kill-switch

No para corrección, sino para **costo y control operativo** — y no es scope creep: el Rollback Plan de la proposal ya pide *"desactivar el job sin revertir el vertical"*.

```ts
// config/env.schema.ts — validado como todo lo demás, no un process.env suelto
CONSUMO_CRON_ENABLED: z.enum(['true', 'false']).default('true'),
```

Se consume por la opción `disabled` de `CronOptions` de `@nestjs/schedule`. **Caveat documentado en el código**: el decorador se evalúa al cargar la clase, antes de que exista el contenedor de DI, así que lee `process.env` directo. Se declara igual en `env.schema.ts` para que la variable esté validada y documentada en un solo lugar, y para que un valor fuera de `'true' | 'false'` sea un error de arranque y no un booleano silencioso (`z.coerce.boolean()` está rechazado a propósito: `Boolean('false') === true`).

Esa misma variable es **la palanca de multi-réplica**: el día que corran N instancias, N−1 arrancan con `CONSUMO_CRON_ENABLED=false`. Elección de líder por configuración: cero código, cero infraestructura, y el CAS sigue cubriendo el caso de que alguien se equivoque.

### El modo de falla que se elige a propósito

**Se reclama primero, se emite después.** El orden importa y es una decisión, no un detalle:

| Orden | Falla entre los dos pasos | Consecuencia |
|---|---|---|
| **Reclamar → emitir** ✅ | Se marcó, no se emitió | **Alerta perdida** en este episodio de stock bajo. Queda contenida dentro de `consumo` |
| Emitir → marcar | Se emitió, no se marcó | **Duplicado mañana**: otro `RefillRequest` que otro dominio persiste y un usuario ve |

Se elige perder antes que duplicar: el duplicado cruza un borde de dominio hacia estado de negocio persistido y visible; la pérdida se queda adentro. Es exactamente el riesgo (R2) que D5 existe para cerrar — resolverlo dejando abierta su versión más cara sería incoherente.

Y el hueco de la alerta perdida tiene tapa diseñada: como D-A eligió `timestamptz`, una política *"re-alertar si el marcador tiene más de N días y sigue bajo umbral"* es **una condición más en el caso de uso, sin migración**.

---

## D-F · Horario, zona horaria y solapamiento (Q6)

```ts
@Cron('0 9 * * *', {
  name: 'consumo.chequeo-stock-diario',
  timeZone: 'America/Santiago',
  disabled: process.env.CONSUMO_CRON_ENABLED === 'false',
})
```

### Zona horaria: `America/Santiago`

**Verificado: ni `docs/ARCHITECTURE.md` ni `docs/DATA_MODEL.md` nombran una zona horaria canónica.** Se deduce del mercado, que el esquema declara sin ambigüedad: `companies.rut`, `refill_requests.comuna`, `region`, Webpay Plus (Transbank), y todo el lenguaje de dominio en español. El producto es chileno.

**Los datos no cambian**: todas las columnas siguen siendo `timestamptz` (UTC en el cable). La zona es exclusivamente una preocupación del *scheduler* — vive en el adaptador de D1 y en ningún otro lado. Esa separación es la que hace que cambiar de zona no toque el caso de uso ni sus tests.

### Hora: 09:00, por dos razones independientes

1. **Funcional: corre después de la ventana de la dosis matinal.** Los `horarios` típicos empiezan alrededor de las 08:00. A las 09:00 la dosis del día ya está registrada y `stockActual` refleja el consumo de hoy — el cálculo de días restantes no se hace sobre un stock un día viejo. Con un cron a medianoche, todo el chequeo se haría contra el stock de ayer.
2. **Operacional: 09:00 no cae en la ventana de DST de Chile.** Los cambios de horario ocurren a medianoche local. Un cron a medianoche es, literalmente, la hora que se rompe: en primavera esa hora **no existe** (corrida saltada) y en otoño **ocurre dos veces** (corrida doble). A las 09:00 ninguna de las dos cosas es posible. Y aunque lo fueran, la doble ejecución sería inofensiva por el CAS de D-A: cinturón y tiradores.

`@nestjs/schedule` delega el manejo de zona a `cron`, que usa Luxon — `timeZone` es la opción soportada, no aritmética manual de offsets.

### Solapamiento: sin guarda de re-entrada

**Corrección primero**: si dos corridas se solapan, cada ítem lo reclama exactamente una: el CAS de D-A hace el solapamiento **seguro**, igual que el multi-réplica. Una guarda de re-entrada sería una optimización de costo, no un arreglo de corrección.

**Y la magnitud no la justifica.** Por ítem: 1 `UPDATE` de CAS + hasta 2 `publish` in-process + 1 `sendPush` que hoy es un no-op sin I/O (D10/D-G). Con un presupuesto generoso de 5 ms por ítem, solaparse exige **~17 millones de ítems** en una sola corrida. No es un riesgo a la escala de este cambio; es aritmética.

**Se rechaza además meterle un `if` al job.** D1 exige que la clase `@Cron()` tenga exactamente una llamada y cero lógica, y esa garantía es verificable por inspección — gastarla en una guarda innecesaria la debilita para siempre.

Lo que sí se hace, en el **caso de uso** (que ya debe loguear por ítem bajo D4): un log de resumen al cerrar la corrida con `{ candidatas, emitidos, limpiados, fallidos, duracionMs }`. **Trip-wire nombrado**: si `duracionMs` llega a la hora, la respuesta correcta es el lote de D-C, no un lock.

---

## D-G · Cliente de Expo Push y `profileId → token` (Q7)

**Choice**: **ninguna dependencia nueva de Expo.** Se difiere el cliente y se entrega la costura.

**Verificación (Q7 pide confirmarlo)**: `expo-server-sdk`, `expo-notifications` y cualquier referencia a Expo Push **siguen ausentes de todo el monorepo** — confirmado por grep sobre todos los `package.json` y sobre `services/`, `apps/`, `packages/`. `apps/usuario-mobile/` y `apps/proveedor-mobile/` siguen siendo mockups HTML.

### Por qué ninguna de las dos opciones que la pregunta ofrece

La pregunta asume que hay que elegir un cliente HTTP. Bajo D10, **hoy no se envía ni una sola push**: `sendPush` resuelve un token, no encuentra ninguno, loguea y retorna. El camino de envío es **inalcanzable**. Cualquier cliente que se agregue es **código muerto**, y agregar una dependencia para código muerto es el peor de los intercambios: se paga superficie de supply chain, churn de versiones y carga de review **ahora**, por valor que aterriza en un cambio futuro.

Al mismo tiempo, un `fetch` hecho a mano **no** es equivalente a `expo-server-sdk` el día que sí haya tokens: el SDK hace chunking (Expo topea en 100 mensajes por request), valida el formato del token (`Expo.isExpoPushToken`), hace polling de receipts y clasifica errores recuperables (`DeviceNotRegistered`). Un `fetch` que ignora todo eso es una trampa para el cambio futuro.

**Recomendación escrita ahora para que el cambio futuro no vuelva a litigarla: `expo-server-sdk`**, por las 4 capacidades de arriba, insertado en el punto exacto marcado abajo.

### La costura: `PushTokenResolver`

Lo único que separa el no-op de hoy de un envío real es la resolución del token. Se convierte en un puerto de primera clase en vez de en un método privado:

```ts
// shared/notifications/push-token-resolver.port.ts
export interface PushTokenResolver {
  /** `null` = el perfil no tiene dispositivo registrado. NO es un error. */
  resolve(profileId: string): Promise<string | null>;
}
export const PUSH_TOKEN_RESOLVER = Symbol('PUSH_TOKEN_RESOLVER');

// shared/notifications/null-push-token.resolver.ts
/**
 * D10: no existe tabla de push tokens en ninguna migración del repo, y no
 * hay cliente móvil capaz de registrar uno. Devuelve `null` siempre, a
 * propósito. Reemplazarlo por un `KyselyPushTokenResolver` el día que la
 * tabla exista es UNA línea en `NotificationsModule`.
 */
@Injectable()
export class NullPushTokenResolver implements PushTokenResolver {
  async resolve(): Promise<null> { return null; }
}
```

**Por qué un puerto inyectado y no un `private async resolveToken() { return null }`:**

1. Hace testeable **la rama futura** (con token) sin tocar el adaptador: se inyecta un resolver falso y se ejerce el camino que hoy no existe.
2. **Nombra la capacidad faltante** en vez de enterrarla en un método privado. R7 dice que el riesgo es justamente que todos olviden que las pushes no llegan; un archivo llamado `null-push-token.resolver.ts` en `providers` es imposible de no ver.
3. Es el patrón que el repo ya usa: `NOTIFICATION_PORT` nació como token sin proveedor por la misma razón.

### `ExpoPushNotificationAdapter`, forma exacta

```ts
@Injectable()
export class ExpoPushNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(ExpoPushNotificationAdapter.name);

  constructor(@Inject(PUSH_TOKEN_RESOLVER) private readonly resolver: PushTokenResolver) {}

  async sendPush(recipientProfileId: string, mensaje: string): Promise<void> {
    // D10, regla dura: este método NUNCA lanza. Ni por falta de token, ni
    // por un error interno. El try/catch por ítem del cron (D4) es la
    // SEGUNDA red, no la primera.
    try {
      const token = await this.resolver.resolve(recipientProfileId);

      if (token === null) {
        // El caso común y esperado hoy. `log`, no `warn`: no es una anomalía.
        this.logger.log({ evento: 'push.omitida', recipientProfileId, motivo: 'sin_token' });
        return;
      }

      // INALCANZABLE hoy (NullPushTokenResolver siempre devuelve null).
      // `warn`, no silencio: si alguien cablea un resolver real sin cablear
      // el cliente, se entera por un log ruidoso en vez de por nada.
      // <-- PUNTO DE INSERCIÓN EXACTO de `expo-server-sdk` (Q7).
      this.logger.warn({
        evento: 'push.no_entregada',
        recipientProfileId,
        motivo: 'token_presente_sin_cliente_expo',
      });
    } catch (error) {
      this.logger.error({ evento: 'push.error', recipientProfileId, error });
    }
  }
}
```

`mensaje` no se registra en el log: son datos de salud (nombre del medicamento). Se loguea el `profileId` y el motivo, nunca el contenido.

`sendPush` devuelve `Promise<void>` sin señal de éxito, a propósito (fire-and-forget). Un cambio futuro que quiera receipts de entrega necesita cambiar el puerto, y está bien que lo necesite.

### Consecuencia: se enmienda una fila de Affected Areas

La proposal anota en `services/core-api/package.json`: *"Dependencias nuevas: `@nestjs/schedule` (D1) y el cliente de Expo Push (D10, Q7)"*. Q7 delegó la elección acá, y la elección es **no agregar el cliente**. **Enmienda declarada: `@nestjs/schedule` es la única dependencia nueva de este cambio.** No re-abre D10 (que fijó "adaptador con fallback no-op, almacenamiento diferido"); resuelve la pregunta que D10 dejó abierta.

---

## D-H · Tres vacíos que ninguna pregunta abierta nombró

Aparecieron al mapear los casos de uso contra los puertos existentes. Los tres son deltas declarados de `consumo/SPEC.md`.

### 1. `registrarMascota` no tiene puerto de persistencia

`ConsumoInboundPort.registrarMascota(userId, datos): Promise<Pet>` existe en el SPEC, pero su bloque "Puertos de salida" lista **solo** `ConsumptionRepository` y `ConsumptionLogRepository`. **No hay forma de persistir un `Pet`.** Mismo tipo de vacío que Q2 (el umbral referenciado sin campo).

Se rechaza meter `savePet`/`findPetById` en `ConsumptionRepository`: haría que esa interfaz mienta sobre su nombre y acoplaría la persistencia de dos agregados con tablas distintas.

```ts
// ports-out/pet-repository.port.ts   (nuevo)
export interface PetRepository {
  save(pet: Pet, tx?: TransactionContext): Promise<void>;
  /** Necesario para el chequeo de propiedad del punto 3. */
  findById(petId: string, tx?: TransactionContext): Promise<Pet | null>;
}
export const PET_REPOSITORY = Symbol('PET_REPOSITORY');
```

El `id` se genera en el caso de uso con `randomUUID()` y se pasa a la factory de la entidad — precedente uniforme del repo (`cargarProductoCatalogo`, `registrarEmpresa`, `asignarRolAdmin`), nunca el default de la DB.

### 2. `marcarDosisTomada` necesita un decremento atómico

El decremento ingenuo es leer la entidad, restar `dosisPorToma` y `save()`. Es un **read-modify-write**: dos dosis concurrentes (doble tap en el móvil, dos dispositivos) se pisan y se pierde un decremento.

```ts
/** UPDATE ... SET stock_actual = greatest(stock_actual - $2, 0) ... RETURNING stock_actual */
descontarStock(consumptionId: string, cantidad: number, tx?: TransactionContext): Promise<number>;
```

Atómico, inmune a lost update, y devuelve el stock nuevo — lo que le da a `DosisRegistrada` su campo `stockRestante` sin una segunda lectura.

**Costo declarado**: la invariante "el stock nunca queda negativo" queda expresada por el `greatest(..., 0)` del **adaptador**, no por la entidad. Contradice el patrón que `catalogo` fijó ("la entidad valida, el CHECK es la red de seguridad") y se acepta con los ojos abiertos: expresarla en la entidad exige un read-modify-write que **no es seguro bajo concurrencia**. La atomicidad gana; el contrato se escribe en el doc comment del puerto y se testea a nivel de adaptador.

Y el clamp a 0 en vez de rechazar la dosis es una decisión de dominio: **el log es el registro de salud y debe reflejar la realidad** (append-only, `cantidad = dosisPorToma` siempre), mientras `stockActual` es una estimación que el usuario corrige por `configurarConsumo`. Rechazar la dosis por una estimación desactualizada sería negarle al usuario escribir su propio historial. Los escenarios son de `sdd-spec`.

**Consecuencia conjunta con D-A**: `save()` queda usado **solo por `configurarConsumo`**. El cron usa los dos métodos de marcador; `marcarDosisTomada` usa `descontarStock`. Cada método de escritura tiene su semántica de concurrencia explícita, y "¿quién puede pisar qué?" se responde leyendo el puerto.

### 3. `configurarConsumo` acepta un `petId` del cliente

D8 cierra el `userId`: viene del actor, ningún DTO lo acepta. Pero `configurarConsumo` con `ownerType: 'pet'` recibe un **`petId` suministrado por el cliente**, y `pets` es una tabla con dueño. Sin chequeo, un usuario ata su consumo a la mascota de otro: escritura cross-tenant, misma familia que R1.

No es una decisión nueva — es **la regla de D7 aplicada a la única FK que el cliente puede elegir**: buscar por id, verificar propiedad contra `actor.profileId`, **404 y no 403**. `PetNotFoundError`, byte a byte idéntico a "la mascota no existe".

---

## Diagrama 1 · El cron diario de punta a punta (D1 + D2 + D3 + D4 + D-A + D-C + D-E)

```
 @Cron('0 9 * * *', tz=America/Santiago)   ProcesarConsumosVencidosUseCase        ConsumptionRepository   EventPublisher   NotificationPort
 adapters/scheduling/                      (ports-in, D2)                          (ports-out)             (kernel)         (kernel, D9/D-G)
 consumption-check.job.ts (D1)             SIN ruta HTTP · SIN @Roles
     |                                     SIN TRANSACTION_MANAGER inyectado (D4)
     |                                              |                                     |               |            |
 (0) 09:00 America/Santiago. `disabled` si CONSUMO_CRON_ENABLED=false (D-E).
     |  DST: 09:00 nunca se salta ni se duplica; medianoche sí -> por eso NO es medianoche (D-F).
     |----- execute() -------------------------->|                                     |               |            |
     |      UNA llamada, CERO logica (D1).       |                                     |               |            |
     |                                           |                                     |               |            |
     |                                     (1)   |--- findDueForCheck(UMBRAL_STOCK_BAJO_DIAS) ------->|            |
     |                                           |    (D-B: constante de dominio, viaja como parametro)|            |
     |                                           |                                     |               |            |
     |                                           |    WHERE stock_bajo_notificado_at IS NOT NULL       |            |
     |                                           |       OR stock_actual * frecuencia_dias             |            |
     |                                           |            < (U+1) * dosis_por_toma * n_horarios    |            |
     |                                           |    (D-C: union "puede disparar" u "puede limpiarse";|            |
     |                                           |     multiplicativa -> jamas division por cero;      |            |
     |                                           |     superconjunto ESTRICTO, nunca la decision)      |            |
     |                                           |<-- UserConsumption[] (candidatas) ------------------|            |
     |                                           |                                     |               |            |
     |                                     (2)   POR CADA candidata --- SIN runInTransaction (D4) ---
     |                                           |   La garantia no es un test: este caso de uso NO
     |                                           |   inyecta TRANSACTION_MANAGER en absoluto.
     |                                           |   Todo el cuerpo va en try/catch: un item que falla
     |                                           |   se loguea y el loop CONTINUA (D4).
     |                                           |
     |                                     2a.   consumoDiario = dosisPorToma * horarios.length / frecuenciaDias
     |                                           diasRestantes = Math.floor(stockActual / consumoDiario)
     |                                           <-- funcion pura de domain/, unica autoridad del calculo
     |                                           |
     |                                     2b.   RAMA LIMPIEZA:  diasRestantes >= UMBRAL
     |                                           |                y stockBajoNotificadoAt !== null
     |                                           |--- limpiarMarcaStockBajo(id) ------->|  UPDATE ... SET
     |                                           |    (idempotente: 0 filas = ya limpia)|  = NULL
     |                                           |    CERO eventos, CERO push. CONTINUE.|
     |                                           |
     |                                     2c.   diasRestantes >= UMBRAL y marcador ya NULL -> no-op. CONTINUE.
     |                                           |    (solo puede llegar por la banda [U, U+1) que el +1 de D-C trae de mas)
     |                                           |
     |                                     2d.   RAMA DISPARO:  diasRestantes < UMBRAL
     |                                           |--- intentarMarcarStockBajo(id, now) ->|
     |                                           |    UPDATE ... SET = now()             |
     |                                           |    WHERE id=$1 AND ..._at IS NULL     |
     |                                           |    RETURNING id                       |
     |                                           |<-- false (0 filas) --------------------|
     |                                           |      ==> YA reclamada: por la corrida de ayer (D5),
     |                                           |          por otra replica, o por una corrida solapada
     |                                           |          (D-E). NO emite. NO pushea. CONTINUE.
     |                                           |<-- true (1 fila) ----------------------|
     |                                           |
     |                                           |      RECLAMAR ANTES DE EMITIR (D-E), a proposito:
     |                                           |      caida aca => alerta PERDIDA (contenida en consumo),
     |                                           |      jamas alerta DUPLICADA (RefillRequest que otro
     |                                           |      dominio persiste y un usuario ve).
     |                                           |
     |                                     2e.   |--- publish(StockBajoDetectado{payload}) ---------->|            |
     |                                           |      UNO POR ITEM, nunca un resumen del dia (D3):
     |                                           |      refill-matching necesita la identidad concreta.
     |                                           |
     |                                     2f.   si consumption.autoCrearRefill:
     |                                           |--- publish(RefillAutoSolicitado{mismo payload}) -->|            |
     |                                           |      Mismo juego de campos, canal distinto (D-D):
     |                                           |      este lleva CONSENTIMIENTO, no solo un hecho.
     |                                           |
     |                                     2g.   |--- sendPush(userId, mensajeStockBajo(...)) ---------------------->|
     |                                           |      Best-effort (D10). El adaptador NUNCA lanza,
     |                                           |      ni sin token ni por error interno (D-G).
     |                                           |      Mensaje compuesto por una funcion pura de domain/,
     |                                           |      SIN lookup de la mascota: seria un N+1 dentro del loop.
     |                                           |      Hoy: log 'push.omitida / sin_token' y retorna.
     |                                           |
     |                                     (3)   log de resumen: { candidatas, emitidos, limpiados, fallidos, duracionMs }
     |                                           Trip-wire (D-F): duracionMs cerca de 1 h => lote (D-C), NO un lock.
```

**Segunda corrida sobre la misma condicion sin resolver** → paso 2d devuelve `false` → **cero eventos, cero push**. Ese es exactamente el criterio de éxito de D5, y lo produce **una** sentencia SQL.

---

## Diagrama 2 · `marcarDosisTomada`: la transacción (D6 + D7 + D-H)

```
 usuario           ConsumoController          MarcarDosisTomadaUseCase       ConsumptionRepository /       EventPublisher
                   (adapters/http)            (ports-in)                     ConsumptionLogRepository      (kernel)
    |                     |                            |                              |                        |
 POST /consumo/mis-consumos/{consumptionId}/dosis
 body: { tomadoAt?: "2026-08-10T12:30:00Z" }   <-- el DTO NO tiene userId. Tampoco cantidad (D-H).
    |-------------------->|                            |                              |                        |
    |                (1)  AuthGuard resuelve el actor. Sin @Roles: cualquier perfil autenticado
    |                     puede llevar su propio consumo (ver §Superficie HTTP).
    |                (2)  tomadoAt ausente -> now() del servidor.  tomadoAt futuro -> 400 DOSIS_INVALIDA.
    |                (3)  |--- execute(actor.profileId, consumptionId, tomadoAt) --->|
    |                     |      D8: el dueno SIEMPRE se deriva del actor.           |
    |                     |                            |                              |
    |                     |                      (4)  runInTransaction (D6) ============================
    |                     |                            |                              |
    |                     |                      4a.  |--- findById(consumptionId, tx) ----->|
    |                     |                            |<-- UserConsumption | null ----------|
    |                     |                            |
    |                     |                      4b.  null  ||  uc.userId !== actor.profileId
    |                     |                            |       ==> ConsumptionNotFoundError ==> 404 (D7)
    |                     |                            |           Se lanza DENTRO de la transaccion:
    |                     |                            |           rollback sin escrituras. Ver Diagrama 3.
    |                     |                            |
    |                     |                      4c.  |--- append({ id: randomUUID(), consumptionId, ---->|
    |                     |                            |            tomadoAt, cantidad: uc.dosisPorToma }, tx)
    |                     |                            |    cantidad = la dosis CONFIGURADA, jamas un valor
    |                     |                            |    del cliente: seria un segundo canal de confianza
    |                     |                            |    sin ningun spec que lo pida.
    |                     |                            |
    |                     |                      4d.  |--- descontarStock(consumptionId, uc.dosisPorToma, tx) -->|
    |                     |                            |    UPDATE ... SET stock_actual =                        |
    |                     |                            |      greatest(stock_actual - $2, 0)                     |
    |                     |                            |    RETURNING stock_actual        <-- atomico (D-H):     |
    |                     |                            |<-- stockRestante ---------------- inmune a lost update  |
    |                     |                            |
    |                     |                            |    El marcador de debounce NO se toca (D-A):
    |                     |                            |    una dosis solo puede BAJAR el stock, jamas
    |                     |                            |    resolver la condicion de alerta.
    |                     |                            |
    |                     |                      ---- COMMIT ----------------------------------------------
    |                     |                            |
    |                     |                      (5)  |--- publish(DosisRegistrada{ consumptionId, userId, --->|
    |                     |                            |        tomadoAt, cantidad, stockRestante })            |
    |                     |                            |    DESPUES del commit, nunca dentro: un consumidor
    |                     |                            |    no puede reaccionar a una dosis que se revirtio.
    |<-- 204 -------------|                            |
```

**Por qué transacción acá y no en el cron** — misma asimetría que `ajustarPreciosPorCategoria` vs. `cargarCatalogoMasivo` en `catalogo`, y la dicta el tipo de retorno. `marcarDosisTomada` devuelve `Promise<void>`: **no tiene canal para reportar éxito parcial**. Un log escrito sin decrementar el stock (o al revés) corrompe en silencio el cálculo de días restantes del que depende todo el cron — y lo corrompe de forma que nadie puede detectar ni corregir. El loop del cron, en cambio, procesa filas **independientes sin ninguna invariante cross-ítem**, y D4 lo dice: una fila que falla no puede bloquear a las demás.

---

## Diagrama 3 · Rechazo cross-tenant (D7 + D8)

Estructura idéntica al Diagrama 3 de `catalogo` (`actualizarPrecio`); no se re-deriva el razonamiento, se referencia. **Dos diferencias que sí importan**, y por eso el diagrama existe: acá los datos son de salud, y el mismo chequeo aplica también a una **lectura** (`calcularDiasRestantes`), no solo a una mutación.

```
 usuario A          ConsumoController         CalcularDiasRestantesUseCase        ConsumptionRepository
    |                       |                 (ports-in — D2: query PURA)                  |
 GET /consumo/mis-consumos/{consumptionId del usuario B}/dias-restantes
    |---------------------->|                          |                                   |
    |                  (1)  Autenticado. El actor trae profileId = A.
    |                       No hay :userId en la URL, y no puede haberlo: el prefijo
    |                       `mis-consumos` codifica D8 en el espacio de URLs.
    |                  (2)  |--- execute(actor.profileId = A, consumptionId) --->|
    |                       |                          |                                   |
    |                       |                     (3)  |--- findById(consumptionId) ------>|
    |                       |                          |<-- UserConsumption { userId: B } -|
    |                       |                          |
    |                       |                     (4)  uc.userId (B) !== profileId (A)
    |                       |                          |   throw ConsumptionNotFoundError
    |<-- 404 { statusCode:404, code:'CONSUMPTION_NOT_FOUND' } -----------------------------|
    |
    |  Byte a byte identico a la rama "no existe" ((3) devuelve null).
    |  404 y NO 403: un 403 confirmaria que el recurso existe y es de otro, filtrando
    |  existencia cross-tenant por enumeracion de UUIDs. Con RLS bypasseada en la conexion
    |  service-role, el chequeo del caso de uso es la UNICA defensa (D7).
    |  El log interno SI distingue ambos casos; la respuesta HTTP no.
    |
    |  == LO QUE ESTE CASO DE USO NO INYECTA (D2 + R4) ============================
    |     Constructor: SOLO CONSUMPTION_REPOSITORY.
    |     NO EVENT_PUBLISHER. NO NOTIFICATION_PORT. NO TRANSACTION_MANAGER.
    |     Esa ausencia es la garantia estructural de que un GET de "dias restantes"
    |     NO puede disparar una push ni un refill automatico — verificable leyendo
    |     un constructor, no confiando en una convencion. Misma forma que el
    |     "sin TRANSACTION_MANAGER" de cargarCatalogoMasivo.
    |
    |  == LA MISMA REGLA, EN LAS OTRAS 3 RUTAS ====================================
    |     marcarDosisTomada     -> mismo findById + mismo 404 (Diagrama 2, paso 4b)
    |     configurarConsumo     -> mismo chequeo sobre el petId del cliente,
    |                              PetNotFoundError -> 404 (D-H.3)
    |     registrarMascota      -> sin id del cliente que verificar; userId del actor (D8)
```

---

## Wiring de módulos y tokens

### `shared/notifications/notifications.module.ts` (nuevo, D9)

```ts
@Global()
@Module({
  // SIN `imports`, y es la UNICA diferencia con AuditModule: aquel importa
  // DatabaseModule porque KyselyAuditLogAdapter necesita DATABASE.
  // NullPushTokenResolver no toca nada. El dia que aterrice un
  // KyselyPushTokenResolver, esta linea vuelve como `imports: [DatabaseModule]`.
  providers: [
    { provide: PUSH_TOKEN_RESOLVER, useClass: NullPushTokenResolver },
    { provide: NOTIFICATION_PORT, useClass: ExpoPushNotificationAdapter },
  ],
  // Solo NOTIFICATION_PORT cruza el borde. PUSH_TOKEN_RESOLVER es interno a
  // shared/notifications/ — mismo criterio con el que AuditModule exporta
  // solo AUDIT_LOG_PORT.
  exports: [NOTIFICATION_PORT],
})
export class NotificationsModule {}
```

### `shared/shared-kernel.module.ts` (modificado)

```ts
imports: [DatabaseModule, SupabaseModule, EventBusModule, AuditModule, AuthModule, NotificationsModule],
exports: [DatabaseModule, SupabaseModule, EventBusModule, AuditModule, AuthModule, NotificationsModule],
```

**El doc comment tiene que reescribirse, no solo ampliarse.** Hoy dice: *"`shared/notifications` and `shared/payments` declare tokens but bind no provider yet … they are intentionally not wired here."* Después de este cambio esa frase es **medio falsa**, que es peor que falsa entera: hay que dejar la mitad de `shared/payments` intacta y explicar que `shared/notifications` ya no aplica.

### `consumo.module.ts` — de `@Module({})` a providers reales

```ts
@Module({
  imports: [DatabaseModule],            // redundante (es @Global) pero explicito: mismo estilo que Identidad/Catalogo
  controllers: [ConsumoController],
  providers: [
    { provide: CONSUMPTION_REPOSITORY,     useClass: KyselyConsumptionRepository },
    { provide: CONSUMPTION_LOG_REPOSITORY, useClass: KyselyConsumptionLogRepository },
    { provide: PET_REPOSITORY,             useClass: KyselyPetRepository },        // D-H.1
    RegistrarMascotaUseCase,
    ConfigurarConsumoUseCase,
    MarcarDosisTomadaUseCase,
    CalcularDiasRestantesUseCase,
    ProcesarConsumosVencidosUseCase,      // interno: sin ruta, sin @Roles (D2)
    ConsumptionCheckJob,                  // en `providers`, no `controllers`: @Cron se descubre igual que @OnEvent
  ],
  // VACIO, a proposito (D9 + D14): consumo no bindea NOTIFICATION_PORT (vive
  // en el kernel) y no expone nada cross-dominio (no tiene `contracts/`).
  exports: [],
})
export class ConsumoModule {}
```

`app.module.ts`: **agregar `ScheduleModule.forRoot()`** a `imports` (D1). `ConsumoModule` ya está importado desde PR 9 de la fundación — no se toca esa línea.

### Estructura de archivos nueva

```
domains/consumo/
├── domain/
│   ├── pet.entity.ts                      (crear + validaciones)
│   ├── user-consumption.entity.ts         (crear + invariante petId <=> ownerType==='pet'
│   │                                       + dosisPorToma > 0 + horarios no vacio)
│   ├── consumo.calculos.ts                (consumoDiario, diasRestantes, mensajeStockBajo
│   │                                       — funciones PURAS, unica autoridad de la formula)
│   ├── consumo.constants.ts               (UMBRAL_STOCK_BAJO_DIAS — D-B)
│   └── consumo.errors.ts
├── ports-in/
│   ├── registrar-mascota.use-case.ts
│   ├── configurar-consumo.use-case.ts
│   ├── marcar-dosis-tomada.use-case.ts
│   ├── calcular-dias-restantes.use-case.ts    ── query PURA (D2): sin publisher, sin push
│   └── procesar-consumos-vencidos.use-case.ts ── interno (D2): sin ruta HTTP, sin @Roles,
│                                                  sin TRANSACTION_MANAGER (D4)
├── ports-out/
│   ├── consumption-repository.port.ts     (+ findById, + findDueForCheck(umbralDias),
│   │                                       + intentarMarcarStockBajo, + limpiarMarcaStockBajo,
│   │                                       + descontarStock)
│   ├── consumption-log-repository.port.ts (sin cambios — confirmado contra el uso real)
│   └── pet-repository.port.ts             (NUEVO — D-H.1)
├── events/
│   ├── stock-bajo.payload.ts
│   ├── stock-bajo-detectado.event.ts
│   ├── refill-auto-solicitado.event.ts
│   └── dosis-registrada.event.ts
├── adapters/
│   ├── http/         consumo.controller.ts · consumo.mapper.ts
│   │                 consumo-exception.filter.ts · dto/*.dto.ts
│   ├── persistence/  kysely-consumption.repository.ts
│   │                 kysely-consumption-log.repository.ts
│   │                 kysely-pet.repository.ts
│   └── scheduling/   consumption-check.job.ts       ── PRIMERA VEZ EN EL REPO (D1)
└── consumo.module.ts

SIN `contracts/`    — productor puro de eventos, ningun dominio lee sincronicamente (D14)
SIN `adapters/events/` — "Eventos que consume: Ninguno" (D14). Segundo dominio publish-only,
                         igual que identidad. Ambas ausencias son DELIBERADAS: las dos carpetas
                         son patrones establecidos y no-default del repo (catalogo necesito las dos).
```

### El adaptador de scheduling, completo

```ts
// adapters/scheduling/consumption-check.job.ts
@Injectable()
export class ConsumptionCheckJob {
  constructor(private readonly procesarConsumosVencidos: ProcesarConsumosVencidosUseCase) {}

  @Cron('0 9 * * *', {
    name: 'consumo.chequeo-stock-diario',
    timeZone: 'America/Santiago',
    disabled: process.env.CONSUMO_CRON_ENABLED === 'false',
  })
  async ejecutar(): Promise<void> {
    await this.procesarConsumosVencidos.execute();
  }
}
```

**Una llamada, cero lógica** (D1). No lleva try/catch (el caso de uso ya captura por ítem bajo D4), no lleva guarda de re-entrada (D-F), no lleva logging (el caso de uso lo hace). **Por diseño no necesita test propio**: no hay nada que testear salvo que Nest registre el cron, y eso lo prueba el arranque de la app. Esa es exactamente la propiedad que hace que migrar a un scheduler externo sea barato.

---

## Superficie HTTP

| Método + ruta | Guard | Caso de uso | Éxito |
|---|---|---|---|
| `POST /consumo/mis-mascotas` | autenticado (sin `@Roles`) | `registrarMascota` | 201 `PetResponseDto` |
| `POST /consumo/mis-consumos` | autenticado (sin `@Roles`) | `configurarConsumo` | 201 `UserConsumptionResponseDto` |
| `POST /consumo/mis-consumos/:consumptionId/dosis` | autenticado (sin `@Roles`) | `marcarDosisTomada` | 204 |
| `GET /consumo/mis-consumos/:consumptionId/dias-restantes` | autenticado (sin `@Roles`) | `calcularDiasRestantes` | 200 `{ diasRestantes }` |
| — | — | `procesarConsumosVencidos` | **Sin ruta. Nunca.** (D2/R4) |

**`mis-` codifica D8 en el espacio de URLs**, exactamente como `mi-catalogo` en `catalogo`. No existe —y no debe existir— una ruta `/consumo/usuarios/:userId/...`: un path param de dueño es una invitación permanente a que alguien lo pase al caso de uso en vez de `actor.profileId`. Con `mis-`, la única fuente posible del dueño es el actor.

**Sin `@Roles('user')`, y es una decisión, no un olvido.** `pets` y `user_consumption` referencian `profiles(id)` sin ninguna restricción de rol, y sus políticas RLS son `user_id = auth.uid()` sin chequeo de rol. Poner `@Roles('user')` haría la API **más estricta que la base de datos y más estricta que cualquier spec**, y dejaría a un perfil `provider` sin poder registrar la mascota que sí puede tener. Misma forma que `GET /catalogo/productos`: autenticado, cualquier rol. La seguridad cross-tenant no depende del rol — la da D7/D8 en los 4 casos de uso.

**Tampoco hay ruta de admin.** Son datos de salud y acciones self-service; D13 ya usó ese mismo encuadre para descartar `AuditLogPort` en este dominio.

`POST .../dosis` acepta `{ tomadoAt?: string }` opcional (ISO-8601). Ausente → `now()` del servidor. **Futuro → 400**, con tolerancia chica de skew de reloj: `ConsumptionLog.tomadoAt` alimenta la adherencia, y un timestamp futuro la corrompe. Los escenarios exactos son de `sdd-spec`.

Errores: `ConsumoExceptionFilter` con `@UseFilters` a nivel de controlador, espejo exacto de `CatalogoExceptionFilter` (mapa keyeado por constructor, envelope `{ statusCode, code, message }`, `@Catch()` acotado para no competir con el filtro global).

| Error de dominio | HTTP | `code` |
|---|---|---|
| `ConsumptionNotFoundError` | **404** | `CONSUMPTION_NOT_FOUND` |
| `PetNotFoundError` | **404** | `PET_NOT_FOUND` |
| `ConsumoInvalidoError` | 400 | `CONSUMO_INVALIDO` |
| `MascotaInvalidaError` | 400 | `MASCOTA_INVALIDA` |
| `DosisInvalidaError` | 400 | `DOSIS_INVALIDA` |

Los dos 404 son el contrato observable de D7. Cambiarlos después es un cambio de contrato de API — la propia proposal los pone en la columna "caro de cambiar".

---

## Mapa de transacciones

| Operación | ¿`runInTransaction`? | Sentencias | Razón |
|---|---|---|---|
| `registrarMascota` | No | 1 insert | Una sentencia |
| `configurarConsumo` | No | 1 select (propiedad del pet) + 1 upsert | Sin invariante cross-sentencia. La lectura no puede quedar peligrosamente vieja: **`pets.user_id` nunca cambia** — no hay transferencia de mascota en ningún caso de uso —, mismo argumento que `company_id` en `actualizarPrecio` de `catalogo` |
| **`marcarDosisTomada`** | **Sí (D6)** | 1 select + 1 insert + 1 update | Dos escrituras acopladas y `Promise<void>`: cero canal para reportar parcialidad. Ver Diagrama 2 |
| `calcularDiasRestantes` | No | 1 select | Lectura pura (D2) |
| **`procesarConsumosVencidos`** | **No — estructuralmente imposible** | N × (1 update de CAS) autocommiteados | **D4. El caso de uso no inyecta `TRANSACTION_MANAGER`**: la garantía no depende de que alguien recuerde no usarlo. Cada fila es independiente; no hay invariante cross-ítem que proteger |

**Confirmación explícita de que ninguna transacción se cuela en el cron** (Q lo pide): las **tres** escrituras posibles del loop —`intentarMarcarStockBajo`, `limpiarMarcaStockBajo` y nada más— son **una sentencia cada una**, así que ni siquiera existe un par de escrituras que alguien pudiera querer atomizar. Se refuerza con dos propiedades verificables por inspección:

1. `ProcesarConsumosVencidosUseCase` **no inyecta `TRANSACTION_MANAGER`** — misma garantía por construcción que `cargarCatalogoMasivo`.
2. Los métodos de marcador **no aceptan `tx` desde el cron** (aceptan `tx?` por la convención repo-wide de la fundación, pero el caso de uso los llama sin él, siempre).

`CalcularDiasRestantesUseCase` agrega la tercera inspección (D2/R4): **no inyecta `EVENT_PUBLISHER` ni `NOTIFICATION_PORT`**.

---

## Migración y row types

### `supabase/migrations/20260806120000_13_consumo_stock_bajo_debounce.sql`

Ventana de timestamps propia; la última aplicada es `20260805120100_12_…`. Fix-forward: no edita ninguna migración aplicada (convención de `20260804090500_10_…`).

```sql
-- Batch 13 -- consumo: marcador de debounce del chequeo diario de stock.
-- Delta declarado sobre db-schema-consumo (backend-core-api-consumo D5/Q1).
-- Solo seccion 2 del layout estandar: cero tablas, cero enums, cero RLS.

alter table public.user_consumption
  add column stock_bajo_notificado_at timestamptz;

comment on column public.user_consumption.stock_bajo_notificado_at is
  'Marcador de debounce del chequeo diario de stock (backend-core-api-consumo D5/Q1, design.md D-A). NULL = no hay alerta abierta; non-NULL = el cron ya emitio StockBajoDetectado (y RefillAutoSolicitado si correspondia) en ese instante y no vuelve a emitir hasta que la condicion se resuelva. Lo escribe UNICAMENTE procesarConsumosVencidos, via compare-and-set (UPDATE ... WHERE stock_bajo_notificado_at IS NULL RETURNING id) -- nunca via save(), que pisaria un decremento de stock concurrente. Lo limpian el propio cron al detectar stock por encima del umbral, y configurarConsumo al reconfigurar el item. Ningun otro dominio lo lee ni lo escribe. Es timestamptz y no boolean a proposito: habilita una politica futura de "re-alertar a los N dias" sin migracion.';
```

**Tres cosas que esta migración NO necesita, verificadas:**

- **Sin grant nuevo.** `20260804090500_10_…` ya corre `grant select, insert, update on public.user_consumption to service_role`, y los grants a nivel de tabla cubren columnas agregadas después.
- **Sin cambio de RLS.** `user_consumption_authenticated_select_own` es agnóstica de columnas, así que un usuario pasa a poder leer el marcador **de sus propias filas**. No filtra nada: es su propio estado de alerta.
- **Sin índice.** Ver D-C.

### Row types de Kysely (`shared/database/schema.ts`, D12)

```ts
export type OwnerTypeRow = 'self' | 'pet';
export type ConsumptionKindRow = 'medicamento' | 'alimento' | 'vacuna' | 'suplemento';

export interface PetsTable {
  id: Generated<string>;
  user_id: string;
  nombre: string;
  especie: string;
  raza: string | null;
  peso_kg: string | null;              // numeric -> string
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UserConsumptionTable {
  id: Generated<string>;
  user_id: string;                      // D15: el campo que hace expresable el chequeo de D7
  owner_type: OwnerTypeRow;
  pet_id: string | null;
  kind: ConsumptionKindRow;
  nombre: string;
  dosis_por_toma: string;               // numeric -> string
  unidad: string | null;
  frecuencia_dias: number;              // integer -> number (pg SI parsea int4)
  horarios: string[];                   // text[] -> string[]
  stock_actual: string;                 // numeric -> string
  auto_crear_refill: boolean;           // NOT NULL sin default -> no Generated
  stock_bajo_notificado_at: string | null;   // D-A
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ConsumptionLogsTable {
  id: Generated<string>;
  consumption_id: string;
  tomado_at: string;
  cantidad: string | null;              // numeric -> string
  created_at: Generated<string>;
}
```

> ### ⚠️ El detalle mecánico de mayor riesgo del cambio: `numeric` vuelve como `string`
>
> **Cuatro** columnas de este dominio son `numeric`: `dosis_por_toma`, `stock_actual`, `pets.peso_kg`, `consumption_logs.cantidad`. node-postgres las devuelve como **`string`** (parser por defecto del OID 1700, para no perder precisión) — el gotcha que D-C de `catalogo` ya descubrió y documentó para `precio_base`/`precio_maximo`.
>
> Acá pega mucho más fuerte, porque **el dominio entero es aritmética**. Si el mapper olvida una sola conversión, `stockActual - dosisPorToma` se evalúa entre strings y produce `NaN`, y **el cálculo de días restantes devuelve basura en silencio** — sin excepción, sin log, sin test que falle salvo que se haya escrito uno con datos reales.
>
> Ya existe precedente aplicable (`ProviderCatalogTable.precio_base: string` + conversión en el mapper de `adapters/persistence/`), así que esto es **"aplicar un gotcha conocido"**, no descubrirlo. La conversión vive en el mapper de `adapters/persistence/`, junto al resto del cruce `snake_case ⇄ camelCase`, y **nunca** en `domain/` ni en `ports-in/`.

### `@repon/types` (D15, único trabajo de tipos compartidos)

```ts
export interface UserConsumption {
  id: string;
  userId: string;    // <-- NUEVO (D15). Sin esto, el chequeo de propiedad de D7 no es
                     //     expresable sobre la entidad que devuelve el repositorio.
  ownerType: OwnerType;
  // ... el resto sin cambios
}
```

---

## Secuencia de implementación (7 PRs encadenados)

Cada PR deja `main` verde y coherente. Bajo **D16 (strict TDD, sin excepciones)**, cada uno arranca por sus tests. Los providers de `consumo.module.ts` se agregan **incrementalmente** en el PR que los necesita; el PR 7 es la auditoría final, no el primer cableado.

| PR | Slice | Contenido | Por qué acá |
|---|---|---|---|
| **1** | 0 · groundwork | Migración 13 (D-A/Q1); los 3 row types + `DB` (D12); `UserConsumption.userId` en `@repon/types` (D15); **los 3 ports-out en su forma final** (`PetRepository` nuevo, `ConsumptionRepository` extendido, log repo confirmado); `domain/consumo.constants.ts` (D-B); `domain/consumo.errors.ts` | Cero comportamiento, puras costuras. **La migración sube al PR 1**, no "antes del slice 5" como sugería la proposal: el row type tiene que incluir la columna igual, así que dejarla para después obliga a tocar `schema.ts` dos veces. Una migración descubierta a mitad de slice es una interrupción (mismo criterio que `catalogo`) |
| **2** | 1 · dominio + lectura | Entidades `Pet`/`UserConsumption` + invariantes (`petId ⟺ ownerType==='pet'`, `dosisPorToma > 0`, `horarios` no vacío); `consumo.calculos.ts` (funciones puras); los 3 adaptadores Kysely **con el mapper de `numeric`**; `CalcularDiasRestantesUseCase`; controller + filter + mapper + `GET .../dias-restantes` | **El negativo cross-tenant (404) se escribe acá, primero** — R1 se cierra en este PR y es el que más merece review dedicada. La matemática pura es lo único de lo que todo lo demás depende |
| **3** | 2 · escritura | `RegistrarMascotaUseCase`; `ConfigurarConsumoUseCase` (+ chequeo de propiedad del `petId`, D-H.3); DTOs + 2 rutas `POST` | D8 completo: ningún DTO acepta `userId`. El segundo negativo obligatorio (`petId` ajeno → 404) va acá |
| **4** | 3 · dosis | `descontarStock` en el adaptador (D-H.2); `MarcarDosisTomadaUseCase` transaccional (D6); `DosisRegistrada`; `POST .../dosis` | Necesita el `findById` del PR 2. Separado del PR 3 por semántica transaccional distinta y test distinto (rollback deja cero filas) |
| **5** | 4 · kernel de notificaciones | `PushTokenResolver` + `NullPushTokenResolver` + `ExpoPushNotificationAdapter` (D-G); `NotificationsModule` `@Global()` (D9); cableado y **reescritura del doc comment** de `SharedKernelModule` | **Antes del cron, a propósito** (lo dice la proposal): el caso de uso del PR 6 inyecta `NOTIFICATION_PORT`, y tenerlo bindeado de verdad evita escribirlo contra un mock que después no calce. **Corre las suites completas de `identidad` y `catalogo`** — es el único PR con radio de impacto de kernel (R5) |
| **6** | 5 · cron | `StockBajoDetectado`/`RefillAutoSolicitado` + payload (D-D); `ProcesarConsumosVencidosUseCase` (umbral + CAS + rama de limpieza + fan-out por ítem + captura por ítem); **después** `@nestjs/schedule`, `ScheduleModule.forRoot()`, `CONSUMO_CRON_ENABLED` en `env.schema.ts` y el `@Cron()` delgado | Fija la forma de los payloads con **cero** consumidores (R3). **El PR más grande: candidato #1 a partirse** en 6a (caso de uso, con ports mockeados) y 6b (adaptador + dependencia + env) si `sdd-tasks` lo decide bajo R9. El corte es limpio porque el job no tiene lógica |
| **7** | 6 · cierre | Auditoría final de `consumo.module.ts` (`exports: []`); deltas declarados en `consumo/SPEC.md`, `packages/types/SPEC.md`, `core-api-hexagonal-layout`, `db-schema-consumo`; corrección de `docs/ARCHITECTURE.md` (D11) | Los SPEC.md se actualizan cuando el comportamiento ya existe, no antes |

**Presupuesto de review (R9)**: los PRs 2 y 6 son los que más peso llevan. La decisión de PRs encadenados la toma `sdd-tasks` bajo `delivery_strategy`, no este documento; acá quedan dibujadas las unidades de trabajo autónomas y marcado dónde está el corte natural.

**Dependencias nuevas del cambio: exactamente una — `@nestjs/schedule`** (D-G enmienda la fila de Affected Areas que anticipaba también un cliente de Expo).

---

## Deltas de SPEC.md que `sdd-spec` debe absorber

Los 5 primeros ya venían declarados en la proposal; los **8 restantes** los agrega este documento y **no** pueden aterrizar en silencio (regla `rules.specs` de `openspec/config.yaml`).

| Archivo | Delta | Origen |
|---|---|---|
| `consumo/SPEC.md` | Separación CQS: `procesarConsumosVencidos` interno posee umbral/eventos/push | D2 (proposal) |
| `consumo/SPEC.md` | Marcador de debounce en el esquema, propiedad de `consumo` | D5 (proposal) |
| `consumo/SPEC.md` | `marcarDosisTomada`/`calcularDiasRestantes` derivan el dueño del actor; 404 cross-tenant | D7 (proposal) |
| `packages/types/SPEC.md` | `UserConsumption.userId` | D15 (proposal) |
| `docs/ARCHITECTURE.md` | Corrección del encuadre Edge Function / `pg_cron` | D11 (proposal) |
| `consumo/SPEC.md` | **`PetRepository` nuevo en "Puertos de salida"** — `registrarMascota` no tiene hoy ningún puerto donde persistir un `Pet` | **D-H.1** |
| `consumo/SPEC.md` | **`ConsumptionRepository` suma `findById`, `intentarMarcarStockBajo`, `limpiarMarcaStockBajo`, `descontarStock`; `findDueForCheck` pasa a `findDueForCheck(umbralDias)` y devuelve CANDIDATAS, no ítems bajo umbral** | **D-A / D-C / D-H.2** |
| `consumo/SPEC.md` | **`configurarConsumo` verifica que el `petId` suministrado pertenezca al mismo usuario → 404.** Es D7 aplicado a la única FK que el cliente elige, no una regla nueva | **D-H.3** |
| `consumo/SPEC.md` | **El "umbral configurado" es la constante de dominio `UMBRAL_STOCK_BAJO_DIAS`, igual para todos los usuarios.** El SPEC lo referencia hoy sin que exista campo alguno | **D-B** |
| `consumo/SPEC.md` | **`marcarDosisTomada` descuenta `dosisPorToma` (el cliente nunca envía `cantidad`) y clampea el stock en 0** | **D-H.2** |
| `consumo/SPEC.md` | **Los payloads exactos de los 3 eventos**, y la regla que los gobierna: `consumo` publica hechos propios y la **salida** de sus fórmulas, nunca el enum ni la interpretación de otro dominio | **D-D** |
| `core-api-hexagonal-layout` | `adapters/scheduling/` con presencia **condicional** (obligatoria si el dominio posee un job programado). **Y**: `consumo` omite **`contracts/` y `adapters/events/`** — segundo dominio publish-only, ausencias deliberadas | D1 (proposal) + **D14** |
| `db-schema-consumo` | Columna `stock_bajo_notificado_at`. **Y una aclaración**: `user_consumption` **no tiene columna `activo`**, así que "cada `UserConsumption` activo" de la prosa no tiene contraparte en el esquema y no hay forma de pausar un ítem | **D-A / D-C** |
| `shared-notifications` (capability nueva) | Binding de `NOTIFICATION_PORT` en el kernel; garantía de **no-throw** de `sendPush`; **`PushTokenResolver` como costura declarada** con `NullPushTokenResolver` como implementación de hoy | D9/D10 + **D-G** |

---

## Estrategia de testing (D16: todo esto se escribe primero)

| Capa | Qué se prueba | Cómo | ¿CI? |
|---|---|---|---|
| Unit | Matemática pura: `consumoDiario`, `diasRestantes` con `Math.floor`, bordes (`stock = 0`, exactamente en el umbral, `frecuenciaDias > 1`) | Jest puro, sin contenedor Nest | Sí |
| Unit | Entidades: invariante `petId ⟺ ownerType==='pet'`, `dosisPorToma > 0`, `horarios` no vacío | Jest puro | Sí |
| Unit | **Negativos de autorización (los primeros que se escriben)**: usuario A → `consumptionId` de B → `ConsumptionNotFoundError`; consumo inexistente → **el mismo error**; `petId` de otro usuario en `configurarConsumo` → `PetNotFoundError` | Ports-out mockeados | Sí |
| Unit | **Debounce (D5)**: dos corridas consecutivas sobre la misma condición → `intentarMarcarStockBajo` devuelve `false` la segunda → **exactamente un** `StockBajoDetectado` y **exactamente un** `RefillAutoSolicitado` | Ports mockeados | Sí |
| Unit | **Rama de limpieza (D-A)**: candidata con marcador abierto y `diasRestantes >= UMBRAL` → `limpiarMarcaStockBajo` llamado, **cero** eventos, **cero** push | Mocks | Sí |
| Unit | **Fan-out (D3)**: N ítems bajo umbral → **N** `StockBajoDetectado`, nunca uno resumen; `RefillAutoSolicitado` solo para los que tienen `autoCrearRefill` | Mocks | Sí |
| Unit | **Aislamiento de fallas (D4)**: un ítem que lanza no impide procesar los restantes, su error queda logueado, y `TRANSACTION_MANAGER` **está ausente del constructor** | Mocks | Sí |
| Unit | **`marcarDosisTomada` (D6)**: `runInTransaction` invocado, el `tx` propagado a `append` **y** a `descontarStock`, `publish` **después** del commit, y un fallo en la segunda escritura **no deja el log persistido** | Mocks | Sí |
| Unit | **`CalcularDiasRestantesUseCase` no inyecta `EVENT_PUBLISHER` ni `NOTIFICATION_PORT`** (D2/R4) — inspección del constructor | Jest | Sí |
| Unit | **`sendPush` sin token loguea y retorna sin lanzar**; con resolver que lanza, **tampoco lanza** (D10/D-G) | Resolver mockeado | Sí |
| Integración (opt-in) | El CAS: dos `intentarMarcarStockBajo` sobre la misma fila → uno `true`, uno `false`. `descontarStock` clampea en 0. **`numeric` vuelve como `string`** | `supabase start` local | No (requiere DB) |
| E2E | 401 sin token; 404 cross-tenant en las 2 rutas de `:consumptionId`; 400 de DTO (`tomadoAt` futuro); `/health` sigue 200; **no existe ninguna ruta que alcance `procesarConsumosVencidos`** | `supertest` + `ACTOR_PORT`/`JWT_VERIFIER` sobreescritos | Sí |
| Regresión | **Suites completas de `identidad` y `catalogo` verdes tras tocar `SharedKernelModule`** (R5) | Sin cambios | Sí |

---

## Riesgos residuales y preguntas abiertas

- [ ] **`RefillItem.catalogProductId` no es derivable desde `consumo`** (D-D). `user_consumption` no tiene columna `catalog_product_id`, así que `refill-matching` solo podrá hacer matching difuso por nombre. **El follow-up de mayor valor del cambio**, y es puramente aditivo (columna nullable + campo opcional). Fuera de scope acá: no hay decisión de producto ni autoridad de la proposal.
- [ ] **`RefillRequest.direccion`/`comuna` no existen en ninguna tabla del repo.** `profiles` no tiene dirección. Es un problema entero de `refill-matching`; se nombra acá para que su SDD no lo descubra a mitad de camino.
- [ ] **¿El umbral es por usuario? ¿Por `kind`?** (D-B) Genuinamente decisión de producto. La segunda es más probable y **no necesita migración**.
- [ ] **No hay forma de pausar un `UserConsumption`** (D-C): no existe columna `activo`. Un ítem que el usuario dejó de tomar sigue generando alertas hasta que edite el stock. Decisión de producto, no se inventa la columna acá.
- [ ] **La alerta perdida no se re-emite** (D-E). Caída entre el CAS y el `publish` ⇒ ese episodio de stock bajo no vuelve a alertar hasta que el stock suba por encima del umbral. Aceptado a cambio de nunca duplicar; la tapa está diseñada (política de re-alerta por antigüedad del `timestamptz`, sin migración).
- [ ] **Una fila degenerada (`horarios` vacío o `dosisPorToma = 0`) se excluye del cron en silencio** (D-C). La forma multiplicativa lo hace por construcción, que es lo que evita que tumbe la query entera — pero la fila queda invisible para siempre. La invariante de la entidad la hace inconstruible **vía `core-api`**, que es el único escritor con grants. Follow-up nombrado: un chequeo de integridad puntual, no una alerta diaria que nadie podría accionar.
- [ ] **`POST .../dosis` no es idempotente.** Doble tap en el móvil = doble decremento y dos logs. Ningún spec pide idempotencia; las mitigaciones disponibles (clave de idempotencia, o dedupe por `(consumption_id, tomado_at)`) quedan nombradas, no construidas.
- [ ] **El clamp de stock en 0 vive en el adaptador, no en la entidad** (D-H.2). Excepción consciente al patrón "la entidad valida"; el motivo es que la alternativa no es segura bajo concurrencia. Se testea a nivel de adaptador.
- [ ] **Seq scan diario de `user_consumption`** (D-C). Aceptado a escala de lanzamiento. Escotilla nombrada y gatillada por medición: columna generada `stored` + b-tree, o `findDueForCheck` con lote/cursor.
- [ ] **`UMBRAL_STOCK_BAJO_DIAS = 7` es un default declarado, no medido** (D-B). Lo no negociable es el razonamiento (≥ lead time de un refill), no el número.
- [ ] **Ninguna push llega a ningún dispositivo** (R7/D10/D-G). Consecuencia aceptada: no hay cliente móvil que pueda recibirla. Mitigado con un log explícito por cada envío omitido y con `PushTokenResolver` como capacidad faltante **nombrada** en vez de implícita.
- [ ] **Nada verifica que corra una sola réplica** (D-E). El CAS hace que N réplicas sean correctas, no gratis: se pagan N seq scans diarios. `CONSUMO_CRON_ENABLED` es la palanca, pero es disciplina de deploy, no un invariante del sistema.
- [ ] **El caveat de `process.env` en el decorador** (D-E): `@Cron`'s `disabled` se evalúa al cargar la clase, antes del contenedor de DI, así que lee `process.env` directo aunque la variable también esté declarada en `env.schema.ts`. Duplicación consciente: la declaración en el schema es lo que la hace validada y documentada.
