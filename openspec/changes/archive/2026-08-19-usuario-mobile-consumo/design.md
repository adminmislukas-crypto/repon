# Design: usuario-mobile-consumo

Builds on `proposal.md` (D1–D7 are locked and user-confirmed; not re-opened). Resolves **Q2** (route shapes), **Q3** (dose feedback), **Q4** (empty/first-run), **Q5** (owner tabs / multi-pet) and completes **Q1**'s unit-conversion half. `sdd-spec` owns behavioural scenarios; this document owns exact shapes and mechanisms.

> **Size note**: this artifact exceeds the usual 800-word design budget, same as the `mobile-auth-login` precedent and for the same reason — the orchestrator scoped five distinct undesigned surfaces here (3 new endpoints + ports + adapters, the per-`kind` mapping table, the `authFetch` convention, and four open questions). Content is compressed into tables rather than dropped.

## Technical Approach

Backend first. `ConsumoController` gains **three GET routes**; each is a pure query use case in domain Spanish that takes an actor-derived `userId` as its first parameter and reaches persistence through a new `findByUserId`-shaped port method. `diasRestantes` is attached server-side by calling the existing pure `domain/consumo.calculos.ts` functions (D7) — the formula is never re-derived, on either side of the wire. Adherence is computed entirely in the domain over a 7-day window (D6) and returned as finished values plus a per-day `estado` enum, so the client renders colours, never math.

On the client, every screen is a plain component: `const { authFetch } = useSession()`, one `useEffect` fetch keyed on a `version` counter, `useState` for results, `StyleSheet` for styling (D2). One shared JSON/error helper lands in `@repon/auth` **before** any screen (R4).

---

## Architecture Decisions

### D-1 (Q2): two separate collection resources, not one composite

**Choice**

| Route | Response | Notes |
|---|---|---|
| `GET /consumo/mis-mascotas` | `200 PetResponseDto[]` | Reuses the existing `PetResponseDto` verbatim (`dto/pet-response.dto.ts`) |
| `GET /consumo/mis-consumos` | `200 ConsumoListItemResponseDto[]` | `UserConsumptionResponseDto` + `diasRestantes` (D7) |
| `GET /consumo/mi-adherencia` | `200 AdherenciaResponseDto` | 7-day window (D6) |

**Alternatives considered** — one composite `GET /consumo/mi-resumen` returning `{ mascotas, consumos, adherencia }` in a single round-trip.

**Rationale**

1. **Refetch granularity is the decisive argument, and D-7 depends on it.** After `POST .../dosis` only consumptions and adherence changed; pets did not. A composite endpoint forces re-transferring the pet list on every single dose tick — the most frequent interaction in the app. Two resources let D-7 refetch exactly the two that moved.
2. **URL symmetry with the surface that already exists.** `POST /consumo/mis-mascotas` and `POST /consumo/mis-consumos` are already the two collection paths (`consumo.controller.ts:64,85`); adding the `GET` verb to each is zero new URL vocabulary. `mi-resumen` would be a fourth invented noun with no `POST` sibling and no precedent in the repo.
3. The one-round-trip saving is real but small: two index-backed single-table reads (`pets_user_id_idx`, `user_consumption_user_id_idx`, `20260803120200_02_consumo.sql:76-77`) issued **in parallel** from one `Promise.all` in one effect.
4. `authFetch` has no dedup/cache layer (D2), which cuts *against* the composite: with no cache, an over-broad payload is re-fetched in full every time, whereas with two resources the client controls what it re-asks for.

**Path-collision check** — `mi-adherencia` (2 segments) cannot shadow the existing `mis-consumos/:consumptionId/dias-restantes` (3 segments), and is deliberately **not** nested under `mis-consumos/` so no future `:consumptionId` route can ever shadow it. `mi-` follows the same D8 URL convention the controller's own header comment names (`consumo.controller.ts:45-51`, "`mis-` codifies D8 in the URL space, exactly like `mi-catalogo`").

**Consequence** — the `s-consumo` tab issues exactly two requests on mount (`mis-mascotas`, `mis-consumos`) and a third only when the user opens `s-consumo-historial`. Adherence is **not** fetched by the tab: the mockup's "adherencia esta semana" header banner (`mockups/usuario.html:368-381`) moves to `s-consumo-historial`, because paying for a third request on every tab open to render one percentage is not worth it. Stated so `sdd-tasks` does not re-add it.

---

### D-2 (D6): adherence response shape — per-day **and** per-item, server-computed

**Choice** — new types in `packages/types/src/consumo.ts`, mirrored 1:1 by response DTOs:

```ts
export type AdherenciaEstado = 'cumplido' | 'parcial' | 'incumplido' | 'sin_datos';

export interface AdherenciaDia {
  fecha: string;          // 'YYYY-MM-DD' in ZONA_HORARIA_ADHERENCIA
  esperadas: number;      // may be fractional when frecuenciaDias > 1
  tomadas: number;
  estado: AdherenciaEstado;
}

export interface AdherenciaItem {
  consumptionId: string;
  nombre: string;
  ownerType: OwnerType;
  petId?: string;
  kind: ConsumptionKind;
  esperadas: number;      // over the whole 7-day window
  tomadas: number;
  porcentaje: number;     // integer 0..100, clamped
  dias: AdherenciaDia[];  // exactly 7, oldest -> today
}

export interface AdherenciaSemanal {
  desde: string;          // 'YYYY-MM-DD' = today - 6
  hasta: string;          // 'YYYY-MM-DD' = today
  porcentaje: number;     // integer 0..100 across all items
  rachaDias: number;
  dias: AdherenciaDia[];  // exactly 7, aggregate across items
  items: AdherenciaItem[];
}
```

**Rationale / rules this pins**

