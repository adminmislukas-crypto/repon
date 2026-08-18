import { Ionicons } from '@expo/vector-icons';
import { RequireSession } from '@repon/auth';
import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useIsDesktopWeb } from '@/components/useIsDesktopWeb';

/**
 * usuario-mobile/SPEC.md, "Menú inferior (5 pestañas)" — un `Tabs.Screen`
 * por fila de esa tabla, `name` = el nombre del archivo de ruta, `title` =
 * el nombre de la pestaña. Íconos vía `@expo/vector-icons` (Ionicons), no
 * `expo-symbols`: este dominio corre en web/escritorio además de iOS/
 * Android (ver SPEC.md, "React Native + Expo"), e Ionicons renderiza igual
 * en las 3 plataformas — `expo-symbols` es esencialmente solo SF Symbols
 * de iOS.
 *
 * mobile-auth-login design.md D-6: `RequireSession` is the unauthenticated-
 * route guard (task 13.4) — redirects to `/login` while unauthenticated,
 * renders nothing while `state === 'loading'` (the root layout already
 * holds the splash screen for that; see `app/_layout.tsx`) or if a
 * role-mismatched session slips through (defense-in-depth, discarded via
 * `signOut()` inside `RequireSession` itself).
 */
export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDesktopWeb = useIsDesktopWeb();

  return (
    <RequireSession fallback={<Redirect href="/login" />}>
      <TabsNavigator colorScheme={colorScheme} isDesktopWeb={isDesktopWeb} />
    </RequireSession>
  );
}

function TabsNavigator({
  colorScheme,
  isDesktopWeb,
}: {
  colorScheme: 'light' | 'dark';
  isDesktopWeb: boolean;
}) {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        // Disable the static render of the header on web to prevent a
        // hydration error in React Navigation v6 (template's own note).
        headerShown: useClientOnlyValue(false, true),
        // Desktop web: left sidebar (react-navigation's built-in sidebar
        // variant). Native and narrow web viewports keep the phone-style
        // bottom bar.
        tabBarPosition: isDesktopWeb ? 'left' : 'bottom',
        tabBarLabelPosition: isDesktopWeb ? 'beside-icon' : 'below-icon',
        sceneStyle: isDesktopWeb ? styles.desktopScene : undefined,
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

const styles = StyleSheet.create({
  desktopScene: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
});
