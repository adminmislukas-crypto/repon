import type { AdherenciaDia, AdherenciaEstado } from '@repon/types';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

/**
 * usuario-mobile-consumo design.md D-2/D6: colours come from the 4-value
 * `estado` enum ONLY — never `tomadas >= esperadas` compared here. That
 * comparison is adherence math, and D6 forbids the client from doing it.
 */
const COLOR_POR_ESTADO: Record<AdherenciaEstado, string> = {
  cumplido: '#22c55e',
  parcial: '#eab308',
  incumplido: '#ef4444',
  sin_datos: '#d1d5db',
};

export interface StreakBarProps {
  /** Consecutive cumplido days, counted backwards from yesterday — never includes today (D-2). */
  rachaDias: number;
  /** Exactly 7 entries, oldest first. */
  dias: AdherenciaDia[];
}

export function StreakBar({ rachaDias, dias }: StreakBarProps) {
  return (
    <View testID="streak-bar">
      <Text testID="streak-bar-racha" style={styles.racha}>
        {rachaDias === 1 ? '1 día seguido' : `${rachaDias} días seguidos`}
      </Text>
      <View style={styles.fila}>
        {dias.map((dia) => (
          <View
            key={dia.fecha}
            testID={`streak-bar-dia-${dia.fecha}`}
            style={[styles.celda, { backgroundColor: COLOR_POR_ESTADO[dia.estado] }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  racha: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 4,
  },
  fila: {
    flexDirection: 'row',
    gap: 4,
  },
  celda: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
});