| Point | Decision |
|---|---|
| Why `estado` and not just two numbers | D6 says the client re-derives nothing. A colour picked from a 4-value enum is rendering; `tomadas >= esperadas ? ok : no` is adherence math. The enum removes the ambiguity entirely |
| `esperadas` formula | New pure function `dosisEsperadasPorDia({ horarios, frecuenciaDias }) = horarios.length / frecuenciaDias`, added to `domain/consumo.calculos.ts` beside `consumoDiario` (which is the same quantity multiplied by `dosisPorToma`). Fractional for `frecuenciaDias > 1` and that is honest: `user_consumption` stores no schedule anchor, so "which calendar day is an on-day" is genuinely unknown |
| `estado` thresholds | `esperadas === 0` → `sin_datos`; `tomadas === 0 && esperadas > 0` → `incumplido`; `tomadas >= esperadas` → `cumplido`; otherwise `parcial`. Today's cell is computed identically — no special "in progress" value; the client styles the last cell as "hoy" positionally, exactly as the mockup does (`mockups/usuario.html:403`, `sd-today`) |
| `rachaDias` | Consecutive `cumplido` days counted backwards from **yesterday**, not today. Today is still in progress; counting it would reset every user's streak to 0 each morning |
| No month view | D6 forbids it. The mockup's "julio 2026 · 85%" header (`mockups/usuario.html:792`) is re-labelled to the 7-day window (`desde`–`hasta`). Called out so nobody restores it |
| No owner filter parameter | Items carry `ownerType`/`petId`; the client filters locally (D-9). A `?petId=` query param would be a client-supplied filter on a cross-tenant read — exactly what R5 forbids |
| Timezone | `ZONA_HORARIA_ADHERENCIA = 'America/Santiago'`, a new domain constant beside `UMBRAL_STOCK_BAJO_DIAS` in `domain/consumo.constants.ts`. Justified by the product's market, already visible in the data model (`refill_requests.comuna`) and in `usuario-mobile/SPEC.md:37` (Webpay). Day bucketing without a fixed zone silently shifts every boundary dose |

---

### D-3: exact port additions and their Kysely adapter shape

**Choice** — three additions, no removals.

```ts
// ports-out/pet-repository.port.ts
findByUserId(userId: string, tx?: TransactionContext): Promise<Pet[]>;

// ports-out/consumption-repository.port.ts
findByUserId(userId: string, tx?: TransactionContext): Promise<UserConsumption[]>;

// ports-out/consumption-log-repository.port.ts
export interface ConteoDiarioLog {
  readonly consumptionId: string;
  readonly fecha: string;   // 'YYYY-MM-DD' in `zonaHoraria`
  readonly tomadas: number;
}
contarTomasPorDia(
  consumptionIds: readonly string[],
  desde: Date,            // inclusive UTC instant
  hasta: Date,            // exclusive UTC instant
  zonaHoraria: string,
  tx?: TransactionContext,
): Promise<ConteoDiarioLog[]>;
```

**Adapter shape** — reuses the existing exported row mappers, never a second one:

```ts
// kysely-pet.repository.ts  (identical shape in kysely-consumption.repository.ts)
async findByUserId(userId: string, tx?: TransactionContext): Promise<Pet[]> {
  const rows = await this.executor(tx)
    .selectFrom('pets').selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(mapPetRow);
}
```

`mapPetRow` / `mapUserConsumptionRow` are already exported (`kysely-pet.repository.ts:20`, `kysely-consumption.repository.ts:30`) and are documented as **the one place** the `numeric`-as-`string` conversion happens. Adding a list-specific mapper would create a second place for that gotcha to be got wrong. `orderBy('created_at')` exists so the UI list order is stable across refetches; `created_at` is `Generated<string>` on both tables (`shared/database/schema.ts:167,185`).

**The log query — the one non-obvious piece:**

```ts
async contarTomasPorDia(consumptionIds, desde, hasta, zonaHoraria, tx) {
  if (consumptionIds.length === 0) return [];          // never emit `in ()`
  const rows = await this.executor(tx)
    .selectFrom('consumption_logs')
    .select((eb) => [
      'consumption_id',
      sql<string>`to_char((tomado_at at time zone ${zonaHoraria})::date, 'YYYY-MM-DD')`.as('fecha'),
      eb.fn.countAll<string>().as('tomadas'),
    ])
    .where('consumption_id', 'in', [...consumptionIds])
    .where('tomado_at', '>=', desde.toISOString())
    .where('tomado_at', '<', hasta.toISOString())
    .groupBy(['consumption_id', sql`(tomado_at at time zone ${zonaHoraria})::date`])
    .execute();
  return rows.map((r) => ({ consumptionId: r.consumption_id, fecha: r.fecha, tomadas: Number(r.tomadas) }));
}
```

- **`at time zone` appears only in `SELECT`/`GROUP BY`, never in `WHERE`.** Wrapping `tomado_at` in a function inside the predicate would disable `consumption_logs_consumption_id_tomado_at_idx` (`20260803120200_02_consumo.sql:78`) and turn this into a full scan. The window boundaries are pre-resolved to UTC instants by the caller for exactly this reason.
- **One query for all items, never one per item.** The `consumptionIds` array parameter is the whole reason this method exists rather than looping the existing `adherenciaUltimos7Dias` — an N+1 the D7 rationale already rejects for `diasRestantes`.
- `countAll<string>()` + `Number(...)` mirrors `adherenciaUltimos7Dias`'s existing handling (`kysely-consumption-log.repository.ts:68-72`).

**`adherenciaUltimos7Dias` is left in place, untouched.** It has no caller today (its own docblock says so, lines 47-63) and this design does not add one — it returns a raw count, not a percentage, and is superseded by `contarTomasPorDia`. Deleting it is an unrelated cleanup; a one-line "superseded by" note in its docblock is the whole change.

---

### D-4 (R5): cross-tenant safety on collections — structural, not a check

**Choice** — three mechanisms, all structural:

