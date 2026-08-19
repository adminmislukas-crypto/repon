import {
  consumoDiario,
  diasRestantes,
  dosisEsperadasPorDia,
  estadoAdherenciaDia,
  mensajeStockBajo,
  rachaDias,
  ventanaAdherencia,
} from './consumo.calculos';

// design.md Diagram 1, step 2a: `consumoDiario = dosisPorToma *
// horarios.length / frecuenciaDias`, verbatim.
describe('consumoDiario', () => {
  it('multiplies dosisPorToma by the number of horarios when frecuenciaDias is 1 (daily)', () => {
    const resultado = consumoDiario({
      dosisPorToma: 2,
      horarios: ['08:00', '20:00'],
      frecuenciaDias: 1,
    });

    expect(resultado).toBe(4);
  });

  // Edge case named in tasks.md 2a.5: frecuenciaDias > 1 (not a daily item).
  it('divides by frecuenciaDias when the item is taken every N days (frecuenciaDias > 1)', () => {
    const resultado = consumoDiario({
      dosisPorToma: 2,
      horarios: ['08:00', '20:00'],
      frecuenciaDias: 2,
    });

    expect(resultado).toBe(2);
  });

  it('counts each entry in horarios once, regardless of dosisPorToma', () => {
    const resultado = consumoDiario({
      dosisPorToma: 1,
      horarios: ['08:00', '14:00', '20:00'],
      frecuenciaDias: 1,
    });

    expect(resultado).toBe(3);
  });
});

// design.md Diagram 1, step 2a: `diasRestantes =
// Math.floor(stockActual / consumoDiario)`, verbatim. `Math.floor`, never
// `Math.round`/`Math.ceil` (design.md: a partial day of stock does not
// count as a full day remaining).
describe('diasRestantes', () => {
  // Edge case named in tasks.md 2a.5: stock = 0.
  it('returns 0 when stockActual is 0, regardless of consumoDiario', () => {
    expect(diasRestantes(0, 4)).toBe(0);
  });

  // Edge case named in tasks.md 2a.5: exactly at the threshold — an exact,
  // non-floating-point-drift division must floor to precisely that integer,
  // never one below it.
  it('returns exactly 7 when stockActual / consumoDiario divides evenly to 7', () => {
    expect(diasRestantes(14, 2)).toBe(7);
  });

  it('floors down a non-exact division instead of rounding', () => {
    expect(diasRestantes(10, 3)).toBe(3);
  });

  it('never returns a negative number for a positive consumoDiario and non-negative stock', () => {
    expect(diasRestantes(1, 4)).toBe(0);
  });
});

// design.md D-D / D-G, Diagram 1 step 2g: pure — no repository lookups, no
// pet name (that would be a per-item lookup inside the cron's loop, an N+1
// D-D explicitly rejects). Takes only the fields `consumo` already owns.
describe('mensajeStockBajo', () => {
  it('composes a message naming the item and the days remaining', () => {
    const mensaje = mensajeStockBajo({ nombre: 'Amoxicilina', diasRestantes: 3, unidad: null });

    expect(mensaje).toContain('Amoxicilina');
    expect(mensaje).toContain('3');
  });

  it('pluralizes correctly for exactly 1 day remaining', () => {
    const mensaje = mensajeStockBajo({ nombre: 'Alimento', diasRestantes: 1, unidad: null });

    expect(mensaje).toContain('1 día');
    expect(mensaje).not.toContain('1 días');
  });

  it('includes unidad when present', () => {
    const mensaje = mensajeStockBajo({ nombre: 'Alimento', diasRestantes: 5, unidad: 'kg' });

    expect(mensaje).toContain('kg');
  });

  it('takes no repository or lookup parameters — only the plain fields it needs (N+1 avoidance, D-D)', () => {
    expect(mensajeStockBajo.length).toBe(1);
  });
});

// usuario-mobile-consumo design.md D-2: `horarios.length / frecuenciaDias`,
// verbatim — deliberately fractional when frecuenciaDias > 1.
describe('dosisEsperadasPorDia', () => {
  it('equals horarios.length when frecuenciaDias is 1 (daily)', () => {
    expect(dosisEsperadasPorDia({ horarios: ['08:00', '20:00'], frecuenciaDias: 1 })).toBe(2);
  });

  it('is fractional when frecuenciaDias > 1 — stated honestly, not rounded', () => {
    expect(dosisEsperadasPorDia({ horarios: ['08:00'], frecuenciaDias: 3 })).toBeCloseTo(1 / 3);
  });

  it('is 0 when horarios is empty, regardless of frecuenciaDias', () => {
    expect(dosisEsperadasPorDia({ horarios: [], frecuenciaDias: 1 })).toBe(0);
  });
});

