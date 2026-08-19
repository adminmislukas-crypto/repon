import type { AdherenciaEstado } from '@repon/types';

/**
 * Pure calculation functions for `consumo` (design.md Diagram 1, step 2a).
 * These are the SOLE authority for the formula: `ConsumptionRepository
 * .findDueForCheck`'s SQL predicate (D-C) is a strict SUPERSET of the
 * decision made here, never the decision itself. Zero I/O, zero repository
 * lookups — testable in complete isolation (Phase 2a).
 *
 * The adherence functions below (usuario-mobile-consumo design.md D-2) are
 * the same kind of pure authority for `CalcularAdherenciaSemanalUseCase`:
 * zero I/O, zero `Date.now()` calls inside (the caller always supplies
 * `ahora` explicitly), so the 7-day window and its timezone boundary are
 * unit-testable without a database or fake timers on the system clock.
 */

export interface ConsumoDiarioInput {
  dosisPorToma: number;
  horarios: readonly string[];
  frecuenciaDias: number;
}

/**
 * `dosisPorToma * horarios.length / frecuenciaDias` (design.md Diagram 1,
 * step 2a, verbatim). Units of the item consumed per day.
 */
export function consumoDiario(input: ConsumoDiarioInput): number {
  return (input.dosisPorToma * input.horarios.length) / input.frecuenciaDias;
}

/**
 * `Math.floor(stockActual / consumoDiario)` (design.md Diagram 1, step 2a,
 * verbatim). `Math.floor`, never `Math.round`/`Math.ceil`: a partial day of
 * stock does not count as a full day remaining. This is exactly why D-C's
 * SQL predicate carries a `+1` margin instead of relying on `< umbralDias`
 * alone — Postgres `numeric` division and JS `float64` division are not
 * guaranteed to agree bit-for-bit at the boundary, and this function itself
 * makes no attempt to compensate for that: it is the single source of
 * truth for the JS side, the predicate is the superset guard.
 */
export function diasRestantes(stockActual: number, consumoDiarioValor: number): number {
  return Math.floor(stockActual / consumoDiarioValor);
}

export interface MensajeStockBajoInput {
  nombre: string;
  diasRestantes: number;
  unidad: string | null;
}

/**
 * Composes the push message body (design.md D-G, Diagram 1 step 2g:
 * `sendPush(userId, mensajeStockBajo(...))`). Pure — takes only the fields
 * `consumo` already owns on the entity/event payload (D-D). Deliberately
 * does NOT accept a pet lookup: resolving the pet's name would require a
 * per-item lookup inside the cron's loop (N+1), which D-D explicitly
 * rejects. `nombre` here is the CONSUMPTION's own `nombre` field, never the
 * pet's.
 */
export function mensajeStockBajo(input: MensajeStockBajoInput): string {
  const dias = input.diasRestantes === 1 ? '1 día' : `${input.diasRestantes} días`;
  const conUnidad = input.unidad ? ` de ${input.unidad}` : '';
  return `Stock bajo: a ${input.nombre} le quedan ${dias}${conUnidad}.`;
}

export interface DosisEsperadasInput {
  horarios: readonly string[];
  frecuenciaDias: number;
}

/**
 * usuario-mobile-consumo design.md D-2, verbatim: `horarios.length /
 * frecuenciaDias`. Deliberately fractional when `frecuenciaDias > 1` —
 * `user_consumption` stores no schedule anchor, so "which calendar day is
 * an on-day" is genuinely unknown. Stated honestly here rather than
 * approximated; the caller (per-day adherence) compares this against a
 * whole-number `tomadas` count via `estadoAdherenciaDia`, which handles
 * the fractional case without needing to round it first.
 */
export function dosisEsperadasPorDia(input: DosisEsperadasInput): number {
  return input.horarios.length / input.frecuenciaDias;
}

/**
 * usuario-mobile-consumo design.md D-2, exact thresholds. `esperadas === 0`
 * is `sin_datos` (no schedule to compare against) — checked BEFORE the
 * `tomadas === 0` branch, since a genuinely nothing-expected day must never
 * read as "incumplido" (nothing was missed). A colour picked from this
 * 4-value enum is rendering; `tomadas >= esperadas` is the only comparison
 * this domain ever makes — no client re-derives it (D6).
 */