| Mechanism | Where |
|---|---|
| `userId` is a required first parameter on every new use case, supplied only from `actor.profileId` | `consumo.controller.ts`, same call shape as the existing four handlers |
| `user_id = $1` is **inside the SQL** of `findByUserId`, never a post-`filter()` in JS | `kysely-*.repository.ts` |
| The adherence read never accepts a `consumptionId` from the client at all | `CalcularAdherenciaSemanalUseCase` derives the id set from `ConsumptionRepository.findByUserId(userId)` first, then passes only those ids into `contarTomasPorDia`. A foreign id is unreachable, not rejected |

**No new DTO carries a `userId`, an `ownerType`, or a `petId` filter field**, so `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` 400s any attempt — the same property the existing write DTOs rely on (`nuevo-consumo.dto.ts:25-38`).

**Empty is `200 []`, never `404`.** The existing point-read 404 rule (`calcular-dias-restantes.use-case.ts:9-31`) exists to make "does not exist" and "belongs to someone else" byte-identical for a *known id*. A collection scoped by the actor has no id to probe and nothing to leak, and a 404 there would conflate "you own nothing" with "wrong URL". `AdherenciaResponseDto` for a user with nothing is a well-formed 7-day skeleton: `items: []`, `dias` = 7 entries of `sin_datos`, `porcentaje: 0`, `rachaDias: 0` — never `null`, so the client has no second empty-shape to handle.

**No new error class, no new `ConsumoExceptionFilter` row.** All three reads are total functions over the actor's own data.

---

### D-5: use-case names, DTOs and the `diasRestantes` attachment

| Use case (`ports-in/`) | Signature | Route |
|---|---|---|
| `ListarMascotasUseCase` | `execute(userId): Promise<Pet[]>` | `GET /consumo/mis-mascotas` |
| `ListarConsumosUseCase` | `execute(userId): Promise<UserConsumptionListItem[]>` | `GET /consumo/mis-consumos` |
| `CalcularAdherenciaSemanalUseCase` | `execute(userId, ahora?: Date): Promise<AdherenciaSemanal>` | `GET /consumo/mi-adherencia` |

`Listar*` matches the proposal's own wording; `Calcular*` matches the existing `CalcularDiasRestantesUseCase`. `ahora` is an injectable parameter (defaulting to `new Date()`) purely so the 7-day window is testable without fake timers.

**New DTO files** under `adapters/http/dto/`:

| File | Contents |
|---|---|
| `consumo-list-item-response.dto.ts` | `ConsumoListItemResponseDto extends UserConsumptionResponseDto { @ApiProperty() diasRestantes!: number }` |
| `adherencia-response.dto.ts` | `AdherenciaDiaDto`, `AdherenciaItemDto`, `AdherenciaResponseDto` (with `@ApiProperty({ type: [AdherenciaDiaDto] })` on the arrays, so Swagger emits real nested schemas) |

New mapper functions append to `consumo.mapper.ts` — `toConsumoListItemResponseDto`, `toAdherenciaResponseDto` — per that file's own stated convention ("this file is appended to, not one-mapper-per-file", `consumo.mapper.ts:10-18`). `ConsumoListItemResponseDto` extends the existing response DTO rather than redeclaring 11 fields.

**`diasRestantes` reuses the existing pure functions verbatim** (D7):

```ts
const cd = consumoDiario({ dosisPorToma, horarios, frecuenciaDias });
const dias = diasRestantes(stockActual, cd);
```

**Serialization guard, stated because it is a real hazard.** `consumoDiario` returns `0` for a degenerate row, and `Math.floor(x / 0)` is `Infinity`, which `JSON.stringify` emits as `null`. A `null` inside a 20-item list is worse than a wrong number. `toConsumoListItemResponseDto` therefore applies `Number.isFinite(dias) ? dias : 0` **at the mapper boundary** — a serialization guard, not a competing formula, so D7's "reuse, never re-derive" holds. The condition is unreachable in practice (`@Min(0.01)` + `@ArrayNotEmpty()` on the DTO, plus the entity's own `crear()` invariants); the existing point read shares the same theoretical hazard and is **not** modified here (out of scope: no behaviour change to the four existing routes).

Wiring: three providers appended to `consumo.module.ts`'s `providers` array; `exports: []` stays empty.

---

### D-6 (Q1/R1): the per-`kind` field → `NuevoConsumoDto` mapping table

Every payload is one flat `NuevoConsumoDto` (`dto/nuevo-consumo.dto.ts:39-87`). `ownerType` is fixed by the screen: `s-consumo-nuevo` → `'self'` (no `petId`), `s-consumo-nuevo-pet` → `'pet'` + the selected `petId`.

| DTO field | `medicamento` / `suplemento` (D5, same block) | `alimento` | `vacuna` |
|---|---|---|---|
| `nombre` | "medicamento" text input | "producto" text input | "producto" text input |
| `unidad` | presentación select → `'comprimido' \| 'cápsula' \| 'ml' \| 'gotas' \| 'parche'` | **always `'g'`** (see conversion below) | presentación select → `'pipeta' \| 'dosis'` |
| `dosisPorToma` | "dosis por toma" number, step 0.5, min 0.01 | **porción in grams, sent as-is** | number input, default 1, editable, min 0.01 |
| `frecuenciaDias` | "cada N días" select → `1 \| 2 \| 7` | `1` (fixed; a pet eats daily) | periodicidad select → mensual `30`, cada 3 meses `90`, anual `365` |
| `horarios` | "veces al día" (1/2/3) → that many `<input type="time">` rows | "veces al día" (1/2/3) → that many time rows | one `<input type="time">`, default `09:00`, visible and editable |
| `stockActual` | "stock actual" number (same unit as `unidad`) | **stock in kg × 1000 → grams** | number of pipettes/doses remaining |
| `autoCrearRefill` | "auto-crear refill" toggle | same toggle | same toggle |
| `petId` | selected pet (pet screen only) | selected pet | selected pet |

**`alimento` unit conversion — resolved: the wire is always grams.**