// usuario-mobile-consumo design.md D-2, exact thresholds — a colour picked
// from this enum is rendering, `tomadas >= esperadas` is the only adherence
// math this domain performs (D6: no client re-derivation).
describe('estadoAdherenciaDia', () => {
  it('is sin_datos when nothing was expected — checked before the tomadas===0 branch', () => {
    expect(estadoAdherenciaDia(0, 0)).toBe('sin_datos');
  });

  it('is incumplido when something was expected but nothing was taken', () => {
    expect(estadoAdherenciaDia(2, 0)).toBe('incumplido');
  });

  it('is cumplido when tomadas meets or exceeds esperadas', () => {
    expect(estadoAdherenciaDia(2, 2)).toBe('cumplido');
    expect(estadoAdherenciaDia(2, 3)).toBe('cumplido');
  });

  it('is parcial when some but not all expected doses were taken', () => {
    expect(estadoAdherenciaDia(2, 1)).toBe('parcial');
  });

  it('is cumplido for a fractional esperadas fully covered by a whole tomadas', () => {
    expect(estadoAdherenciaDia(1 / 3, 1)).toBe('cumplido');
  });
});

// usuario-mobile-consumo design.md D-2: consecutive cumplido days counted
// BACKWARDS FROM YESTERDAY — today (the last entry) is always excluded.
describe('rachaDias', () => {
  it('excludes today entirely — an all-cumplido week still yields 6, not 7', () => {
    const dias = Array(7).fill('cumplido') as string[];
    expect(rachaDias(dias as never)).toBe(6);
  });

  it('is 0 when yesterday was not cumplido, regardless of older days', () => {
    const dias = ['cumplido', 'cumplido', 'cumplido', 'cumplido', 'cumplido', 'incumplido', 'cumplido'];
    expect(rachaDias(dias as never)).toBe(0);
  });

  it('stops counting at the first non-cumplido day scanning backwards from yesterday', () => {
    const dias = ['cumplido', 'incumplido', 'cumplido', 'cumplido', 'cumplido', 'cumplido', 'sin_datos'];
    // yesterday = index 5 ('cumplido'), index 4 'cumplido', index 3 'cumplido',
    // index 2 'cumplido', index 1 'incumplido' -> stop. Streak = 4.
    expect(rachaDias(dias as never)).toBe(4);
  });

  it('is 0 for a 2-entry window (only today) — nothing precedes it', () => {
    expect(rachaDias(['sin_datos', 'cumplido'] as never)).toBe(0);
  });
});

// usuario-mobile-consumo design.md D-2/D-3, Interfaces/Contracts. Pure, no
// Date.now() inside.
describe('ventanaAdherencia', () => {
  it('returns exactly 7 dates, oldest to today', () => {
    const ahora = new Date('2026-06-15T15:00:00.000Z'); // no DST transition nearby
    const { fechas } = ventanaAdherencia(ahora, 'America/Santiago');

    expect(fechas).toEqual([
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
  });

  it('desdeUtc is inclusive local midnight of the oldest date, hastaUtc is exclusive local midnight of tomorrow', () => {
    const ahora = new Date('2026-06-15T15:00:00.000Z');
    const { fechas, desdeUtc, hastaUtc } = ventanaAdherencia(ahora, 'America/Santiago');

    // America/Santiago is GMT-4 in June (no DST active) — local midnight
    // 2026-06-09 00:00 -04:00 = 2026-06-09T04:00:00Z.
    expect(desdeUtc.toISOString()).toBe('2026-06-09T04:00:00.000Z');
    expect(fechas[0]).toBe('2026-06-09');
    // Exclusive: local midnight of the day AFTER today (2026-06-16).
    expect(hastaUtc.toISOString()).toBe('2026-06-16T04:00:00.000Z');
  });

  it('a 7-day window crossing a DST boundary still returns 7 consecutive calendar dates and a shortened total span', () => {
    // Confirmed via the real IANA tzdata (not assumed): America/Santiago
    // moves from GMT-4 to GMT-3 at 2026-09-06T04:00:00Z (local midnight of
    // Sept 6 does not exist — clocks jump from 23:59:59 Sept 5 straight to
    // 01:00:00 Sept 6). A window ending on Sept 8 spans that gap.
    const ahora = new Date('2026-09-08T15:00:00.000Z');
    const { fechas, desdeUtc, hastaUtc } = ventanaAdherencia(ahora, 'America/Santiago');

    expect(fechas).toEqual([
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
    ]);
    // 6 full 24h local days + 1 shortened-by-1h spring-forward day = 167h,
    // never the naive 168h a fixed-offset implementation would compute.
    const horas = (hastaUtc.getTime() - desdeUtc.getTime()) / 3_600_000;
    expect(horas).toBe(167);
  });
});
