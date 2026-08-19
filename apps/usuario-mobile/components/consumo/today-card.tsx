import type { UserConsumptionListItem } from '@repon/types';
import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

import { StockBar } from './stock-bar';

export interface TodayCardProps {
  item: UserConsumptionListItem;
  /**
   * Session-local, never server-derived: `UserConsumption` carries no
   * "marked today" field (only per-log-row `tomadoAt` does, and that never
   * reaches this list response). Set by the parent only after a
   * `postNoContent` + refetch round-trip succeeds — never flipped
   * optimistically before the server confirms (D-7).
   */
  marcado: boolean;
  marcando: boolean;
  error?: string;
  onMarcar: () => void;
}

/** Renders `diasRestantes`/`stockActual` exactly as received from the server — no client-side recomputation of either (D7). */
export function TodayCard({ item, marcado, marcando, error, onMarcar }: TodayCardProps) {
  return (
    <View style={styles.card} testID={`today-card-${item.id}`}>
      <Text style={styles.nombre}>{item.nombre}</Text>
      <Text style={styles.detalle}>
        {item.dosisPorToma} {item.unidad ?? ''} · {item.horarios.join(', ')}
      </Text>
      <StockBar stockActual={item.stockActual} unidad={item.unidad} diasRestantes={item.diasRestantes} />
      {error ? (
        <Text style={styles.error} testID={`today-card-error-${item.id}`}>
          {error}
        </Text>
      ) : null}
      <Pressable
        testID={`today-card-marcar-${item.id}`}
        disabled={marcado || marcando}
        onPress={onMarcar}
        style={[styles.boton, marcado && styles.botonMarcado]}
      >
        <Text style={marcado && styles.botonTextoMarcado}>
          {marcando ? '...' : marcado ? '✓ Tomado' : 'Marcar tomado'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 4,
  },
  nombre: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  detalle: {
    fontSize: 13,
    opacity: 0.7,
  },
  error: {
    fontSize: 12,
    color: '#ef4444',
  },
  boton: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#111827',
    alignItems: 'center',
  },
  botonMarcado: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  botonTextoMarcado: {
    color: '#ffffff',
  },
});
