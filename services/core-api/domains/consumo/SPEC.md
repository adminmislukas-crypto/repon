# Dominio: Consumo

Configuración de dosis y porciones (persona o mascota), registro de tomas, cálculo de stock restante y disparo de alertas o refills automáticos.

## Entidades que posee

- `Pet`
- `UserConsumption` (dosis, frecuencia, horarios, stock actual — `ownerType`: `self` | `pet`)
- `ConsumptionLog` (cada toma/porción registrada, usada para adherencia y racha)

## Puertos de entrada (casos de uso)

```ts
interface ConsumoInboundPort {
  registrarMascota(userId: string, datos: NuevaMascotaInput): Promise<Pet>
  configurarConsumo(userId: string, config: NuevoConsumoInput): Promise<UserConsumption>
  marcarDosisTomada(userId: string, consumptionId: string, tomadoAtRaw?: string): Promise<void>
  calcularDiasRestantes(userId: string, consumptionId: string): Promise<number>
}
```

**Delta `backend-core-api-consumo` (D2/D7/D8)** — 3 correcciones frente a la versión original de este SPEC.md:

- **`marcarDosisTomada` y `calcularDiasRestantes` ganan `userId`** (ninguno lo tenía). Sin él, cualquier usuario autenticado podía leer o mutar el consumo de otro adivinando `consumptionId`. Ambos casos de uso verifican `entity.userId === userId` antes de actuar; si no coincide (o el `consumptionId` no existe), responden **404** — nunca 403, mismo razonamiento que `actualizarPrecio` de `catalogo` (D7 de ese cambio) aplicado acá por primera vez sobre datos de salud.
- **`calcularDiasRestantes` deja de estar "usada también por el cron"** (D2, separación CQS). El chequeo diario de umbral, la emisión de eventos y el push viven en un caso de uso interno separado, `procesarConsumosVencidos` — ver "Job programado" más abajo. `CalcularDiasRestantesUseCase` sigue siendo una query pura, HTTP-alcanzable: su constructor **no** inyecta `EVENT_PUBLISHER` ni `NOTIFICATION_PORT` — garantía estructural, verificable por inspección del constructor, no solo por convención.
- **`marcarDosisTomada` gana `tomadoAtRaw?: string` (ISO-8601 opcional) en vez de un `timestamp: Date` obligatorio.** Ausente → se usa el `now()` del servidor en el momento de ejecución. Presente y más allá de una tolerancia de clock-skew de 1 minuto → `DosisInvalidaError` (400). `userId` en los 4 casos de uso sigue derivándose exclusivamente de `actor.profileId` (D8) — ningún DTO HTTP expone un campo `userId`.

### `configurarConsumo` verifica la propiedad de `petId` (D-H.3, aplicación de D7)

Cuando `config.petId` está presente (`ownerType: 'pet'`), el caso de uso busca el `Pet` por id vía `PetRepository.findById` y verifica `pet.userId === userId` **antes** de crear el `UserConsumption`. Si el `Pet` no existe o pertenece a otro usuario, lanza `PetNotFoundError` (404, nunca 403) y no crea nada — byte a byte idéntica a la rama "no existe", la misma regla D7 aplicada a la única FK que el cliente elige.

`configurarConsumo` es **create-only**: recibe `NuevoConsumoInput` (sin `consumptionId`) y siempre genera un `UserConsumption` nuevo vía `randomUUID()`. No existe, en este cambio, ningún caso de uso que reconfigure un `UserConsumption` ya existente — ver la nota bajo "Job programado" sobre la consecuencia de esto en el marcador de debounce.

## Puertos de salida

