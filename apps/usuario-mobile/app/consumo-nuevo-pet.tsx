import { getJson, postJson, useSession } from '@repon/auth';
import type { ConsumptionKind, Pet } from '@repon/types';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput } from 'react-native';

import { ErrorRetry } from '@/components/consumo/error-retry';
import { Text, View } from '@/components/Themed';
import { mensajeDeError } from '@/lib/mensajes-error';

/**
 * `s-consumo-nuevo-pet` — usuario-mobile-consumo design.md D-6/D-8. Two
 * steps, because `NuevoConsumoDto.petId` requires a pet that already
 * exists: step 1 resolves (creates or selects) a pet, step 2 creates the
 * consumption for it. **Partial-failure rule (D-8, pinned)**: once step 1
 * succeeds, `mascotaId` is set and this component NEVER re-POSTs
 * `/consumo/mis-mascotas` again for the rest of this screen's lifetime —
 * there is no code path back to the pet-creation form once `mascotaId` is
 * non-null, which is what makes "retry step 2 without duplicating the pet"
 * true structurally, not just by convention.
 */

const UNIDADES_MED = ['comprimido', 'cápsula', 'ml', 'gotas', 'parche'] as const;
const UNIDADES_VAC = ['pipeta', 'dosis'] as const;
const FRECUENCIAS_MED = [1, 2, 7] as const;
const PERIODICIDADES_VAC = [
  { label: 'Mensual', value: 30 },
  { label: 'Cada 3 meses', value: 90 },
  { label: 'Anual', value: 365 },
] as const;
const VECES_AL_DIA = [1, 2, 3] as const;
const KINDS: ConsumptionKind[] = ['medicamento', 'alimento', 'vacuna', 'suplemento'];

function useHorarios(inicial: string[] = ['08:00']) {
  const [horarios, setHorarios] = useState<string[]>(inicial);
  function cambiarCantidad(n: number) {
    setHorarios((prev) => {
      const next = [...prev];
      while (next.length < n) next.push('08:00');
      return next.slice(0, n);
    });
  }
  function cambiarValor(indice: number, valor: string) {
    setHorarios((prev) => prev.map((h, i) => (i === indice ? valor : h)));
  }
  return { horarios, cambiarCantidad, cambiarValor };
}

