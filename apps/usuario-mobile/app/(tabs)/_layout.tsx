import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

/**
 * usuario-mobile/SPEC.md, "Menú inferior (5 pestañas)" — un `Tabs.Screen`
 * por fila de esa tabla, `name` = el nombre del archivo de ruta, `title` =
 * el nombre de la pestaña. Íconos vía `@expo/vector-icons` (Ionicons), no
 * `expo-symbols`: este dominio corre en web/escritorio además de iOS/
 * Android (ver SPEC.md, "React Native + Expo"), e Ionicons renderiza igual
 * en las 3 plataformas — `expo-symbols` es esencialmente solo SF Symbols
 * de iOS.
 */
export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        // Disable the static render of the header on web to prevent a
        // hydration error in React Navigation v6 (template's own note).
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="consumos"
        options={{
          title: 'Consumos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="medkit" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="refill"
        options={{
          title: 'Refill',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="ofertas"
        options={{
          title: 'Ofertas',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mail" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
