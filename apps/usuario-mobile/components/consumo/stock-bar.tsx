import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

/**
 * usuario-mobile-consumo design.md D-6: `alimento` stock is stored (and
 * sent to the API) in grams — the kg conversion here is DISPLAY-only,
 * never round-tripped back onto the wire. `>= 1000` is the threshold so a
 * 250g bag doesn't render as "0.3 kg".
 */
function formatStock(stockActual: number, unidad?: string): string {
  if (unidad === 'g' && stockActual >= 1000) {
    return `${(stockActual / 1000).toFixed(1)} kg`;
  }
  return unidad ? `${stockActual} ${unidad}` : `${stockActual}`;
}

function formatDias(diasRestantes: number): string {
  return diasRestantes === 1 ? '1 día' : `${diasRestantes} días`;
}

export interface StockBarProps {
  stockActual: number;
  unidad?: string;
  /** Rendered exactly as received — no client-side recomputation (D7). */
  diasRestantes: number;
}

export function StockBar({ stockActual, unidad, diasRestantes }: StockBarProps) {
  return (
    <View style={styles.container} testID="stock-bar">
      <Text style={styles.texto}>{`~${formatDias(diasRestantes)} · ${formatStock(stockActual, unidad)}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
  },
  texto: {
    fontSize: 12,
    opacity: 0.7,
  },
});