export default function ConsumoNuevoPetScreen() {
  const { authFetch } = useSession();
  const router = useRouter();

  // ---- pet resolution (step 1) ----
  const [mascotas, setMascotas] = useState<Pet[] | null>(null);
  const [mascotaId, setMascotaId] = useState<string | null>(null);
  const [mostrarFormMascota, setMostrarFormMascota] = useState(false);
  const [nombreMascota, setNombreMascota] = useState('');
  const [especieMascota, setEspecieMascota] = useState('');
  const [erroMascota, setErrorMascota] = useState<string | null>(null);
  const [creandoMascota, setCreandoMascota] = useState(false);
  const [errorCargaMascotas, setErrorCargaMascotas] = useState<string | null>(null);
  const [versionMascotas, setVersionMascotas] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setErrorCargaMascotas(null);
    getJson<Pet[]>(authFetch, '/consumo/mis-mascotas').then(
      (m) => {
        if (!cancelled) setMascotas(m);
      },
      // A failed read must never be conflated with "0 pets" — that would
      // silently route a backend outage into the first-run create form
      // (line ~179's `mascotas.length === 0` check) instead of a distinct,
      // retryable error state.
      (e: unknown) => {
        if (!cancelled) setErrorCargaMascotas(mensajeDeError(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authFetch, versionMascotas]);

  async function crearMascota() {
    setErrorMascota(null);
    setCreandoMascota(true);
    try {
      const pet = await postJson<Pet>(authFetch, '/consumo/mis-mascotas', {
        nombre: nombreMascota,
        especie: especieMascota,
      });
      // The pet now exists server-side — this component never POSTs
      // `/consumo/mis-mascotas` again after this line (D-8 pinned rule).
      setMascotaId(pet.id);
    } catch (e) {
      setErrorMascota(mensajeDeError(e));
    } finally {
      setCreandoMascota(false);
    }
  }

  // ---- consumption creation (step 2) ----
  const [kind, setKind] = useState<ConsumptionKind>('medicamento');
  const [nombre, setNombre] = useState('');
  const [autoCrearRefill, setAutoCrearRefill] = useState(false);
  const [erroConsumo, setErrorConsumo] = useState<string | null>(null);
  const [enviandoConsumo, setEnviandoConsumo] = useState(false);

  // medicamento/suplemento (D5, shared block)
  const [unidadMed, setUnidadMed] = useState<(typeof UNIDADES_MED)[number]>(UNIDADES_MED[0]);
  const [dosisMed, setDosisMed] = useState('1');
  const [frecuenciaMed, setFrecuenciaMed] = useState<(typeof FRECUENCIAS_MED)[number]>(1);
  const [vecesMed, setVecesMed] = useState<(typeof VECES_AL_DIA)[number]>(1);
  const horariosMed = useHorarios();
  const [stockMed, setStockMed] = useState('0');

  // alimento — wire is always grams (D-6): porción sent as-is, stock in kg converted x1000.
  const [porcionG, setPorcionG] = useState('0');
  const [vecesAli, setVecesAli] = useState<(typeof VECES_AL_DIA)[number]>(1);
  const horariosAli = useHorarios();
  const [stockKg, setStockKg] = useState('0');

  // vacuna
  const [unidadVac, setUnidadVac] = useState<(typeof UNIDADES_VAC)[number]>(UNIDADES_VAC[0]);
  const [dosisVac, setDosisVac] = useState('1');
  const [periodicidad, setPeriodicidad] = useState<number>(PERIODICIDADES_VAC[0].value);
  const [horarioVac, setHorarioVac] = useState('09:00');
  const [stockVac, setStockVac] = useState('0');

  function construirPayload() {
    const base = { ownerType: 'pet' as const, petId: mascotaId!, kind, nombre, autoCrearRefill };
    if (kind === 'medicamento' || kind === 'suplemento') {
      return {
        ...base,
        unidad: unidadMed,
        dosisPorToma: Number(dosisMed),
        frecuenciaDias: frecuenciaMed,
        horarios: horariosMed.horarios,
        stockActual: Number(stockMed),
      };
    }
    if (kind === 'alimento') {
      return {
        ...base,
        unidad: 'g',
        dosisPorToma: Number(porcionG),
        frecuenciaDias: 1,
        horarios: horariosAli.horarios,
        // Display-only kg → g on the wire (D-6): the API never sees kilograms.
        stockActual: Number(stockKg) * 1000,
      };
    }
    // vacuna
    return {
      ...base,
      unidad: unidadVac,
      dosisPorToma: Number(dosisVac),
      frecuenciaDias: periodicidad,
      horarios: [horarioVac],
      stockActual: Number(stockVac),
    };
  }

  async function crearConsumo() {
    setErrorConsumo(null);
    setEnviandoConsumo(true);
    try {
      await postJson(authFetch, '/consumo/mis-consumos', construirPayload());
      router.back();
    } catch (e) {
      setErrorConsumo(mensajeDeError(e));
    } finally {
      setEnviandoConsumo(false);
    }
  }

  // ---- render: step 1 ----
  if (mascotaId === null) {
    if (errorCargaMascotas !== null) {
      return (
        <View style={styles.container} testID="consumo-nuevo-pet-screen">
          <ErrorRetry mensaje={errorCargaMascotas} onReintentar={() => setVersionMascotas((v) => v + 1)} />
        </View>
      );
    }

    if (mascotas === null) {
      return (
        <View style={[styles.container, styles.centrado]} testID="consumo-nuevo-pet-screen">
          <ActivityIndicator testID="consumo-nuevo-pet-loading" />
        </View>
      );
    }

    const mostrarForm = mascotas.length === 0 || mostrarFormMascota;

    return (
      <View style={styles.container} testID="consumo-nuevo-pet-screen">
        {mascotas.length > 0 && !mostrarFormMascota ? (
          <>
            <Text style={styles.etiqueta}>Elige una mascota</Text>
            {mascotas.map((pet) => (
              <Pressable
                key={pet.id}
                testID={`consumo-nuevo-pet-select-${pet.id}`}
                onPress={() => setMascotaId(pet.id)}
                style={styles.filaSeleccionable}
              >
                <Text>{pet.nombre}</Text>
              </Pressable>
            ))}
            <Pressable
              testID="consumo-nuevo-pet-mostrar-form"
              onPress={() => setMostrarFormMascota(true)}
            >
              <Text style={styles.link}>+ nueva mascota</Text>
            </Pressable>
          </>
        ) : null}
        {mostrarForm ? (
          <>
            <Text style={styles.etiqueta}>Nombre de la mascota</Text>
            <TextInput
              testID="consumo-nuevo-pet-nombre"
              value={nombreMascota}
              onChangeText={setNombreMascota}
              style={styles.input}
            />
            <Text style={styles.etiqueta}>Especie</Text>
            <TextInput
              testID="consumo-nuevo-pet-especie"
              value={especieMascota}
              onChangeText={setEspecieMascota}
              style={styles.input}
            />
            {erroMascota ? (
              <Text style={styles.error} testID="consumo-nuevo-pet-error-mascota">
                {erroMascota}
              </Text>
            ) : null}
            <Pressable
              testID="consumo-nuevo-pet-crear-mascota"
              disabled={creandoMascota}
              onPress={() => void crearMascota()}
              style={styles.boton}
            >
              <Text style={styles.botonTexto}>{creandoMascota ? 'Guardando…' : 'Siguiente'}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }

  // ---- render: step 2 ----
  return (
    <View style={styles.container} testID="consumo-nuevo-pet-screen">
      <View style={styles.fila}>
        {KINDS.map((opcion) => (
          <Pressable
            key={opcion}
            testID={`consumo-nuevo-pet-kind-${opcion}`}
            onPress={() => setKind(opcion)}
            style={[styles.chip, kind === opcion && styles.chipSeleccionado]}
          >
            <Text style={kind === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.etiqueta}>{kind === 'alimento' || kind === 'vacuna' ? 'Producto' : 'Nombre'}</Text>
      <TextInput testID="consumo-nuevo-pet-nombre-consumo" value={nombre} onChangeText={setNombre} style={styles.input} />

      {(kind === 'medicamento' || kind === 'suplemento') && (
        <>
          <Text style={styles.etiqueta}>Presentación</Text>
          <View style={styles.fila}>
            {UNIDADES_MED.map((opcion) => (
              <Pressable
                key={opcion}
                testID={`consumo-nuevo-pet-unidad-${opcion}`}
                onPress={() => setUnidadMed(opcion)}
                style={[styles.chip, unidadMed === opcion && styles.chipSeleccionado]}
              >
                <Text style={unidadMed === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.etiqueta}>Dosis por toma</Text>
          <TextInput testID="consumo-nuevo-pet-dosis" value={dosisMed} onChangeText={setDosisMed} keyboardType="numeric" style={styles.input} />
          <Text style={styles.etiqueta}>Cada cuántos días</Text>
          <View style={styles.fila}>
            {FRECUENCIAS_MED.map((opcion) => (
              <Pressable
                key={opcion}
                testID={`consumo-nuevo-pet-frecuencia-${opcion}`}
                onPress={() => setFrecuenciaMed(opcion)}
                style={[styles.chip, frecuenciaMed === opcion && styles.chipSeleccionado]}
              >
                <Text style={frecuenciaMed === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.etiqueta}>Veces al día</Text>
          <View style={styles.fila}>
            {VECES_AL_DIA.map((opcion) => (
              <Pressable
                key={opcion}
                testID={`consumo-nuevo-pet-veces-${opcion}`}
                onPress={() => {
                  setVecesMed(opcion);
                  horariosMed.cambiarCantidad(opcion);
                }}
                style={[styles.chip, vecesMed === opcion && styles.chipSeleccionado]}
              >
                <Text style={vecesMed === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
              </Pressable>
            ))}
          </View>
          {horariosMed.horarios.map((h, i) => (
            <TextInput
              key={i}
              testID={`consumo-nuevo-pet-horario-med-${i}`}
              value={h}
              onChangeText={(v) => horariosMed.cambiarValor(i, v)}
              style={styles.input}
            />
          ))}
          <Text style={styles.etiqueta}>Stock actual</Text>
          <TextInput testID="consumo-nuevo-pet-stock-med" value={stockMed} onChangeText={setStockMed} keyboardType="numeric" style={styles.input} />
        </>
      )}

      {kind === 'alimento' && (
        <>
          <Text style={styles.etiqueta}>Porción (g)</Text>
          <TextInput testID="consumo-nuevo-pet-porcion" value={porcionG} onChangeText={setPorcionG} keyboardType="numeric" style={styles.input} />
          <Text style={styles.etiqueta}>Veces al día</Text>
          <View style={styles.fila}>
            {VECES_AL_DIA.map((opcion) => (
              <Pressable
                key={opcion}
                testID={`consumo-nuevo-pet-veces-ali-${opcion}`}
                onPress={() => {
                  setVecesAli(opcion);
                  horariosAli.cambiarCantidad(opcion);
                }}
                style={[styles.chip, vecesAli === opcion && styles.chipSeleccionado]}
              >
                <Text style={vecesAli === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
              </Pressable>
            ))}
          </View>
          {horariosAli.horarios.map((h, i) => (
            <TextInput
              key={i}
              testID={`consumo-nuevo-pet-horario-ali-${i}`}
              value={h}
              onChangeText={(v) => horariosAli.cambiarValor(i, v)}
              style={styles.input}
            />
          ))}
          <Text style={styles.etiqueta}>Stock (kg)</Text>
          <TextInput testID="consumo-nuevo-pet-stock-kg" value={stockKg} onChangeText={setStockKg} keyboardType="numeric" style={styles.input} />
        </>
      )}

      {kind === 'vacuna' && (
        <>
          <Text style={styles.etiqueta}>Presentación</Text>
          <View style={styles.fila}>
            {UNIDADES_VAC.map((opcion) => (
              <Pressable
                key={opcion}
                testID={`consumo-nuevo-pet-unidad-vac-${opcion}`}
                onPress={() => setUnidadVac(opcion)}
                style={[styles.chip, unidadVac === opcion && styles.chipSeleccionado]}
              >
                <Text style={unidadVac === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.etiqueta}>Cantidad</Text>
          <TextInput testID="consumo-nuevo-pet-dosis-vac" value={dosisVac} onChangeText={setDosisVac} keyboardType="numeric" style={styles.input} />
          <Text style={styles.etiqueta}>Periodicidad</Text>
          <View style={styles.fila}>
            {PERIODICIDADES_VAC.map((opcion) => (
              <Pressable
                key={opcion.value}
                testID={`consumo-nuevo-pet-periodicidad-${opcion.value}`}
                onPress={() => setPeriodicidad(opcion.value)}
                style={[styles.chip, periodicidad === opcion.value && styles.chipSeleccionado]}
              >
                <Text style={periodicidad === opcion.value && styles.chipTextoSeleccionado}>{opcion.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.etiqueta}>Horario</Text>
          <TextInput testID="consumo-nuevo-pet-horario-vac" value={horarioVac} onChangeText={setHorarioVac} style={styles.input} />
          <Text style={styles.etiqueta}>Stock actual</Text>
          <TextInput testID="consumo-nuevo-pet-stock-vac" value={stockVac} onChangeText={setStockVac} keyboardType="numeric" style={styles.input} />
        </>
      )}

      <View style={styles.fila}>
        <Text>Auto-crear refill</Text>
        <Switch testID="consumo-nuevo-pet-auto-refill" value={autoCrearRefill} onValueChange={setAutoCrearRefill} />
      </View>

      {erroConsumo ? (
        <Text style={styles.error} testID="consumo-nuevo-pet-error-consumo">
          {erroConsumo}
        </Text>
      ) : null}

      <Pressable
        testID="consumo-nuevo-pet-submit"
        disabled={enviandoConsumo}
        onPress={() => void crearConsumo()}
        style={styles.boton}
      >
        <Text style={styles.botonTexto}>{enviandoConsumo ? 'Guardando…' : 'Guardar'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 8,
  },
  centrado: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  etiqueta: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
  },
  fila: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  filaSeleccionable: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  chipSeleccionado: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  chipTextoSeleccionado: {
    color: '#ffffff',
  },
  link: {
    fontWeight: '600',
    marginTop: 8,
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
  },
  boton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  botonTexto: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