```ts
interface ConsumptionRepository {
  save(item: UserConsumption, tx?: TransactionContext): Promise<void>
  findById(consumptionId: string, tx?: TransactionContext): Promise<UserConsumption | null>
  findDueForCheck(umbralDias: number, tx?: TransactionContext): Promise<ConsumptionCandidata[]>   // usado por el cron diario
  intentarMarcarStockBajo(consumptionId: string, notificadoAt: Date, tx?: TransactionContext): Promise<boolean>
  limpiarMarcaStockBajo(consumptionId: string, tx?: TransactionContext): Promise<void>
  descontarStock(consumptionId: string, cantidad: number, tx?: TransactionContext): Promise<number>
}
interface PetRepository {
  save(pet: Pet, tx?: TransactionContext): Promise<void>
  findById(petId: string, tx?: TransactionContext): Promise<Pet | null>
}
interface ConsumptionLogRepository {
  append(log: ConsumptionLog, tx?: TransactionContext): Promise<void>
  adherenciaUltimos7Dias(consumptionId: string): Promise<number>
}
```

**Delta `backend-core-api-consumo`** — `ConsumptionRepository` cambia frente a la versión original de este SPEC.md, que solo listaba `save`/`findDueForCheck`:

- Todo método gana un `tx?: TransactionContext` final opcional (convención repo-wide, mismo patrón que `identidad`/`catalogo`), para que `marcarDosisTomada` pueda correr su lectura de propiedad y sus 2 escrituras dentro de la misma transacción (D6).
- **`findById`** (nuevo): sostiene el chequeo de propiedad cross-tenant de D7 sobre `marcarDosisTomada`/`calcularDiasRestantes` — `null` y "encontrado pero ajeno" resuelven al mismo `ConsumptionNotFoundError`, byte a byte idéntico.
- **`findDueForCheck` cambia de `(): Promise<UserConsumption[]>` a `(umbralDias: number, tx?): Promise<ConsumptionCandidata[]>`** (D-A/D-C/D-H.2). Gana un parámetro — el umbral viaja como argumento en vez de estar hardcodeado en el adaptador (ver "Constante de dominio" más abajo, D-B) — y **devuelve candidatas, no ítems ya confirmados bajo umbral**: el predicado SQL detrás es un superconjunto estricto ("puede disparar" **o** "puede limpiarse"), nunca la decisión final. La única autoridad de la fórmula es la función pura `domain/consumo.calculos.ts`, que el caller ejecuta sobre cada candidata devuelta. `ConsumptionCandidata` es `UserConsumption` + `stockBajoNotificadoAt: string | null` — un tipo que vive únicamente en `ports-out/consumption-repository.port.ts`, deliberadamente **no** agregado a `@repon/types.UserConsumption`: es bookkeeping interno de `consumo` (D-A: "ningún otro dominio lo lee ni lo escribe"), nunca un hecho que un cliente o otro dominio necesite ver — coherente con `exports: []` del módulo.
- **`intentarMarcarStockBajo`/`limpiarMarcaStockBajo`** (nuevos): el compare-and-set que hace seguro el marcador de debounce (D-A) bajo concurrencia y entre corridas del cron, en una sola sentencia (`UPDATE ... WHERE stock_bajo_notificado_at IS NULL RETURNING id`). `true` = esta llamada ganó la carrera y debe emitir; `false` = ya reclamado, no debe emitir. Nunca lectura-luego-escritura.
- **`descontarStock`** (nuevo, D-H.2): decremento atómico de `stockActual` (`greatest(stock_actual - cantidad, 0)`, `RETURNING stock_actual`) — inmune a lost-update bajo dosis concurrentes (doble tap, dos dispositivos), lo que un `save()` ingenuo (leer, restar, guardar) no sería. Clampea en 0 en el **adaptador**, nunca en la entidad — excepción consciente al patrón "la entidad valida" que `catalogo` fijó: expresar la invariante en la entidad exige un read-modify-write que no es seguro bajo concurrencia. `marcarDosisTomada` usa `descontarStock` exclusivamente; `save()` queda usado solo por `configurarConsumo`.

