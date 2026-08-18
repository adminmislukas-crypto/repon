import { Ionicons } from '@expo/vector-icons';
import { RequireSession, useSession } from '@repon/auth';
import { Redirect, Tabs } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useIsDesktopWeb } from '@/components/useIsDesktopWeb';

/**
 * proveedor-mobile/SPEC.md, "Pantallas principales (con nav)" — un
 * `Tabs.Screen` por fila de esa tabla. Íconos vía `@expo/vector-icons`
 * (Ionicons), no `expo-symbols`, por la misma razón que usuario-mobile: esta
 * app corre en web/escritorio además de iOS/Android.
 *
 * mobile-auth-login design.md D-6: `RequireSession` is the unauthenticated-
 * route guard (task 14.4) — redirects to `/login` while unauthenticated.
 * `PendingApprovalGate` is this app's own addition on top of that (unlike
 * usuario-mobile, `companyStatus` is real here — only providers ever have
 * one): a `'pendiente'` company is a successful login (spec: "A pending
 * company is allowed to log in"), but must never reach the ordinary
 * provider flow — it's routed to `/pending-approval` instead.
 */
export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDesktopWeb = useIsDesktopWeb();

  return (
    <RequireSession fallback={<Redirect href="/login" />}>
      <PendingApprovalGate>
        <TabsNavigator colorScheme={colorScheme} isDesktopWeb={isDesktopWeb} />
      </PendingApprovalGate>
    </RequireSession>
  );
}

function PendingApprovalGate({ children }: { children: ReactNode }) {
  const { sesion } = useSession();

  if (sesion?.companyStatus === 'pendiente') {
    return <Redirect href="/pending-approval" />;
  }

  return children;
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
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="solicitudes"
        options={{
          title: 'Solicitudes',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="catalogo"
        options={{
          title: 'Catálogo',
          tabBarIcon: ({ color, size }) => <Ionicons name="pricetags" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="pedidos"
        options={{
          title: 'Pedidos',
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt" color={color} size={size} />,
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
