jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => ({}));

import { SessionProvider, type AuthConfig } from '@repon/auth';
import type { UserConsumptionListItem } from '@repon/types';
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import ConsumoConfigScreen from '../consumo-config';

const config: AuthConfig = { apiBaseUrl: 'https://api.example.com', expectedRole: 'user' };

function storedSession(): string {
  return JSON.stringify({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    perfil: { id: 'p1', role: 'user', status: 'activo', nombre: 'Usuario', email: 'u@example.com' },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function buildItem(overrides: Partial<UserConsumptionListItem> = {}): UserConsumptionListItem {
  return {
    id: 'item-1',
    userId: 'p1',
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 1,
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 10,
    autoCrearRefill: false,
    diasRestantes: 10,
    ...overrides,
  };
}

async function renderScreen(): Promise<RenderResult> {
  const screen = await render(
    <SessionProvider config={config}>
      <ConsumoConfigScreen />
    </SessionProvider>,
  );
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session'));
  return screen;
}

describe('ConsumoConfigScreen (s-consumo-config)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  function mockListas(items: UserConsumptionListItem[]) {
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/consumo/mis-mascotas')) return jsonResponse(200, []);
      if (url.endsWith('/consumo/mis-consumos')) return jsonResponse(200, items);
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('renders the active items list with stock/days-remaining', async () => {
    mockListas([buildItem()]);

    const screen = await renderScreen();

    expect(await screen.findByTestId('consumo-config-item-item-1')).toBeTruthy();
    expect(screen.queryByTestId('consumo-config-loading')).toBeNull();
  });

  it('"editar" is disabled and never navigates anywhere', async () => {
    mockListas([buildItem()]);

    const screen = await renderScreen();
    await screen.findByTestId('consumo-config-item-item-1');

    const boton = screen.getByTestId('consumo-config-editar-item-1');
    expect(boton.props.accessibilityState?.disabled ?? boton.props.disabled).toBeTruthy();
  });

  it('interacting with any item shown never issues a POST /consumo/mis-consumos request', async () => {
    mockListas([buildItem()]);

    const screen = await renderScreen();
    await screen.findByTestId('consumo-config-item-item-1');
    await fireEvent.press(screen.getByTestId('consumo-config-editar-item-1'));

    for (const [, init] of fetchSpy.mock.calls) {
      expect((init as RequestInit | undefined)?.method).not.toBe('POST');
    }
  });

  it('renders a distinct empty state when there is nothing active', async () => {
    mockListas([]);

    const screen = await renderScreen();

    expect(await screen.findByTestId('empty-state')).toBeTruthy();
  });

  it('a load failure renders ErrorRetry, distinct from loading and empty', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' }),
    );

    const screen = await renderScreen();

    expect(await screen.findByTestId('error-retry')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(screen.queryByTestId('consumo-config-loading')).toBeNull();
  });
});
