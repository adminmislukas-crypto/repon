import { ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

/**
 * Placeholder de contenido real. Cada pantalla de `usuario-mobile/SPEC.md`
 * aterriza acá con su propio caso de uso/UI — esta fase solo arma la
 * navegación (shell), calcada del mockup (`mockups/usuario.html`), no el
 * contenido pantalla por pantalla.
 */
export function ScreenStub({ title, description }: { title: string; description: string }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
    maxWidth: 320,
  },
});
