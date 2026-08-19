import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

export interface ErrorRetryProps {
  mensaje: string;
  onReintentar: () => void;
}

/** Visually distinct from `EmptyState` (a red-tinted message + explicit action) — a failed load is not the same state as "you have nothing yet". */
export function ErrorRetry({ mensaje, onReintentar }: ErrorRetryProps) {
  return (
    <View testID="error-retry" style={styles.container}>
      <Text style={styles.mensaje}>{mensaje}</Text>
      <Pressable testID="error-retry-boton" onPress={onReintentar} style={styles.boton}>
        <Text style={styles.botonTexto}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  mensaje: {
    fontSize: 14,
    color: '#ef4444',
    textAlign: 'center',
  },
  boton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  botonTexto: {
    color: '#ef4444',
    fontWeight: '600',
  },
});