The mockup collects porción in **g** and stock in **kg** (`mockups/usuario.html:714,724`). Mixing them makes `diasRestantes` wrong by 1000×. The choice is which unit to normalise to, and the deciding evidence is the persistence format: `toUserConsumptionValues` writes `dosis_por_toma`/`stock_actual` with **`.toFixed(2)`** (`kysely-consumption.repository.ts:67,71`). In kilograms a 125 g portion becomes `0.13` after that rounding — a 4 % error that compounds into every days-remaining figure and every low-stock alert. In grams, `125.00` and `15000.00` are exact. **Grams wins on the two-decimal precision floor**, not on taste.

- Client sends `dosisPorToma: porcionG`, `stockActual: stockKg * 1000`, `unidad: 'g'`.
- **Display rule (presentation only, pinned here so it is not re-litigated):** when `unidad === 'g'` and the value is ≥ 1000, the UI renders kilograms with one decimal (`15000 → "15,0 kg"`), matching the mockup's "3,6 kg" stock bar (`mockups/usuario.html:57` area). The API never sees kilograms.
- Known cosmetic follow-up: `mensajeStockBajo` composes "…le quedan 3 días de g" (`consumo.calculos.ts:52-56`). Push notifications are out of scope for this change; the template is the defect, not the stored value.

**Mockup fields with no DTO home — dropped from v1, not silently sent.** `ValidationPipe`'s `forbidNonWhitelisted: true` turns any extra key into a **400**, so "send it anyway and let the server ignore it" is not an option.

| Mockup control | Verdict |
|---|---|
| `medicamento` frecuencia → **"días específicos" + L-M-X-J-V-S-D day picker** (`mockups/usuario.html:631-648`) | **Removed from v1.** `frecuencia_dias integer` + `horarios text[]` cannot express "Mon/Wed/Fri". Sending `frecuenciaDias: 2` as an approximation makes both `diasRestantes` and adherence `esperadas` wrong — unacceptable on health data. Replaced by "veces al día" + "cada N días". Weekday scheduling is a named follow-up change (needs a column) |
| horario **context** select ("en ayunas", "con desayuno", …) | Removed from v1 — no DTO field; it is a reminder label with no scheduling effect |
| toggle "notificación antes de la toma" | Removed — no DTO field, and push notifications are out of scope |
| toggle "alerta de stock bajo" | Removed — the cron's `findDueForCheck` has no per-item opt-out (`consumption-repository.port.ts:53-66`); a toggle that changes nothing is a lie to the user |
| toggle "auto-crear refill" | **Kept** → `autoCrearRefill`. The only one of the three that maps |
| `vacuna` "última aplicación" date (`mockups/usuario.html:746`) | Removed — no DTO field and no column. Sending it is a 400 |
| pet-`medicamento` "duración" select (indefinido / 5 días / 7 días) | Removed — no DTO field. Treatment end-date is a follow-up |

`suplemento` reuses the `medicamento` block unchanged (D5), differing only in `kind` and the presentación option list.

---

### D-7 (Q3/R7): refetch after `204`, with an explicit version counter

**Choice** — the client refetches; `POST .../dosis` is untouched.

```tsx
const [version, setVersion] = useState(0);
const [consumos, setConsumos] = useState<UserConsumptionListItem[] | null>(null);
const [errorCarga, setErrorCarga] = useState<string | null>(null);
const [marcando, setMarcando] = useState<string | null>(null);        // consumptionId in flight
const [errorDosis, setErrorDosis] = useState<Record<string, string>>({});

useEffect(() => {
  let cancelled = false;
  setErrorCarga(null);
  Promise.all([
    getJson<PetResponseDto[]>(authFetch, '/consumo/mis-mascotas'),
    getJson<UserConsumptionListItem[]>(authFetch, '/consumo/mis-consumos'),
  ])
    .then(([m, c]) => { if (!cancelled) { setMascotas(m); setConsumos(c); } })
    .catch((e) => { if (!cancelled) setErrorCarga(mensajeDeError(e)); });
  return () => { cancelled = true; };
}, [version, authFetch]);

async function marcar(id: string) {
  setMarcando(id);
  setErrorDosis((prev) => ({ ...prev, [id]: '' }));
  try {
    await postNoContent(authFetch, `/consumo/mis-consumos/${id}/dosis`, {});
    setVersion((v) => v + 1);                    // server truth, one refetch
  } catch (e) {
    setErrorDosis((prev) => ({ ...prev, [id]: mensajeDeError(e) }));
  } finally {
    setMarcando(null);
  }
}
```

**Alternatives considered**

| Option | Rejected because |
|---|---|
| Optimistic local decrement | `descontarStock` clamps at zero in SQL (`greatest(stock_actual - $2, 0)`, `kysely-consumption.repository.ts:252`), so a local subtraction drifts from server truth on every clamped item and never recovers without a refetch anyway. Health data — proposal R7 says prefer server truth |
| Change `POST .../dosis` to return the new stock | Out of scope (proposal: no behaviour change to the four existing routes) **and** insufficient: it would not refresh the 7-day streak bar, so a refetch would still be required |
| A shared cache with invalidation | D2 forbids TanStack Query; hand-rolling one for one screen is the dependency we declined, re-implemented worse |

**Rules this pins**