`PetRepository` es un puerto **nuevo** (D-H.1). `registrarMascota(userId, datos): Promise<Pet>` ya estaba declarado en este SPEC.md, pero su bloque "Puertos de salida" no listaba ninguna forma de persistir un `Pet` — vacío que ninguna pregunta abierta de la proposal nombró; apareció al mapear los casos de uso contra los puertos existentes durante `sdd-design`. Se mantiene separado de `ConsumptionRepository` a propósito: mezclar `save`/`findById` de `Pet` en esa interfaz la haría mentir sobre su nombre y acoplaría la persistencia de dos agregados con tablas distintas (`pets` / `user_consumption`). `findById` existe para el chequeo de propiedad de `configurarConsumo` (D-H.3, arriba).

`NotificationPort`/`EventPublisher` — **corrección**: la versión original de este SPEC.md los listaba bajo "Puertos de salida" como si `consumo` los declarara. No es así: ambos son puertos del **shared kernel** (`shared/notifications/notification.port.ts`, `shared/event-bus/event-publisher.port.ts` respectivamente) — `consumo` los **consume** (los inyecta vía `NOTIFICATION_PORT`/`EVENT_PUBLISHER`), nunca los declara ni los implementa, y no forman parte de la interfaz de puertos de salida propia del dominio de arriba. `consumo` es el primer caller real de `NOTIFICATION_PORT` (antes el kernel solo declaraba el token sin bindear un provider; ver `shared-notifications` capability spec) — `consumo.module.ts` no bindea ni exporta ninguno de los dos (`exports: []`).

## Constante de dominio: `UMBRAL_STOCK_BAJO_DIAS` (D-B)

El "umbral configurado" que la sección "Job programado" referencia es `UMBRAL_STOCK_BAJO_DIAS = 7` (`domain/consumo.constants.ts`) — una constante de dominio, igual para todos los usuarios, no una columna ni una variable de entorno. Es un default de producto declarado, no medido: el razonamiento no negociable es que debe ser ≥ el lead time realista de un refill; el número en sí puede ajustarse. La ruta a "umbral por usuario" o "umbral por `kind`" queda abierta y es puramente aditiva — ninguna de las dos requiere que esta constante desaparezca, solo que deje de ser la única fuente (ver "Riesgos residuales" en `apply-progress.md`).

## Job programado (cron diario, dentro del mismo dominio)

**Corrección declarada frente a la prosa original de esta sección**: el chequeo diario no lo ejecuta `calcularDiasRestantes` directamente. Lo ejecuta `ProcesarConsumosVencidosUseCase` — un caso de uso interno, **nunca HTTP-alcanzable y sin `@Roles()` en ninguna parte** (separación CQS, D2) — invocado por `ConsumptionCheckJob` (`adapters/scheduling/consumption-check.job.ts`), un `@Cron('0 9 * * *', { timeZone: 'America/Santiago' })` deliberadamente delgado: una sola llamada a `execute()`, cero lógica propia. El flag de entorno `CONSUMO_CRON_ENABLED` (`env.schema.ts`, default `'true'`) es el kill-switch operativo por instancia.

Cada corrida llama `findDueForCheck(UMBRAL_STOCK_BAJO_DIAS)` (ver "Puertos de salida") y procesa cada candidata de forma independiente, dentro de su propio `try/catch` — el fallo de un ítem se loguea y el resto continúa procesándose (D4, ningún `TRANSACTION_MANAGER` inyectado). Por candidata: si `diasRestantes >= umbral` y el marcador de debounce sigue abierto, lo limpia (`limpiarMarcaStockBajo`) sin emitir nada; si `diasRestantes < umbral`, intenta reclamar el marcador (`intentarMarcarStockBajo`, compare-and-set) **antes** de emitir (reclamo-antes-que-emisión, D-E) — si pierde la carrera (ya reclamado por la corrida de ayer, D5, u otra réplica concurrente), no emite. Si gana, dispara `StockBajoDetectado` y, si el usuario activó `autoCrearRefill`, también `RefillAutoSolicitado` — uno por ítem, nunca un resumen del día (D3) — y en ambos casos intenta un push best-effort vía `NOTIFICATION_PORT` (nunca lanza, D10).

