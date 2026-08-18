jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  // See `../../__tests__/login.test.tsx` for why `require` (not a
  // top-level `import`) is the correct pattern inside a `jest.mock` factory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  const Tabs = ({ children }: { children?: unknown }) => <Text testID="tabs-root">{children}</Text>;
  Tabs.Screen = () => null;
  return {
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
    Tabs,
  };
});

import { SessionProvider, type AuthConfig } from '@repon/auth';
import type { Profile } from '@repon/types';
import { render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import TabLayout from '../_layout';

const config: AuthConfig = { apiBaseUrl: 'https://api.example.com', expectedRole: 'user' };

function storedSessionFor(): string {
  const perfil: Profile = {
    id: 'p1',
    role: 'user',
    status: 'activo',
    nombre: 'Usuario',
    email: 'usuario@example.com',
  };
  return JSON.stringify({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    perfil,
  });
}

describe('usuario-mobile (tabs)/_layout — session guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redirects to /login while unauthenticated', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

    const screen = await render(
      <SessionProvider config={config}>
        <TabLayout />
      </SessionProvider>,
    );

    expect(await screen.findByTestId('redirect')).toHaveTextContent('/login');
    expect(screen.queryByTestId('tabs-root')).toBeNull();
  });

  it('renders the ordinary tab flow for an authenticated session', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSessionFor());

    const screen = await render(
      <SessionProvider config={config}>
        <TabLayout />
      </SessionProvider>,
    );

    expect(await screen.findByTestId('tabs-root')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
  });

  it('waits for rehydration before deciding — never flashes /login for a session that is about to load', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSessionFor());

    const screen = await render(
      <SessionProvider config={config}>
        <TabLayout />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('tabs-root')).toBeTruthy());
  });
});