export function estadoAdherenciaDia(esperadas: number, tomadas: number): AdherenciaEstado {
  if (esperadas === 0) return 'sin_datos';
  if (tomadas === 0) return 'incumplido';
  if (tomadas >= esperadas) return 'cumplido';
  return 'parcial';
}

/**
 * usuario-mobile-consumo design.md D-2: consecutive `'cumplido'` days
 * counted BACKWARDS FROM YESTERDAY, not today — today is still in
 * progress, so including it would reset every user's streak to 0 each
 * morning before they've had a chance to mark anything. `dias` is the
 * oldest-to-today ordering `ventanaAdherencia`/`AdherenciaDia[]` use
 * throughout this change, so "yesterday" is `dias[dias.length - 2]` and the
 * scan runs backwards from there, stopping at the first non-`'cumplido'`
 * day (or the start of the window).
 */
export function rachaDias(dias: readonly AdherenciaEstado[]): number {
  let racha = 0;
  for (let i = dias.length - 2; i >= 0; i--) {
    if (dias[i] !== 'cumplido') break;
    racha++;
  }
  return racha;
}

export interface VentanaAdherencia {
  /** Exactly 7 entries, 'YYYY-MM-DD', oldest -> today, in `zonaHoraria`. */
  readonly fechas: readonly string[];
  /** Inclusive UTC instant — local midnight of `fechas[0]`. */
  readonly desdeUtc: Date;
  /** Exclusive UTC instant — local midnight of the day AFTER today. */
  readonly hastaUtc: Date;
}

function formatoPartes(instante: Date, zonaHoraria: string): Record<string, string> {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);
  const mapa: Record<string, string> = {};
  for (const parte of partes) mapa[parte.type] = parte.value;
  return mapa;
}

function fechaLocal(instante: Date, zonaHoraria: string): string {
  const p = formatoPartes(instante, zonaHoraria);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Pure calendar arithmetic on a 'YYYY-MM-DD' string — never crosses a real
 * timezone boundary, so anchoring at UTC midnight for the add/subtract is
 * safe regardless of `zonaHoraria`. */
function sumarDias(fecha: string, delta: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const base = Date.UTC(anio, mes - 1, dia);
  const desplazado = new Date(base + delta * 24 * 60 * 60 * 1000);
  return desplazado.toISOString().slice(0, 10);
}

/**
 * Converges the UTC instant that reads as local midnight of `fecha` in
 * `zonaHoraria` — the standard two-pass technique (format a guess in the
 * zone, measure its offset from UTC, correct, repeat once more). Two passes
 * is enough for any real DST transition; a fixed-offset shortcut would
 * silently misplace every boundary dose around a DST change, exactly the
 * risk design.md D-2 flags for this timezone.
 */
function medianocheLocalUtc(fecha: string, zonaHoraria: string): Date {
  const objetivoComoUtcMs = Date.parse(`${fecha}T00:00:00.000Z`);
  let instanteMs = objetivoComoUtcMs;
  for (let i = 0; i < 2; i++) {
    const p = formatoPartes(new Date(instanteMs), zonaHoraria);
    const leidoComoUtcMs = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    const offsetMs = leidoComoUtcMs - instanteMs;
    instanteMs = objetivoComoUtcMs - offsetMs;
  }
  return new Date(instanteMs);
}

/**
 * usuario-mobile-consumo design.md D-2/D-3, Interfaces/Contracts. Pure — no
 * I/O, no `Date.now()` inside; the caller always supplies `ahora`
 * explicitly. Exists so the timezone boundary is unit-testable without a
 * database and so `contarTomasPorDia` receives plain UTC instants, which is
 * what keeps its `WHERE` clause index-friendly (D-3).
 */
export function ventanaAdherencia(ahora: Date, zonaHoraria: string): VentanaAdherencia {
  const hoy = fechaLocal(ahora, zonaHoraria);
  const fechas: string[] = [];
  for (let i = 6; i >= 0; i--) {
    fechas.push(sumarDias(hoy, -i));
  }
  const manana = sumarDias(hoy, 1);
  return {
    fechas,
    desdeUtc: medianocheLocalUtc(fechas[0]!, zonaHoraria),
    hastaUtc: medianocheLocalUtc(manana, zonaHoraria),
  };
}
