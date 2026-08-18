import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { SessionProvider, useSession, type AuthConfig } from '@repon/auth';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// mobile-auth-login design.md D-6: @repon/auth never reads `process.env`
// itself — this app is the one place `EXPO_PUBLIC_API_URL` (see
// `.env.example`) is read, inlined by Expo at bundle time.
const authConfig: AuthConfig = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  expectedRole: 'provider',
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // Metro's asset pipeline requires a static `require()` call here — it's
    // resolved at bundle time to a module id, not an ordinary import; a TS
    // `import` needs a `declare module '*.ttf'` ambient type this repo
    // doesn't have, and doesn't match Metro's own asset registration flow
    // (root eslint.config.js carries a matching override for this file).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  if (!loaded) {
    return null;
  }

  return (
    <SessionProvider config={authConfig}>
      <RootLayoutNav />
    </SessionProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { state } = useSession();

  // Splash stays up through font loading (above) AND session rehydration
  // (design.md D-6, "this is what makes 'survives app restart' true") — a
  // stored session must be applied before the first real screen renders,
  // never a login-screen flash first.
  useEffect(() => {
    if (state !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [state]);

  if (state === 'loading') {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="pending-approval" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
