import { postJson, useSession } from '@repon/auth';
import type { ConsumptionKind } from '@repon/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { mensajeDeError } from '@/lib/mensajes-error';

/**
 * `s-consumo-nuevo` — usuario-mobile-consumo design.md D-6. Self-owned
 * items only (`ownerType: 'self'`, no `petId`) — the mockup's own
 * `s-consumo-nuevo` (`mockups/usuario.html:597-680`) is a single flat form
 * with no 4-way type picker (unlike `s-consumo-nuevo-pet`'s), so this
 * screen covers only the `medicamento`/`suplemento` column of D-6's
 * mapping table (D5: they share one field block, differing only in
 * `kind`). `alimento`/`vacuna` are pet-only concepts in this app's mental
 * model and belong to `s-consumo-nuevo-pet` (PR7b), never here.
 */

const UNIDADES = ['comprimido', 'cápsula', 'ml', 'gotas', 'parche'] as const;
const FRECUENCIAS = [1, 2, 7] as const;
const VECES_AL_DIA = [1, 2, 3] as const;

export default function ConsumoNuevoScreen() {
  const { authFetch } = useSession();
  const router = useRouter();

  const [kind, setKind] = useState<Extract<ConsumptionKind, 'medicamento' | 'suplemento'>>(
    'medicamento',
  );
  const [nombre, setNombre] = useState('');
  const [unidad, setUnidad] = useState<(typeof UNIDADES)[number]>(UNIDADES[0]);
  const [dosisPorToma, setDosisPorToma] = useState('1');
  const [frecuenciaDias, setFrecuenciaDias] = useState<(typeof FRECUENCIAS)[number]>(1);
  const [vecesAlDia, setVecesAlDia] = useState<(typeof VECES_AL_DIA)[number]>(1);
  const [horarios, setHorarios] = useState<string[]>(['08:00']);
  const [stockActual, setStockActual] = useState('0');
  const [autoCrearRefill, setAutoCrearRefill] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cambiarVecesAlDia(n: (typeof VECES_AL_DIA)[number]) {
    setVecesAlDia(n);
    setHorarios((prev) => {
      const next = [...prev];
      while (next.length < n) next.push('08:00');
      return next.slice(0, n);
    });
  }

  function cambiarHorario(indice: number, valor: string) {
    setHorarios((prev) => prev.map((h, i) => (i === indice ? valor : h)));
  }

  async function enviar() {
    setError(null);
    setEnviando(true);
    try {
      await postJson(authFetch, '/consumo/mis-consumos', {
        ownerType: 'self',
        kind,
        nombre,
        unidad,
        dosisPorToma: Number(dosisPorToma),
        frecuenciaDias,
        horarios,
        stockActual: Number(stockActual),
        autoCrearRefill,
      });
      router.back();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={styles.container} testID="consumo-nuevo-screen">
      <View style={styles.fila}>
        {(['medicamento', 'suplemento'] as const).map((opcion) => (
          <Pressable
            key={opcion}
            testID={`consumo-nuevo-kind-${opcion}`}
            onPress={() => setKind(opcion)}
            style={[styles.chip, kind === opcion && styles.chipSeleccionado]}
          >
            <Text style={kind === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.etiqueta}>Nombre</Text>
      <TextInput
        testID="consumo-nuevo-nombre"
        value={nombre}
        onChangeText={setNombre}
        style={styles.input}
      />

      <Text style={styles.etiqueta}>Presentación</Text>
      <View style={styles.fila}>
        {UNIDADES.map((opcion) => (
          <Pressable
            key={opcion}
            testID={`consumo-nuevo-unidad-${opcion}`}
            onPress={() => setUnidad(opcion)}
            style={[styles.chip, unidad === opcion && styles.chipSeleccionado]}
          >
            <Text style={unidad === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.etiqueta}>Dosis por toma</Text>
      <TextInput
        testID="consumo-nuevo-dosis"
        value={dosisPorToma}
        onChangeText={setDosisPorToma}
        keyboardType="numeric"
        style={styles.input}
      />

      <Text style={styles.etiqueta}>Cada cuántos días</Text>
      <View style={styles.fila}>
        {FRECUENCIAS.map((opcion) => (
          <Pressable
            key={opcion}
            testID={`consumo-nuevo-frecuencia-${opcion}`}
            onPress={() => setFrecuenciaDias(opcion)}
            style={[styles.chip, frecuenciaDias === opcion && styles.chipSeleccionado]}
          >
            <Text style={frecuenciaDias === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.etiqueta}>Veces al día</Text>
      <View style={styles.fila}>
        {VECES_AL_DIA.map((opcion) => (
          <Pressable
            key={opcion}
            testID={`consumo-nuevo-veces-${opcion}`}
            onPress={() => cambiarVecesAlDia(opcion)}
            style={[styles.chip, vecesAlDia === opcion && styles.chipSeleccionado]}
          >
            <Text style={vecesAlDia === opcion && styles.chipTextoSeleccionado}>{opcion}</Text>
          </Pressable>
        ))}
      </View>
      {horarios.map((horario, indice) => (
        <TextInput
          key={indice}
          testID={`consumo-nuevo-horario-${indice}`}
          value={horario}
          onChangeText={(valor) => cambiarHorario(indice, valor)}
          placeholder="HH:mm"
          style={styles.input}
        />
      ))}

      <Text style={styles.etiqueta}>Stock actual</Text>
      <TextInput
        testID="consumo-nuevo-stock"
        value={stockActual}
        onChangeText={setStockActual}
        keyboardType="numeric"
        style={styles.input}
      />

      <View style={styles.fila}>
        <Text>Auto-crear refill</Text>
        <Switch
          testID="consumo-nuevo-auto-refill"
          value={autoCrearRefill}
          onValueChange={setAutoCrearRefill}
        />
      </View>

      {error ? (
        <Text style={styles.error} testID="consumo-nuevo-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        testID="consumo-nuevo-submit"
        disabled={enviando}
        onPress={() => void enviar()}
        style={styles.boton}
      >
        <Text style={styles.botonTexto}>{enviando ? 'Guardando…' : 'Guardar'}</Text>
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
