import { getJson, useSession } from '@repon/auth';
import type { AdherenciaEstado, AdherenciaSemanal, Pet } from '@repon/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { EmptyState } from '@/components/consumo/empty-state';
import { ErrorRetry } from '@/components/consumo/error-retry';
import { OwnerTabs, type OwnerTab } from '@/components/consumo/owner-tabs';
import { StreakBar } from '@/components/consumo/streak-bar';
import { Text, View } from '@/components/Themed';
import { mensajeDeError } from '@/lib/mensajes-error';

/**
 * usuario-mobile-consumo design.md D-2/D6/D-9: colours come from the
 * `estado` enum only — never `tomadas >= esperadas` compared here.
 * Duplicated from `streak-bar.tsx` (not exported there) because the
 * per-item grid below has no racha of its own to attach it to.
 */
const COLOR_POR_ESTADO: Record<AdherenciaEstado, string> = {
  cumplido: '#22c55e',
  parcial: '#eab308',
  incumplido: '#ef4444',
  sin_datos: '#d1d5db',
};

function formatoDiaMes(fecha: string): string {
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}

/**
 * `s-consumo-historial` — usuario-mobile-consumo design.md D-2/D-9. Own
 * `version` counter, independent of the `s-consumo` tab's (design.md's flow
 * diagram: adherence is fetched only on this screen's mount, never
 * pre-fetched by the tab — D-1 scoping). `mis-mascotas` is fetched too,
 * alongside `mi-adherencia`: `AdherenciaItem` carries the *consumption's*
 * `nombre`, not the pet's, and D-9 pins tab labels to `pet.nombre` for all
 * three owner-tabbed screens — `AdherenciaSemanal` alone cannot supply that
 * label (a resolved gap, not literal task wording).
 */
export default function ConsumoHistorialScreen() {
  const { authFetch } = useSession();
  const [version, setVersion] = useState(0);
  const [mascotas, setMascotas] = useState<Pet[] | null>(null);
  const [adherencia, setAdherencia] = useState<AdherenciaSemanal | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerTab>({ key: 'self' });

  useEffect(() => {
    let cancelled = false;
    setErrorCarga(null);
    Promise.all([
      getJson<Pet[]>(authFetch, '/consumo/mis-mascotas'),
      getJson<AdherenciaSemanal>(authFetch, '/consumo/mi-adherencia'),
    ])
      .then(([m, a]) => {
        if (!cancelled) {
          setMascotas(m);
          setAdherencia(a);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErrorCarga(mensajeDeError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [version, authFetch]);

  if (errorCarga !== null) {
    return (
      <View style={styles.container} testID="consumo-historial-screen">
        <ErrorRetry mensaje={errorCarga} onReintentar={() => setVersion((v) => v + 1)} />
      </View>
    );
  }

  if (mascotas === null || adherencia === null) {
    return (
      <View style={[styles.container, styles.centrado]} testID="consumo-historial-screen">
        <ActivityIndicator testID="consumo-historial-loading" />
      </View>
    );
  }

  // Items carry ownerType/petId — same local-filter pattern as D-9's other
  // two consumers. The aggregate header below is NEVER recomputed for the
  // filtered subset (that would be client-side adherence math, D6) — only
  // the per-item list is grouped by the selected tab.
  const itemsFiltrados = adherencia.items.filter((item) =>
    owner.key === 'self' ? item.ownerType === 'self' : item.petId === owner.petId,
  );

  return (
    <ScrollView style={styles.container} testID="consumo-historial-screen">
      <Text testID="consumo-historial-rango" style={styles.rango}>
        {formatoDiaMes(adherencia.desde)} – {formatoDiaMes(adherencia.hasta)}
      </Text>
      <Text testID="consumo-historial-porcentaje" style={styles.porcentaje}>
        {adherencia.porcentaje}% de adherencia esta semana
      </Text>
      <StreakBar rachaDias={adherencia.rachaDias} dias={adherencia.dias} />
      <OwnerTabs pets={mascotas} selected={owner} onSelect={setOwner} />
      {itemsFiltrados.length === 0 ? (
        <EmptyState titulo="Sin actividad esta semana" descripcion="Aún no hay tomas registradas en los últimos 7 días." />
      ) : (
        itemsFiltrados.map((item) => (
          <View key={item.consumptionId} style={styles.card} testID={`consumo-historial-item-${item.consumptionId}`}>
            <Text style={styles.nombre}>{item.nombre}</Text>
            <Text
              testID={`consumo-historial-item-porcentaje-${item.consumptionId}`}
              style={styles.itemPorcentaje}
            >
              {item.porcentaje}%
            </Text>
            <View style={styles.fila}>
              {item.dias.map((dia) => (
                <View
                  key={dia.fecha}
                  testID={`consumo-historial-item-dia-${item.consumptionId}-${dia.fecha}`}
                  style={[styles.celda, { backgroundColor: COLOR_POR_ESTADO[dia.estado] }]}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  centrado: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rango: {
    fontSize: 13,
    opacity: 0.7,
  },
  porcentaje: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 8,
  },
  nombre: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  itemPorcentaje: {
    fontSize: 13,
    opacity: 0.7,
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
