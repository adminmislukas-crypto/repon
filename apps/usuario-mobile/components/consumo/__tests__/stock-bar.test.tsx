import { render } from '@testing-library/react-native';

import { StockBar } from '../stock-bar';

// usuario-mobile-consumo design.md D-6: the kg conversion is DISPLAY-only —
// the wire format (grams) never changes, only what's shown to the user.

describe('StockBar', () => {
  it('renders grams as-is when below the 1000g threshold', async () => {
    const screen = await render(<StockBar stockActual={250} unidad="g" diasRestantes={5} />);

    expect(screen.getByTestId('stock-bar')).toHaveTextContent('250 g', { exact: false });
  });

  it('converts to kilograms with one decimal at/above 1000g', async () => {
    const screen = await render(<StockBar stockActual={3600} unidad="g" diasRestantes={12} />);

    expect(screen.getByTestId('stock-bar')).toHaveTextContent('3.6 kg', { exact: false });
  });

  it('renders exactly 1000g as 1.0 kg — the threshold is inclusive', async () => {
    const screen = await render(<StockBar stockActual={1000} unidad="g" diasRestantes={3} />);

    expect(screen.getByTestId('stock-bar')).toHaveTextContent('1.0 kg', { exact: false });
  });

  it('never converts a non-gram unit, regardless of magnitude', async () => {
    const screen = await render(<StockBar stockActual={5000} unidad="mg" diasRestantes={1} />);

    expect(screen.getByTestId('stock-bar')).toHaveTextContent('5000 mg', { exact: false });
  });

  it('renders diasRestantes exactly as received, singular for 1', async () => {
    const screen = await render(<StockBar stockActual={10} unidad="mg" diasRestantes={1} />);

    expect(screen.getByTestId('stock-bar')).toHaveTextContent('1 día', { exact: false });
  });

  it('renders a bare number when unidad is absent', async () => {
    const screen = await render(<StockBar stockActual={7} diasRestantes={2} />);

    expect(screen.getByTestId('stock-bar')).toHaveTextContent('· 7', { exact: false });
  });
});
