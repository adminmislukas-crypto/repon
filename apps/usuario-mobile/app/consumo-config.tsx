import { getJson, useSession } from '@repon/auth';
import type { Pet, UserConsumptionListItem } from '@repon/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { EmptyState } from '@/components/consumo/empty-state';
import { ErrorRetry } from '@/components/consumo/error-retry';
import { OwnerTabs, type OwnerTab } from '@/components/consumo/owner-tabs';
import { StockBar } from '@/components/consumo/stock-bar';
import { Text, View } from '@/components/Themed';
import { mensajeDeError } from '@/lib/mensajes-error';

/**
 * `s-consumo-config` — usuario-mobile-consumo design.md D-4/D-9. A
 * read-only actives list — v1 has no reconfigure endpoint at all (D4,
 * user-confirmed), so "editar" is rendered disabled with honest copy
 * (R2), never hidden and never capable of routing into a create form.
 * Hiding it would make the screen look finished when it isn't; routing it
 * into `consumo-nuevo(-pet)` would silently create a duplicate active item
 * (double stock decrement, corrupted adherence) — both rejected by D4.
 */
export default function ConsumoConfigScreen() {
  const { authFetch } = useSession();
  const [version, setVersion] = useState(0);
  const [mascotas, setMascotas] = useState<Pet[] | null>(null);
  const [consumos, setConsumos] = useState<UserConsumptionListItem[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerTab>({ key: 'self' });

  useEffect(() => {
    let cancelled = false;
    setErrorCarga(null);
    Promise.all([
      getJson<Pet[]>(authFetch, '/consumo/mis-mascotas'),
      getJson<UserConsumptionListItem[]>(authFetch, '/consumo/mis-consumos'),
    ])
      .then(([m, c]) => {
        if (!cancelled) {
          setMascotas(m);
          setConsumos(c);
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
      <View style={styles.container} testID="consumo-config-screen">
        <ErrorRetry mensaje={errorCarga} onReintentar={() => setVersion((v) => v + 1)} />
      </View>
    );
  }

  if (mascotas === null || consumos === null) {
    return (
      <View style={[styles.container, styles.centrado]} testID="consumo-config-screen">
        <ActivityIndicator testID="consumo-config-loading" />
      </View>
    );
  }

  const filtrados = consumos.filter((item) =>
    owner.key === 'self' ? item.ownerType === 'self' : item.petId === owner.petId,
  );

  return (
    <ScrollView style={styles.container} testID="consumo-config-screen">
      <OwnerTabs pets={mascotas} selected={owner} onSelect={setOwner} />
      {filtrados.length === 0 ? (
        <EmptyState titulo="Nada activo por aquí" descripcion="Los consumos que agregues aparecerán en esta lista." />
      ) : (
        filtrados.map((item) => (
          <View key={item.id} style={styles.card} testID={`consumo-config-item-${item.id}`}>
            <Text style={styles.nombre}>{item.nombre}</Text>
            <StockBar stockActual={item.stockActual} unidad={item.unidad} diasRestantes={item.diasRestantes} />
            {/* D4/R2: disabled with visible copy — never hidden, never a route into a create form. */}
            <Pressable disabled testID={`consumo-config-editar-${item.id}`} style={styles.botonEditar}>
              <Text style={styles.textoEditar}>Editar (edición disponible próximamente)</Text>
            </Pressable>
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
  botonEditar: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
    opacity: 0.5,
  },
  textoEditar: {
    fontSize: 12,
  },
});
