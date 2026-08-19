jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => ({}));

import { SessionProvider, type AuthConfig } from '@repon/auth';
import type { AdherenciaDia, AdherenciaItem, AdherenciaSemanal } from '@repon/types';
import { render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import ConsumoHistorialScreen from '../consumo-historial';

const config: AuthConfig = { apiBaseUrl: 'https://api.example.com', expectedRole: 'user' };

const FECHAS = ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'];

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

function buildDias(estado: AdherenciaDia['estado']): AdherenciaDia[] {
  return FECHAS.map((fecha) => ({ fecha, esperadas: estado === 'sin_datos' ? 0 : 1, tomadas: estado === 'cumplido' ? 1 : 0, estado }));
}

function buildItem(overrides: Partial<AdherenciaItem> = {}): AdherenciaItem {
  return {
    consumptionId: 'item-1',
    nombre: 'Losartan',
    ownerType: 'self',
    kind: 'medicamento',
    esperadas: 7,
    tomadas: 5,
    porcentaje: 71,
    dias: buildDias('cumplido'),
    ...overrides,
  };
}

function buildAdherencia(overrides: Partial<AdherenciaSemanal> = {}): AdherenciaSemanal {
  return {
    desde: FECHAS[0],
    hasta: FECHAS[6],
    porcentaje: 71,
    rachaDias: 3,
    dias: buildDias('cumplido'),
    items: [buildItem()],
    ...overrides,
  };
}

async function renderScreen(): Promise<RenderResult> {
  const screen = await render(
    <SessionProvider config={config}>
      <ConsumoHistorialScreen />
    </SessionProvider>,
  );
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session'));
  return screen;
}

describe('ConsumoHistorialScreen (s-consumo-historial)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  function mockCargas(adherencia: AdherenciaSemanal) {
    fetchSpy.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/consumo/mis-mascotas')) return jsonResponse(200, []);
      if (url.endsWith('/consumo/mi-adherencia')) return jsonResponse(200, adherencia);
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('renders the figures exactly as returned by the server, with no local recomputation', async () => {
    const adherencia = buildAdherencia({ porcentaje: 42, rachaDias: 5, items: [buildItem({ porcentaje: 30 })] });
    mockCargas(adherencia);

    const screen = await renderScreen();

    expect(await screen.findByTestId('consumo-historial-porcentaje')).toHaveTextContent('42%', { exact: false });
    expect(screen.getByTestId('streak-bar-racha')).toHaveTextContent('5 días seguidos');
    expect(screen.getByTestId('consumo-historial-item-porcentaje-item-1')).toHaveTextContent('30%');
    expect(screen.getByTestId('consumo-historial-rango')).toHaveTextContent('12/08', { exact: false });
    expect(screen.getByTestId('consumo-historial-rango')).toHaveTextContent('18/08', { exact: false });

    for (const dia of adherencia.dias) {
      expect(screen.getByTestId(`streak-bar-dia-${dia.fecha}`)).toBeTruthy();
    }
  });

  it('renders the sin_datos skeleton for a zero-activity user without crashing', async () => {
    const adherencia = buildAdherencia({ porcentaje: 0, rachaDias: 0, dias: buildDias('sin_datos'), items: [] });
    mockCargas(adherencia);

    const screen = await renderScreen();

    expect(await screen.findByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('consumo-historial-porcentaje')).toHaveTextContent('0%', { exact: false });
    expect(screen.queryByTestId('consumo-historial-loading')).toBeNull();
  });

  it('loading, empty and error states are mutually exclusive', async () => {
    const adherencia = buildAdherencia({ items: [] });
    mockCargas(adherencia);

    const screen = await renderScreen();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(screen.queryByTestId('consumo-historial-loading')).toBeNull();
    expect(screen.queryByTestId('error-retry')).toBeNull();
  });

  it('a load failure renders ErrorRetry, distinct from loading and empty', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' }),
    );

    const screen = await renderScreen();

    expect(await screen.findByTestId('error-retry')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
    expect(screen.queryByTestId('consumo-historial-loading')).toBeNull();
  });
});
