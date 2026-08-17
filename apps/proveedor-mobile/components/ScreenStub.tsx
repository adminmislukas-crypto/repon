import { ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

// Placeholder de contenido real; el shell de navegación es lo que arma esta fase.
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