- The refetch re-issues **`mis-mascotas` + `mis-consumos`** (the effect's own `Promise.all`) but never `mi-adherencia` — that screen owns its own counter. D-1's split is what makes this scoping possible.
- **No optimistic flip.** The checkmark stays un-checked and shows a spinner while `marcando === id`; it turns checked only after the refetch returns a server row. Q6: failure is visible, with a manual retry (tap again); no queue, no silent success.
- The button is `disabled` while `marcando === id` — the server tolerates a double-tap (it decrements twice, correctly), but the user did not intend two doses.
- `let cancelled = false` cleanup mirrors the existing precedent in `session-context.tsx:50-60` — required, since a screen can unmount mid-flight.
- `version` is a plain counter, not the fetched data, so an unchanged response still re-renders the loading→loaded transition deterministically.

---

### D-8 (Q4): empty and first-run states, and reaching `s-consumo-nuevo-pet` with zero pets

**Choice** — four distinct states on `s-consumo`, plus a two-step create flow.

| State | What `s-consumo` renders |
|---|---|
| Loading | `ActivityIndicator` (the `login.tsx:94` precedent), never an empty list |
| Load failed | Spanish message from `mensajeDeError` + a "Reintentar" button that bumps `version`. **Never** rendered as "no tienes nada" — distinguishing empty from failed is mandatory |
| 0 pets **and** 0 consumptions (every brand-new signup) | **No owner tabs at all.** One first-run block: "Aún no registras consumos", with two CTAs — "Agregar para mí" → `/consumo-nuevo`, "Agregar una mascota" → `/consumo-nuevo-pet` |
| 0 pets, ≥1 self consumption | No owner tabs (one owner is not a choice); the self list plus an inline "Agregar una mascota" CTA |
| ≥1 pet | Owner tabs (D-9). A tab whose owner has no items renders its own per-owner empty state + "Agregar" CTA — not the global first-run block |

**`s-consumo-nuevo-pet` MUST be reachable with zero pets**, and it is: the CTA above routes to it directly. It is a **two-step flow**, because `NuevoConsumoDto.petId` requires a pet that already exists:

```
0 pets  →  step 1: pet form  → POST /consumo/mis-mascotas  → 201 PetResponseDto { id }
        →  step 2: consumo form (petId pre-filled) → POST /consumo/mis-consumos → 201
≥1 pet  →  step 1 collapses into a pet selector with a "+ nueva mascota" option
           that reveals the step-1 form inline; choosing an existing pet skips to step 2
```

**Partial-failure rule, pinned because it is a real hazard**: if step 1 succeeds and step 2 fails, **the pet exists and cannot be deleted** (D4: create-only, no delete endpoint). The screen MUST keep the user on step 2 with the newly-created pet selected and the error shown, and MUST NOT re-POST the pet on retry. Silently retrying both steps creates a duplicate pet on every retry.

`s-consumo-config` and `s-consumo-historial` stay reachable from the tab header icons in **every** state, including the zero state — a disabled icon is worse than an honest empty screen. Each renders its own empty copy. `s-consumo-config` additionally ships D4's honest treatment: the "editar" button is rendered **disabled with visible copy** ("edición disponible próximamente"), not hidden — hiding it makes the screen look finished when it is not (R2), and D4 forbids routing it into the create form.

---

### D-9 (Q5): one generic owner concept; tabs generated from the pets list

**Choice**

```ts
export type OwnerTab = { key: 'self' } | { key: 'pet'; petId: string };
```

One shared `<OwnerTabs>` component at `apps/usuario-mobile/components/consumo/owner-tabs.tsx`, consumed by all three owner-tabbed screens.

**Alternatives considered** — per-screen self/pet branching, as the mockup literally draws it with three near-identical functions `switchConsumo` / `switchConsumoConfig` / `switchConsumoHist` (`mockups/usuario.html:357-362, 780-785`).

**Rationale** — those three are triplicated DOM code for one concept, not three concepts. In React the differing part is the *content* of the selected panel, which is already a child; the tab strip itself is identical. One component means the N-pet behaviour is implemented once and can never drift between the three screens.

**Multi-pet UI — a horizontally scrollable tab strip, not a dropdown.**

| Pets | Rendering |
|---|---|
| 0 | Tab strip hidden entirely (D-8) |
| 1 | `[ Yo ] [ Rocky ]` — pixel-equivalent to the mockup, which only ever draws this case |
| N | `[ Yo ] [ Rocky ] [ Luna ] …` inside a `ScrollView horizontal` with `showsHorizontalScrollIndicator={false}` |

**Rationale for tabs over a dropdown** — the strip degrades correctly at both ends of the range (invisible at 0, mockup-identical at 1, scrolls at 5+) while a dropdown adds a modal interaction to the overwhelmingly common N ∈ {1, 2} case and hides from the user that other pets exist at all. Tab labels are `pet.nombre` from `GET /consumo/mis-mascotas`; no truncation logic beyond `numberOfLines={1}`.

**Filtering is local**, over the single `UserConsumptionListItem[]` response: `self` → `ownerType === 'self'`; a pet tab → `petId === tab.petId`. No per-owner endpoint and no `?ownerType=` parameter (R5, and D-4's "no client-supplied filters").

**Selection is screen-local `useState`, not shared or persisted.** `usuario-mobile/SPEC.md:42` already states this as the app's own contract ("Tab activo persona/mascota en Consumos — estado local de pantalla"). Navigating to config or historial starts on "Yo". Carrying it across screens would need a store, and D2 says no store.

---

### D-10 (R4): the `authFetch` JSON/error convention lives in `@repon/auth`

**Choice** — a new `packages/auth/src/api-json.ts`, exported from the barrel:

```ts
export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
/** The request never reached core-api (offline, DNS, TLS). Q6's visible-failure case needs its own class. */
export class NetworkError extends Error {
  readonly code = 'RED_NO_DISPONIBLE';
}

export type AuthFetch = AuthClient['authFetch'];

export function getJson<T>(authFetch: AuthFetch, path: string): Promise<T>;
export function postJson<T>(authFetch: AuthFetch, path: string, body: unknown): Promise<T>;
export function postNoContent(authFetch: AuthFetch, path: string, body?: unknown): Promise<void>;
```

**Alternatives considered** — (a) an app-level `apps/usuario-mobile/lib/api.ts`; (b) a new `@repon/api` package.

**Rationale**

1. **The gap it fills is documented in the file next door.** `api-client.ts:71`'s own contract says the caller owns `Content-Type`, `JSON.stringify`, the `response.ok` check, `.json()`, and the `{statusCode, code, message}` mapping. Fixing that one package away guarantees the two drift.
2. **Two apps, not one.** `proveedor-mobile` was scaffolded in the commit immediately before this change (`124a61a`) and already consumes `@repon/auth`. An app-level `lib/` would be copy-pasted into it within one change — the exact outcome `mobile-auth-login`'s D-7 fallback ladder refuses ("do not copy the code into both apps", design.md:319).
3. **`ApiError` is `SesionApiError`'s direct sibling.** `session-client.ts:6-15` already parses this identical envelope, with the identical `.catch(() => null)` fallback (`session-client.ts:36-43`). Two classes for one envelope in two packages *is* the divergence R4 warns about; keeping them adjacent makes a later merge trivial.
4. It imports no `react-native`, so it unit-tests under plain Jest `testEnvironment: node` — `mobile-auth-login` D-6's own testability rule for this package.

Rejected: (a) loses cross-app reuse and duplicates the envelope parser; (b) a third package for ~40 lines that would depend on `@repon/auth` for `authFetch` anyway.

**Behaviour pinned**

| Case | Result |
|---|---|
| POST body | Helper sets `Content-Type: application/json` and `JSON.stringify`s — the two things `authFetch` explicitly does not do |
| `!response.ok` | `await response.json().catch(() => null)`, then `throw new ApiError(status, body?.code ?? 'UNKNOWN_ERROR', body?.message ?? 'Unexpected error')` — verbatim the `session-client.ts:36-43` shape |
| `postNoContent` | Asserts `204` and returns `void`; **never** calls `.json()` (parsing an empty body throws) |
| `fetch` rejection | `NetworkError` — Q6's offline case must be distinguishable from a 4xx, not a generic `Error` |
| `authFetch`'s own `'authFetch called with no active session'` (`api-client.ts:56`) | Propagates untouched — a programming error under `RequireSession`, not a user-facing state |
| Retries / dedup / cache | **None.** D2 (no TanStack Query) and Q6 (no background queue). `authFetch`'s single 401 refresh-retry is the only retry in the stack |

**Error-code → Spanish message mapping lives in the app**, at `apps/usuario-mobile/lib/mensajes-error.ts`, mirroring `login.tsx:15-24`'s `ERROR_MESSAGES` record precedent. The split is deliberate: `@repon/auth` owns the wire envelope (protocol), the app owns the words (product copy, tone, locale).

```ts
const MENSAJES: Record<string, string> = {
  CONSUMPTION_NOT_FOUND: 'Ese consumo ya no existe. Actualiza la lista.',
  PET_NOT_FOUND: 'Esa mascota ya no existe. Vuelve a seleccionarla.',
  MASCOTA_INVALIDA: 'Revisa el nombre y la especie de la mascota.',
  CONSUMO_INVALIDO: 'Revisa los datos del consumo.',
  DOSIS_INVALIDA: 'No se puede registrar una dosis en el futuro.',
  RED_NO_DISPONIBLE: 'Sin conexión. Revisa tu red e intenta de nuevo.',
};
const POR_DEFECTO = 'Algo salió mal. Intenta de nuevo.';
export function mensajeDeError(error: unknown): string; // reads `.code` off ApiError | NetworkError | SesionApiError
```

These are exactly the five codes `ConsumoExceptionFilter` emits (`consumo-exception.filter.ts:37-43`), plus the network case. A `ValidationPipe` 400 carries no `code`, so it falls to `POR_DEFECTO`; the forms client-validate the same invariants (`@Min(0.01)`, non-empty `horarios`) so it is unreachable in practice. `mensajeDeError` accepts `SesionApiError` too, so `login.tsx` can adopt it later — merging the two records is a follow-up, not this change (no `@repon/auth`/login behaviour change is in scope).

---

## Data Flow

```
READS — s-consumo mount (and every `version` bump)
  ConsumosScreen  useEffect([version, authFetch])
    │
    ├─ getJson('/consumo/mis-mascotas')      ┐  Promise.all — parallel
    └─ getJson('/consumo/mis-consumos')      ┘
         │                                         (authFetch: proactive refresh, 1x 401 retry)
         ▼
    AuthGuard (APP_GUARD) → request.actor            [unchanged]
         ▼
    ConsumoController  @Actor() actor
         │  actor.profileId ─── the ONLY source of userId (D-4)
         ├─ ListarMascotasUseCase.execute(userId)
         │     └─ PetRepository.findByUserId(userId)
         │          SELECT * FROM pets WHERE user_id = $1 ORDER BY created_at
         │          → 200 PetResponseDto[]      (empty ⇒ 200 [], never 404)
         │
         └─ ListarConsumosUseCase.execute(userId)
               └─ ConsumptionRepository.findByUserId(userId)
                    SELECT * FROM user_consumption WHERE user_id = $1 ORDER BY created_at
               └─ per row, IN PROCESS, no extra query  (D7 — no N+1, no client formula):
                    consumoDiario({dosisPorToma, horarios, frecuenciaDias})   [consumo.calculos.ts:19]
                    diasRestantes(stockActual, cd)                            [consumo.calculos.ts:33]
                    mapper guard: Number.isFinite(d) ? d : 0                  [D-5]
                    → 200 ConsumoListItemResponseDto[]
         ▼
    useState → owner tabs (D-9, local filter) → today cards

READ — s-consumo-historial mount
    getJson('/consumo/mi-adherencia')
         ▼
    CalcularAdherenciaSemanalUseCase.execute(userId, ahora)
      1. ventanaAdherencia(ahora, 'America/Santiago')
             → 7 local dates (oldest→today) + desdeUtc / hastaUtc
      2. ConsumptionRepository.findByUserId(userId)      ← the id set, actor-scoped (D-4)
      3. ConsumptionLogRepository.contarTomasPorDia(ids, desdeUtc, hastaUtc, tz)
             ONE grouped query, index-backed on (consumption_id, tomado_at)
             `at time zone` only in SELECT/GROUP BY — never in WHERE (D-3)
      4. domain: dosisEsperadasPorDia() per item × 7 days
                 → estado per cell, porcentaje per item, aggregate, rachaDias
         ▼
    200 AdherenciaResponseDto  { desde, hasta, porcentaje, rachaDias, dias[7], items[] }
         ▼
    client renders colours from `estado` — zero adherence math (D6)

WRITE — mark a dose
    taken-btn  →  setMarcando(id)  →  postNoContent('/consumo/mis-consumos/{id}/dosis', {})
         ▼
    MarcarDosisTomadaUseCase   [unchanged: findById + append + descontarStock in one tx]
         ├─ 204 ──▶ setVersion(v+1) ──▶ READ effect re-runs (mascotas + consumos only)
         │                              ──▶ checkmark flips ONLY on the returned server row
         ├─ 404 / 400 ──▶ ApiError ──▶ errorDosis[id] = mensajeDeError(e)   row stays unchecked
         └─ fetch rejects ──▶ NetworkError ──▶ 'Sin conexión…' + manual retry  (Q6: no queue)

WRITE — create (s-consumo-nuevo / s-consumo-nuevo-pet)
    per-kind form (D-6 mapping table; alimento: kg × 1000 → g)
         │
         ├─ pet screen, 0 pets ─▶ postJson('/consumo/mis-mascotas', {nombre, especie, raza?, pesoKg?})
         │                          → 201 { id }  ── on step-2 failure this pet PERSISTS (D-8)
         ▼
    postJson('/consumo/mis-consumos', NuevoConsumoDto)
         ├─ 201 ──▶ router.back() to s-consumo, which refetches on focus
         ├─ 400 CONSUMO_INVALIDO / 404 PET_NOT_FOUND ──▶ inline Spanish message, form retained
         └─ any extra field ──▶ 400 from forbidNonWhitelisted  (why D-6 drops, never sends)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `services/core-api/src/domains/consumo/ports-out/pet-repository.port.ts` | Modify | `findByUserId` (D-3) |
| `.../ports-out/consumption-repository.port.ts` | Modify | `findByUserId` (D-3) |
| `.../ports-out/consumption-log-repository.port.ts` | Modify | `ConteoDiarioLog` + `contarTomasPorDia`; "superseded by" note on `adherenciaUltimos7Dias` (D-3) |
| `.../adapters/persistence/kysely-pet.repository.ts` | Modify | `findByUserId`, reusing `mapPetRow` |
| `.../adapters/persistence/kysely-consumption.repository.ts` | Modify | `findByUserId`, reusing `mapUserConsumptionRow` |
| `.../adapters/persistence/kysely-consumption-log.repository.ts` | Modify | `contarTomasPorDia` — grouped, index-preserving (D-3) |
| `.../domain/consumo.calculos.ts` | Modify | `dosisEsperadasPorDia`, `ventanaAdherencia`, `estadoAdherenciaDia`, `rachaDias` — all pure (D-2) |
| `.../domain/consumo.constants.ts` | Modify | `ZONA_HORARIA_ADHERENCIA = 'America/Santiago'` |
| `.../ports-in/listar-mascotas.use-case.ts` | Create | (D-5) |
| `.../ports-in/listar-consumos.use-case.ts` | Create | Attaches `diasRestantes` via the existing pure functions (D-5/D7) |
| `.../ports-in/calcular-adherencia-semanal.use-case.ts` | Create | (D-2/D-5) |
| `.../adapters/http/dto/consumo-list-item-response.dto.ts` | Create | `extends UserConsumptionResponseDto` + `diasRestantes` |
| `.../adapters/http/dto/adherencia-response.dto.ts` | Create | `AdherenciaDiaDto` / `AdherenciaItemDto` / `AdherenciaResponseDto` |
| `.../adapters/http/consumo.mapper.ts` | Modify | `toConsumoListItemResponseDto`, `toAdherenciaResponseDto` (append-only convention) |
| `.../adapters/http/consumo.controller.ts` | Modify | 3 `@Get` handlers + Swagger decorators; no new `@Roles()` |
| `.../consumo.module.ts` | Modify | Register the 3 use cases |
| `.../adapters/http/consumo-exception.filter.ts` | **Unchanged** | Listed explicitly: the 3 reads are total over the actor's own data (D-4) |
| `packages/types/src/consumo.ts` | Modify | `UserConsumptionListItem`, `AdherenciaEstado`, `AdherenciaDia`, `AdherenciaItem`, `AdherenciaSemanal` |
| `packages/auth/src/api-json.ts` | Create | `ApiError`, `NetworkError`, `getJson`/`postJson`/`postNoContent` (D-10) |
| `packages/auth/src/index.ts` | Modify | Barrel exports for the above |
| `apps/usuario-mobile/lib/mensajes-error.ts` | Create | Code → Spanish copy, `login.tsx` precedent (D-10) |
| `apps/usuario-mobile/components/consumo/owner-tabs.tsx` | Create | One generic owner strip, 3 consumers (D-9) |
| `apps/usuario-mobile/components/consumo/` (today-card, stock-bar, streak-bar, empty-state, error-retry) | Create | Shared presentational pieces |
| `apps/usuario-mobile/app/(tabs)/consumos.tsx` | Modify | Stub body → real tab (D-7/D-8/D-9) |
| `apps/usuario-mobile/app/consumo-{config,nuevo,nuevo-pet,historial}.tsx` | Modify | Stub bodies → real screens |
| `apps/usuario-mobile/SPEC.md` | Modify | Declared deltas: D2 state management, D4 no-edit, the stale "mutaciones reales contra Supabase" line (SPEC.md:43,55) |
| `openspec/specs/core-api-consumo/spec.md` | Modify | Collection-read requirements + the `200 []` rule |
| `supabase/`, `AuthGuard`, `@repon/auth` session code, the 4 existing routes | **None** | Untouched |

## Interfaces / Contracts

Beyond the signatures already given in D-2, D-3, D-5 and D-10, one new pure helper carries the calendar math out of the use case:

```ts
// domain/consumo.calculos.ts — pure, no I/O, no Date.now() inside
export interface VentanaAdherencia {
  readonly fechas: readonly string[];  // exactly 7 'YYYY-MM-DD', oldest -> today, in `zonaHoraria`
  readonly desdeUtc: Date;             // inclusive
  readonly hastaUtc: Date;             // exclusive
}
export function ventanaAdherencia(ahora: Date, zonaHoraria: string): VentanaAdherencia;
```

It exists so the timezone boundary is unit-testable without a database and so `contarTomasPorDia` receives plain UTC instants — which is what keeps the `WHERE` clause index-friendly (D-3).

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit (domain) | `dosisEsperadasPorDia`, `estadoAdherenciaDia`, `rachaDias`, `ventanaAdherencia` | Pure, table-driven, no mocks. Cover `frecuenciaDias > 1` (fractional `esperadas`), a DST boundary in `America/Santiago`, and that today is excluded from `rachaDias` |
| Unit (use case) | `ListarConsumosUseCase` | Mocked repo: `diasRestantes` matches `consumoDiario`+`diasRestantes` on the same input; a degenerate row serializes `0`, never `null`; **zero** extra repository calls per item (assert the mock's call count — this is D7's N+1 guarantee) |
| Unit (use case) | `CalcularAdherenciaSemanalUseCase` | Mocked repos: `dias.length === 7` always; a user with no consumptions gets a full `sin_datos` skeleton, not `[]`/`null`; `contarTomasPorDia` is called **once**; the id set passed to it is exactly the ids `findByUserId` returned |
| Unit (adapter) | The 3 new Kysely methods | Existing `kysely-*.repository.spec.ts` mock-builder pattern: assert `user_id = $1` is in the compiled SQL, that `contarTomasPorDia` short-circuits on an empty id array, and that `at time zone` appears in `select`/`group by` but **not** in `where` |
| e2e | Cross-tenant, one test per endpoint (success criterion) | supertest: user A's token against a world containing user B's pets/consumptions/logs returns only A's rows; a user with nothing gets `200 []` / the `sin_datos` skeleton, **never** `404`; a `?userId=`/`?petId=` query param changes nothing |
| Unit (`@repon/auth`) | `getJson`/`postJson`/`postNoContent` | Stubbed `authFetch`: `Content-Type` + stringified body are set; `!ok` throws `ApiError` with the parsed `code`; an unparseable error body falls back to `UNKNOWN_ERROR`; `postNoContent` never calls `.json()`; a `fetch` rejection becomes `NetworkError` |
| Component (RNTL) | `s-consumo` | Loading → loaded; zero-state renders both CTAs and **no** owner tabs; a load failure renders retry, not "no tienes nada"; N pets render N+1 tabs; local filtering by tab; mark-dose posts once, refetches, and flips only after the refetch; a failed mark leaves the row unchecked with a Spanish message and allows a retry |
| Component (RNTL) | `s-consumo-nuevo` / `s-consumo-nuevo-pet` | One assertion per `kind` that the emitted body is exactly a valid `NuevoConsumoDto` — including `alimento`'s kg→g conversion and that no dropped mockup field (day picker, context select, última aplicación, duración, the 2 dead toggles) appears in the payload; the step-1-ok/step-2-fail path does **not** re-POST the pet |
| Component (RNTL) | `s-consumo-config` | The "editar" control is disabled and never navigates to a create form (D4 success criterion) |

## Threat Matrix

N/A — this change adds three read-only HTTP routes inside an existing NestJS module and replaces five React Native screen stubs. It introduces no shell command, subprocess, git/VCS or PR automation, executable-file classification, or process-integration boundary. The matrix's five rows have no counterpart here. The applicable adversarial surface is cross-tenant data access on the new collection reads, which is covered structurally by D-4 and by one e2e test per endpoint.

## Migration / Rollout

No database migration. Both required indexes already exist (`20260803120200_02_consumo.sql:76-78`) and both tables already carry `user_id NOT NULL`. No new runtime dependency in either the API or the app. No environment variable. Rollout order is forced by the type dependency: `@repon/types` → core-api endpoints → `@repon/auth` helper → screens; `sdd-tasks` owns the PR chain (proposal R3 names the natural slices).

## Open Questions

- [x] **Q1** — resolved by D-6, including the `alimento` kg→g conversion and the seven mockup controls that have no DTO home.
- [x] **Q2** — resolved by D-1 (two collection resources + `mi-adherencia`) and D-2 (7-day shape).
- [x] **Q3** — resolved by D-7 (refetch on a `version` counter; no optimistic decrement, no endpoint change).
- [x] **Q4** — resolved by D-8 (four states; `s-consumo-nuevo-pet` reachable with zero pets via a two-step flow with a pinned partial-failure rule). `sdd-spec` still owns the Given/When/Then wording of each state.
- [x] **Q5** — resolved by D-9 (one `OwnerTab` concept, one shared component, a scrollable strip generated from the pets list).
- [ ] `AdherenciaDia.esperadas` is fractional whenever `frecuenciaDias > 1`, because `user_consumption` stores no schedule anchor. This is stated honestly rather than faked. Precise on-day scheduling needs a column and belongs to the same follow-up change as the weekday picker D-6 drops.
- [ ] `ZONA_HORARIA_ADHERENCIA` is a single hard-coded zone. Correct for a Chile-only launch; a user-level timezone is a follow-up and is purely additive (the port already takes `zonaHoraria` as a parameter, deliberately).
- [ ] `mensajeStockBajo` renders "…días de g" for `alimento` items (`consumo.calculos.ts:52-56`). Cosmetic, in the push-notification path, which is out of scope for this change.
