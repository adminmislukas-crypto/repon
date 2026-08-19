import type { AdherenciaDia } from '@repon/types';
import { render } from '@testing-library/react-native';

import { StreakBar } from '../streak-bar';

// usuario-mobile-consumo design.md D-2/D6: colour comes from the estado
// enum only — this test asserts the colour mapping directly, proving no
// tomadas>=esperadas comparison happens in this component.

function buildDia(fecha: string, estado: AdherenciaDia['estado']): AdherenciaDia {
  return { fecha, esperadas: 1, tomadas: estado === 'cumplido' ? 1 : 0, estado };
}

describe('StreakBar', () => {
  const dias: AdherenciaDia[] = [
    buildDia('2026-06-09', 'cumplido'),
    buildDia('2026-06-10', 'parcial'),
    buildDia('2026-06-11', 'incumplido'),
    buildDia('2026-06-12', 'sin_datos'),
    buildDia('2026-06-13', 'cumplido'),
    buildDia('2026-06-14', 'cumplido'),
    buildDia('2026-06-15', 'cumplido'),
  ];

  it('renders exactly 7 day cells', async () => {
    const screen = await render(<StreakBar rachaDias={2} dias={dias} />);

    for (const dia of dias) {
      expect(screen.getByTestId(`streak-bar-dia-${dia.fecha}`)).toBeTruthy();
    }
  });

  it('maps each estado to its own distinct colour — cumplido/parcial/incumplido/sin_datos never collapse', async () => {
    const screen = await render(<StreakBar rachaDias={2} dias={dias} />);

    const colores = dias.map((dia) => {
      const node = screen.getByTestId(`streak-bar-dia-${dia.fecha}`);
      // `Themed.View` wraps the given `style` inside its own
      // `[{backgroundColor: theme}, style]` array, so a shallow `.find`
      // would incorrectly match the theme's own background first. Merge
      // every style object in order (later entries override earlier keys,
      // same as RN's own array-style resolution) to get the effective
      // final backgroundColor.
      const merged = [node.props.style].flat(Infinity).filter(Boolean).reduce(
        (acc: Record<string, unknown>, s) => (typeof s === 'object' ? { ...acc, ...s } : acc),
        {},
      );
      return merged.backgroundColor;
    });

    expect(new Set(colores).size).toBe(4); // cumplido appears 3x, still only 4 distinct colours
    expect(colores[0]).toBe(colores[4]); // both 'cumplido' entries share the same colour
    expect(colores[0]).not.toBe(colores[1]); // cumplido !== parcial
    expect(colores[1]).not.toBe(colores[2]); // parcial !== incumplido
    expect(colores[2]).not.toBe(colores[3]); // incumplido !== sin_datos
  });

  it('renders rachaDias exactly as received — singular for 1, never recomputed from dias', async () => {
    const screen = await render(<StreakBar rachaDias={1} dias={dias} />);

    expect(screen.getByTestId('streak-bar-racha')).toHaveTextContent('1 día seguido');
  });

  it('pluralizes for any value other than 1, including 0', async () => {
    const screen = await render(<StreakBar rachaDias={0} dias={dias} />);

    expect(screen.getByTestId('streak-bar-racha')).toHaveTextContent('0 días seguidos');
  });
});
