import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  titulo: string;
  descripcion?: string;
  /** Reused for both the D-8 zero-pets-and-zero-consumptions first-run block (2 CTAs) and every per-owner empty state (0 or 1 CTA). */
  acciones?: EmptyStateAction[];
}

export function EmptyState({ titulo, descripcion, acciones = [] }: EmptyStateProps) {
  return (
    <View testID="empty-state" style={styles.container}>
      <Text style={styles.titulo}>{titulo}</Text>
      {descripcion ? <Text style={styles.descripcion}>{descripcion}</Text> : null}
      {acciones.map((accion) => (
        <Pressable key={accion.label} testID={`empty-state-cta-${accion.label}`} onPress={accion.onPress}>
          <Text style={styles.cta}>{accion.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  titulo: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  descripcion: {
    fontSize: 13,
    opacity: 0.7,
    textAlign: 'center',
  },
  cta: {
    fontWeight: '600',
    marginTop: 8,
  },
});
