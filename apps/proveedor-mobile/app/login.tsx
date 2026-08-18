import { SesionApiError, useSession } from '@repon/auth';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';

/**
 * mobile-session-client spec, "Explicit failures are surfaced verbatim":
 * one distinct message per `SesionApiError.code`, never collapsed into a
 * generic "invalid credentials" string — `CREDENCIALES_INVALIDAS` is the
 * one deliberate exception (wrong password and unknown email are meant to
 * be indistinguishable, by the backend's own design).
 */
const ERROR_MESSAGES: Record<string, string> = {
  CREDENCIALES_INVALIDAS: 'Correo o contraseña incorrectos.',
  PROFILE_SUSPENDED: 'Tu cuenta está suspendida. Contacta a soporte.',
  COMPANY_SUSPENDED: 'Tu empresa está suspendida. Contacta a soporte.',
  ROL_NO_PERMITIDO: 'Esta cuenta no corresponde a un proveedor — usa la app de usuarios.',
  DEMASIADOS_INTENTOS: 'Demasiados intentos. Intenta nuevamente en unos minutos.',
  AUTH_PROVIDER_NO_DISPONIBLE: 'El servicio no está disponible en este momento. Intenta más tarde.',
};

const DEFAULT_ERROR_MESSAGE = 'No pudimos iniciar sesión. Revisa tu conexión e intenta de nuevo.';

function messageFor(error: unknown): string {
  if (error instanceof SesionApiError) {
    return ERROR_MESSAGES[error.code] ?? error.message;
  }
  return DEFAULT_ERROR_MESSAGE;
}

export default function LoginScreen() {
  const { state, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Already signed in (e.g. app restart with a valid stored session) —
  // never show the login form to an authenticated user. The pending-vs-full
  // -app split (companyStatus: 'pendiente') is `(tabs)/_layout.tsx`'s job,
  // not this screen's — it always redirects to the same place and lets the
  // tabs layout redirect further if the company is still pending.
  if (state === 'authenticated') {
    return <Redirect href="/(tabs)" />;
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await signIn(email, password);
      // On success `state` becomes 'authenticated' reactively (SessionProvider),
      // and the redirect above fires on the next render — no imperative
      // navigation call needed here.
    } catch (error) {
      setErrorMessage(messageFor(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Iniciar sesión</Text>
      <TextInput
        testID="login-email"
        style={styles.input}
        placeholder="Correo electrónico"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        testID="login-password"
        style={styles.input}
        placeholder="Contraseña"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      {errorMessage ? (
        <Text testID="login-error" style={styles.error}>
          {errorMessage}
        </Text>
      ) : null}
      <Pressable
        testID="login-submit"
        style={styles.button}
        onPress={() => void handleSubmit()}
        disabled={submitting || email.length === 0 || password.length === 0}
      >
        {submitting ? <ActivityIndicator /> : <Text style={styles.buttonText}>Entrar</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  error: {
    color: '#c0392b',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#2e78b7',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
});
