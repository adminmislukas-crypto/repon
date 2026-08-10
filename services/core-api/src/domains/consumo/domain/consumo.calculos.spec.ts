import { consumoDiario, diasRestantes, mensajeStockBajo } from './consumo.calculos';

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
