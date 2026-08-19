jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  // See `../../__tests__/login.test.tsx` for why `require` (not a
  // top-level `import`) is the correct pattern inside a `jest.mock` factory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  const push = jest.fn();
  return {
    Link: ({ href, testID, children }: { href: string; testID?: string; children?: unknown }) => (
      <Text testID={testID} onPress={() => push(href)}>
        {children}
      </Text>
    ),
    useRouter: () => ({ push }),
    __push: push,
  };
});

import { SessionProvider, type AuthConfig } from '@repon/auth';
import type { Pet, UserConsumptionListItem } from '@repon/types';
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __push: pushMock } = require('expo-router');

import ConsumosScreen from '../consumos';

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

function buildPet(overrides: Partial<Pet> = {}): Pet {
  return { id: 'pet-1', userId: 'p1', nombre: 'Rocky', especie: 'perro', ...overrides };
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

/**
 * Mounts the real `SessionProvider` (same rehydration wait as
 * `_layout.test.tsx`) and stubs `fetch` per-route, mirroring `login.test.tsx`'s
 * "`fetchSpy` per test" convention.
 */
async function renderScreen(): Promise<RenderResult> {
  const screen = await render(
    <SessionProvider config={config}>
      <ConsumosScreen />
    </SessionProvider>,
  );
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session'));
  return screen;
}

describe('ConsumosScreen (s-consumo)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function mockListas(pets: Pet[], items: UserConsumptionListItem[]) {
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/consumo/mis-mascotas')) return jsonResponse(200, pets);
      if (url.endsWith('/consumo/mis-consumos')) return jsonResponse(200, items);
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('shows loading, then the loaded list', async () => {
    mockListas([], [buildItem()]);

    const screen = await renderScreen();

    expect(await screen.findByTestId('today-card-item-1')).toBeTruthy();
    expect(screen.queryByTestId('consumos-loading')).toBeNull();
  });

  it('zero pets and zero consumptions renders the first-run block with both CTAs and no owner tabs', async () => {
    mockListas([], []);

    const screen = await renderScreen();

    expect(await screen.findByTestId('empty-state-cta-Agregar para mí')).toBeTruthy();
    expect(screen.getByTestId('empty-state-cta-Agregar una mascota')).toBeTruthy();
    expect(screen.queryByTestId('owner-tabs')).toBeNull();
  });

  it('a load failure renders ErrorRetry, never "no tienes nada"', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' }),
    );

    const screen = await renderScreen();

    expect(await screen.findByTestId('error-retry')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('a Reintentar tap re-fetches — a subsequent success replaces the error with the list', async () => {
    let intentos = 0;
    fetchSpy.mockImplementation(async (input) => {
      intentos += 1;
      if (intentos === 1) return jsonResponse(503, { statusCode: 503, code: 'X', message: 'x' });
      const url = String(input);
      if (url.endsWith('/consumo/mis-mascotas')) return jsonResponse(200, []);
      return jsonResponse(200, [buildItem()]);
    });

    const screen = await renderScreen();
    await screen.findByTestId('error-retry');
    await fireEvent.press(screen.getByTestId('error-retry-boton'));

    expect(await screen.findByTestId('today-card-item-1')).toBeTruthy();
  });

  it('N pets render an owner-tabs strip with N+1 tabs (Yo + one per pet)', async () => {
    mockListas([buildPet({ id: 'p1', nombre: 'Rocky' }), buildPet({ id: 'p2', nombre: 'Luna' })], [
      buildItem(),
    ]);

    const screen = await renderScreen();

    await screen.findByTestId('owner-tabs');
    expect(screen.getByTestId('owner-tab-self')).toBeTruthy();
    expect(screen.getByTestId('owner-tab-pet:p1')).toBeTruthy();
    expect(screen.getByTestId('owner-tab-pet:p2')).toBeTruthy();
  });

  it('filters locally by the selected owner tab — no per-owner request is made', async () => {
    mockListas(
      [buildPet({ id: 'p1', nombre: 'Rocky' })],
      [
        buildItem({ id: 'self-item', ownerType: 'self', nombre: 'Item propio' }),
        buildItem({ id: 'pet-item', ownerType: 'pet', petId: 'p1', nombre: 'Item de Rocky' }),
      ],
    );

    const screen = await renderScreen();
    await screen.findByTestId('today-card-self-item');
    expect(screen.queryByTestId('today-card-pet-item')).toBeNull();

    await fireEvent.press(screen.getByTestId('owner-tab-pet:p1'));

    expect(await screen.findByTestId('today-card-pet-item')).toBeTruthy();
    expect(screen.queryByTestId('today-card-self-item')).toBeNull();
    // Exactly the 2 initial-load calls — switching tabs never issues a new request.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('marking a dose posts once, triggers a refetch, and the checkmark flips only after that refetch', async () => {
    let consultasConsumos = 0;
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/consumo/mis-mascotas')) return jsonResponse(200, []);
      if (url.endsWith('/dosis')) return jsonResponse(204, null);
      if (url.endsWith('/consumo/mis-consumos')) {
        consultasConsumos += 1;
        return jsonResponse(200, [buildItem({ stockActual: consultasConsumos === 1 ? 10 : 9 })]);
      }
      throw new Error(`unexpected fetch: ${url} ${JSON.stringify(init)}`);
    });

    const screen = await renderScreen();
    await screen.findByTestId('today-card-item-1');
    expect(screen.getByTestId('today-card-marcar-item-1')).toHaveTextContent('Marcar tomado');

    await fireEvent.press(screen.getByTestId('today-card-marcar-item-1'));

    await waitFor(() =>
      expect(screen.getByTestId('today-card-marcar-item-1')).toHaveTextContent('✓ Tomado'),
    );
    // 2 initial GETs + 1 POST dosis + 2 refetch GETs = 5.
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(consultasConsumos).toBe(2);
  });

  it('a failed mark leaves the row unchecked, shows a Spanish message, and allows a retry', async () => {
    let intentosDosis = 0;
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/consumo/mis-mascotas')) return jsonResponse(200, []);
      if (url.endsWith('/dosis')) {
        intentosDosis += 1;
        if (intentosDosis === 1) {
          return jsonResponse(404, { statusCode: 404, code: 'CONSUMPTION_NOT_FOUND', message: 'x' });
        }
        return jsonResponse(204, null);
      }
      return jsonResponse(200, [buildItem()]);
    });

    const screen = await renderScreen();
    await screen.findByTestId('today-card-item-1');

    await fireEvent.press(screen.getByTestId('today-card-marcar-item-1'));

    expect(await screen.findByTestId('today-card-error-item-1')).toHaveTextContent(
      'Ese consumo ya no existe. Actualiza la lista.',
    );
    expect(screen.getByTestId('today-card-marcar-item-1')).toHaveTextContent('Marcar tomado');

    // Retry succeeds.
    await fireEvent.press(screen.getByTestId('today-card-marcar-item-1'));

    await waitFor(() =>
      expect(screen.getByTestId('today-card-marcar-item-1')).toHaveTextContent('✓ Tomado'),
    );
  });

  it('the config/historial nav links are reachable even while loading', async () => {
    mockListas([], []);
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());

    const screen = await render(
      <SessionProvider config={config}>
        <ConsumosScreen />
      </SessionProvider>,
    );

    expect(screen.getByTestId('nav-config')).toBeTruthy();
    expect(screen.getByTestId('nav-historial')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('nav-config'));
    expect(pushMock).toHaveBeenCalledWith('/consumo-config');
  });
});
