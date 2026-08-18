jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  // `jest.mock` factories run hoisted above this file's own imports (a
  // `babel-plugin-jest-hoist` constraint — only `mock`-prefixed bindings
  // may cross that boundary), so a plain top-level `import` for `Text`
  // isn't available here; `require` inside the factory is the standard
  // Jest-documented escape hatch, not a stylistic choice.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
  };
});

import { SessionProvider, type AuthConfig } from '@repon/auth';
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import LoginScreen from '../login';

const config: AuthConfig = { apiBaseUrl: 'https://api.example.com', expectedRole: 'provider' };

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

/**
 * In the real app, `app/_layout.tsx` never mounts `login.tsx` until
 * `SessionProvider`'s state has already left `'loading'` (it holds the
 * splash screen until then). This test renders `LoginScreen` directly
 * under a bare `SessionProvider`, without that gate — so it must wait out
 * the same one-tick rehydration itself, or firing form events while the
 * initial `loadSession()` effect is still in flight races it.
 */
async function renderLogin(): Promise<RenderResult> {
  const screen = await render(
    <SessionProvider config={config}>
      <LoginScreen />
    </SessionProvider>,
  );
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session'));
  return screen;
}

async function submit(
  screen: RenderResult,
  email = 'proveedor@example.com',
  password = 'secret',
): Promise<void> {
  // `fireEvent.*` returns a Promise in this RNTL version — each call must
  // be awaited before the next, or the controlled `TextInput`s' state
  // updates haven't committed when `press` fires (the submit button would
  // still see empty `email`/`password` and stay `disabled`).
  await fireEvent.changeText(screen.getByTestId('login-email'), email);
  await fireEvent.changeText(screen.getByTestId('login-password'), password);
  await fireEvent.press(screen.getByTestId('login-submit'));
  await screen.findByTestId('login-error');
}

describe('LoginScreen', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('a server-side role mismatch (403 ROL_NO_PERMITIDO) shows the mapped message and writes nothing to storage', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(403, { statusCode: 403, code: 'ROL_NO_PERMITIDO', message: 'x' }),
    );
    const screen = await renderLogin();

    await submit(screen);

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'Esta cuenta no corresponde a un proveedor — usa la app de usuarios.',
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('a client-side role mismatch (200 with the wrong perfil.role) is discarded and never persisted', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        accessToken: 'a',
        refreshToken: 'r',
        tokenType: 'bearer',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        perfil: { id: 'p1', role: 'user', status: 'activo', nombre: 'U', email: 'u@x.cl' },
      }),
    );
    const screen = await renderLogin();

    await submit(screen);

    expect(screen.getByTestId('login-error')).toBeTruthy();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('a suspended profile (403 PROFILE_SUSPENDED) shows a message distinct from invalid credentials', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(403, { statusCode: 403, code: 'PROFILE_SUSPENDED', message: 'x' }),
    );
    const screen = await renderLogin();

    await submit(screen);

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'Tu cuenta está suspendida. Contacta a soporte.',
    );
  });

  it('a suspended company (403 COMPANY_SUSPENDED) shows a message distinct from invalid credentials', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(403, { statusCode: 403, code: 'COMPANY_SUSPENDED', message: 'x' }),
    );
    const screen = await renderLogin();

    await submit(screen);

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'Tu empresa está suspendida. Contacta a soporte.',
    );
  });

  it('rate limiting (429 DEMASIADOS_INTENTOS) shows a message distinct from invalid credentials', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(429, { statusCode: 429, code: 'DEMASIADOS_INTENTOS', message: 'x' }),
    );
    const screen = await renderLogin();

    await submit(screen);

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'Demasiados intentos. Intenta nuevamente en unos minutos.',
    );
  });

  it('a backend outage (503 AUTH_PROVIDER_NO_DISPONIBLE) shows a message distinct from invalid credentials', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' }),
    );
    const screen = await renderLogin();

    await submit(screen);

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'El servicio no está disponible en este momento. Intenta más tarde.',
    );
  });

  it('every mapped error message is textually distinct — none collapse into a shared string', async () => {
    const codes = [
      'CREDENCIALES_INVALIDAS',
      'PROFILE_SUSPENDED',
      'COMPANY_SUSPENDED',
      'ROL_NO_PERMITIDO',
      'DEMASIADOS_INTENTOS',
      'AUTH_PROVIDER_NO_DISPONIBLE',
    ];
    const messages = new Set<string>();

    for (const code of codes) {
      fetchSpy.mockResolvedValue(jsonResponse(400, { statusCode: 400, code, message: 'x' }));
      const screen = await renderLogin();
      await submit(screen, `each-${code}@example.com`, 'secret');
      const errorText = screen.getByTestId('login-error').props.children as string;
      messages.add(errorText);
    }

    expect(messages.size).toBe(codes.length);
  });

  it('a wrong password shows the same message as an unknown email (backend indistinguishability preserved end to end)', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(401, { statusCode: 401, code: 'CREDENCIALES_INVALIDAS', message: 'Credenciales inválidas.' }),
    );
    const wrongPasswordScreen = await renderLogin();
    await submit(wrongPasswordScreen, 'known@example.com', 'wrong');
    const wrongPasswordMessage = wrongPasswordScreen.getByTestId('login-error').props.children;

    const unknownEmailScreen = await renderLogin();
    await submit(unknownEmailScreen, 'unknown@example.com', 'whatever');
    const unknownEmailMessage = unknownEmailScreen.getByTestId('login-error').props.children;

    expect(wrongPasswordMessage).toBe(unknownEmailMessage);
  });
});