**Corrección declarada — la prosa original decía "`calcularDiasRestantes` corre para cada `UserConsumption` activo"**: `user_consumption` **no tiene ninguna columna `activo`/`status`** — no existe forma de pausar un ítem en este cambio (decisión de producto no tomada, no una omisión de implementación). El cron procesa **toda candidata que `findDueForCheck` devuelva**, sin ninguna noción de "ítem activo" distinta de cualquier otro ítem existente (ver `db-schema-consumo`, misma aclaración a nivel de esquema).

**Delta declarado, no resuelto en este cambio — el marcador de debounce y `configurarConsumo`**: `design.md` (tabla "Qué limpia el marcador") documenta que `configurarConsumo` debería limpiar el marcador de debounce "al reconfigurar el ítem" (un ítem reconfigurado es, para esa decisión, un contexto de alerta nuevo). Pero `configurarConsumo`, tal como quedó especificado e implementado arriba, es **create-only** (`NuevoConsumoInput`, sin parámetro `consumptionId`) — no existe, en este cambio, ningún camino de código que "reconfigure" un `UserConsumption` existente. Esa limpieza del marcador es en consecuencia **inalcanzable**, no un olvido de implementación: no hay ningún caller que pueda ejercitarla. Queda nombrado como seguimiento explícito para el cambio futuro que agregue una capacidad de actualizar/reconfigurar un `UserConsumption` existente — construir ese endpoint está fuera del alcance de `backend-core-api-consumo` (no es parte de los 10 PR aprobados de este cambio).

## Eventos que publica

- `StockBajoDetectado` — payload `StockBajoPayload` (ver abajo)
- `RefillAutoSolicitado` — mismo payload que `StockBajoDetectado`, publicado solo si `autoCrearRefill === true`; lo escucha `refill-matching` para crear la solicitud sin intervención del usuario
- `DosisRegistrada` — `{ consumptionId, userId, tomadoAt, cantidad, stockRestante }`, publicado por `marcarDosisTomada` únicamente **después** de que su transacción hace commit (D6)

**Delta `backend-core-api-consumo` (D-D)** — payload exacto de `StockBajoDetectado`/`RefillAutoSolicitado` (`events/stock-bajo.payload.ts`):

```ts
interface StockBajoPayload {
  consumptionId: string
  userId: string
  ownerType: OwnerType
  petId: string | null       // presente solo si ownerType === 'pet'; el NOMBRE de la mascota no viaja (evitaría un lookup por ítem dentro del loop del cron, N+1)
  kind: ConsumptionKind
  nombre: string
  unidad: string | null
  stockActual: number
  consumoDiario: number      // salida de la fórmula, nunca sus insumos
  diasRestantes: number
  umbralDias: number
}
```

Regla que gobierna los 3 eventos (D-D): `consumo` publica únicamente hechos que posee, en su propio vocabulario — nunca el enum ni la interpretación de otro dominio (no hay `urgencia`, vocabulario de `refill-matching`) — y cuando un campo es la salida de una fórmula que `consumo` posee, publica la SALIDA (`consumoDiario`), nunca sus insumos (`dosisPorToma`/`frecuenciaDias`/`horarios`), para que ningún consumidor tenga que reimplementar `domain/consumo.calculos.ts` y termine derivando con el tiempo. En `DosisRegistrada`, `cantidad` es siempre `dosisPorToma` (el cliente nunca envía una cantidad) y `stockRestante` es el valor `RETURNING` de `descontarStock` — el valor ya clampeado en 0, nunca recalculado desde `stockActual - cantidad`, que podría desviarse silenciosamente del valor real bajo concurrencia.

## Eventos que consume

Ninguno. `Consumo` reacciona a su propio cron, no a eventos de otros dominios.

## Al extraer como microservicio independiente

Es el dominio con el job programado más pesado (recorre a diario toda candidata que `findDueForCheck` devuelva). Si el volumen de usuarios crece, es el primer candidato a separar solo para no competir por recursos con las peticiones síncronas de los demás dominios durante la ventana del cron.
