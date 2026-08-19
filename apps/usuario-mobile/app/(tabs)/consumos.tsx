import { getJson, postNoContent, useSession } from '@repon/auth';
import type { Pet, UserConsumptionListItem } from '@repon/types';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { EmptyState } from '@/components/consumo/empty-state';
import { ErrorRetry } from '@/components/consumo/error-retry';
import { OwnerTabs, type OwnerTab } from '@/components/consumo/owner-tabs';
import { TodayCard } from '@/components/consumo/today-card';
import { Text, View } from '@/components/Themed';
import { mensajeDeError } from '@/lib/mensajes-error';

/**
 * `s-consumo` — usuario-mobile-consumo design.md D-7/D-8/D-9. Real data,
 * replacing the `ScreenStub` this tab shipped with since PR1.
 */
export default function ConsumosScreen() {
  const { authFetch } = useSession();
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [mascotas, setMascotas] = useState<Pet[] | null>(null);
  const [consumos, setConsumos] = useState<UserConsumptionListItem[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [errorDosis, setErrorDosis] = useState<Record<string, string>>({});
  const [owner, setOwner] = useState<OwnerTab>({ key: 'self' });
  /**
   * Session-local only — no field in `UserConsumptionListItem` (or
   * anywhere in `@repon/types`) records "marked today". Added to ONLY
   * inside `marcar`'s successful branch, after `postNoContent` resolves
   * (its `204` IS the server confirmation) — never on tap, never
   * optimistically (D-7). Resets on remount, same as every other piece of
   * screen-local state here (D2: no store).
   */
  const [marcadosHoy, setMarcadosHoy] = useState<Set<string>>(new Set());

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

  async function marcar(id: string): Promise<void> {
    setMarcando(id);
    setErrorDosis((prev) => ({ ...prev, [id]: '' }));
    try {
      await postNoContent(authFetch, `/consumo/mis-consumos/${id}/dosis`, {});
      setMarcadosHoy((prev) => new Set(prev).add(id));
      setVersion((v) => v + 1);
    } catch (e) {
      setErrorDosis((prev) => ({ ...prev, [id]: mensajeDeError(e) }));
    } finally {
      setMarcando(null);
    }
  }

  // "s-consumo-config and s-consumo-historial stay reachable from the tab
  // header icons in every state, including the zero state" (D-8) — rendered
  // above every branch below, never conditional on load/error/empty.
  const navegacion = (
    <View style={styles.nav}>
      <Link href="/consumo-config" testID="nav-config">
        <Text style={styles.navLink}>Config</Text>
      </Link>
      <Link href="/consumo-historial" testID="nav-historial">
        <Text style={styles.navLink}>Historial</Text>
      </Link>
    </View>
  );

  if (errorCarga !== null) {
    return (
      <View style={styles.container} testID="consumos-screen">
        {navegacion}
        <ErrorRetry mensaje={errorCarga} onReintentar={() => setVersion((v) => v + 1)} />
      </View>
    );
  }

  if (mascotas === null || consumos === null) {
    return (
      <View style={[styles.container, styles.centrado]} testID="consumos-screen">
        {navegacion}
        <ActivityIndicator testID="consumos-loading" />
      </View>
    );
  }

  // 0 pets AND 0 consumptions — every brand-new signup. No owner tabs at
  // all; a distinct global first-run block, never the per-owner empty state.
  if (mascotas.length === 0 && consumos.length === 0) {
    return (
      <View style={styles.container} testID="consumos-screen">
        {navegacion}
        <EmptyState
          titulo="Aún no registras consumos"
          descripcion="Agrega un medicamento, alimento, vacuna o suplemento para ti o para tu mascota."
          acciones={[
            { label: 'Agregar para mí', onPress: () => router.push('/consumo-nuevo') },
            { label: 'Agregar una mascota', onPress: () => router.push('/consumo-nuevo-pet') },
          ]}
        />
      </View>
    );
  }

  const filtrados = consumos.filter((item) =>
    owner.key === 'self' ? item.ownerType === 'self' : item.petId === owner.petId,
  );

  return (
    <ScrollView style={styles.container} testID="consumos-screen">
      {navegacion}
      <OwnerTabs pets={mascotas} selected={owner} onSelect={setOwner} />
      {filtrados.length === 0 ? (
        <EmptyState
          titulo="Nada por aquí todavía"
          descripcion={
            owner.key === 'self'
              ? 'Agrega un consumo propio para empezar a hacer seguimiento.'
              : 'Agrega un consumo para esta mascota para empezar a hacer seguimiento.'
          }
          acciones={[
            {
              label: 'Agregar',
              onPress: () => router.push(owner.key === 'self' ? '/consumo-nuevo' : '/consumo-nuevo-pet'),
            },
          ]}
        />
      ) : (
        filtrados.map((item) => (
          <TodayCard
            key={item.id}
            item={item}
            marcado={marcadosHoy.has(item.id)}
            marcando={marcando === item.id}
            error={errorDosis[item.id] || undefined}
            onMarcar={() => void marcar(item.id)}
          />
        ))
      )}
      {mascotas.length === 0 ? (
        <Link href="/consumo-nuevo-pet" testID="nav-agregar-mascota-inline">
          <Text style={styles.navLink}>Agregar una mascota</Text>
        </Link>
      ) : null}
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
  nav: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  navLink: {
    fontSize: 13,
    fontWeight: '600',
  },
});
