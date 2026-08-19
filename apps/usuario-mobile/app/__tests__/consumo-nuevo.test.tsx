jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-router', () => {
  const back = jest.fn();
  return { useRouter: () => ({ back }), __back: back };
});

import { SessionProvider, type AuthConfig } from '@repon/auth';
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __back: backMock } = require('expo-router');

import ConsumoNuevoScreen from '../consumo-nuevo';

// usuario-mobile-consumo design.md D-6: `s-consumo-nuevo` covers only
// `medicamento`/`suplemento` (D5's shared block) — the mockup's own
// `s-consumo-nuevo` has no 4-way kind picker, unlike `s-consumo-nuevo-pet`'s.
// `alimento`/`vacuna` never reach this screen; they're pet-only concepts
// tested in `consumo-nuevo-pet.test.tsx` (PR7b).

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

async function renderScreen(): Promise<RenderResult> {
  const screen = await render(
    <SessionProvider config={config}>
      <ConsumoNuevoScreen />
    </SessionProvider>,
  );
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session'));
  return screen;
}

describe('ConsumoNuevoScreen (s-consumo-nuevo)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('submits a valid medicamento payload by default — ownerType self, no petId, exactly the 8 NuevoConsumoDto keys', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, { id: 'c-1' }));
    const screen = await renderScreen();

    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-nombre'), 'Losartan');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({
      ownerType: 'self',
      kind: 'medicamento',
      nombre: 'Losartan',
      unidad: 'comprimido',
      dosisPorToma: 1,
      frecuenciaDias: 1,
      horarios: ['08:00'],
      stockActual: 0,
      autoCrearRefill: false,
    });
    expect(body).not.toHaveProperty('petId');
  });

  it('switching to suplemento changes only kind — same field block (D5)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, { id: 'c-1' }));
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-kind-suplemento'));
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-nombre'), 'Omega 3');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.kind).toBe('suplemento');
  });

  it('changing "veces al día" resizes the horarios array to match', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, { id: 'c-1' }));
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-veces-3'));
    expect(screen.getByTestId('consumo-nuevo-horario-0')).toBeTruthy();
    expect(screen.getByTestId('consumo-nuevo-horario-1')).toBeTruthy();
    expect(screen.getByTestId('consumo-nuevo-horario-2')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-horario-1'), '14:00');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-veces-1'));
    await fireEvent.press(screen.getByTestId('consumo-nuevo-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.horarios).toEqual(['08:00']);
  });

  it('a 201 response navigates back', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, { id: 'c-1' }));
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-submit'));

    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
  });

  it('a 400 CONSUMO_INVALIDO shows the mapped Spanish message and retains the form (no back())', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(400, { statusCode: 400, code: 'CONSUMO_INVALIDO', message: 'x' }),
    );
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-submit'));

    expect(await screen.findByTestId('consumo-nuevo-error')).toHaveTextContent(
      'Revisa los datos del consumo.',
    );
    expect(backMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('consumo-nuevo-nombre')).toBeTruthy();
  });

  it('never sends any of the 7 dropped mockup-only fields', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, { id: 'c-1' }));
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-submit'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    const camposDescartados = [
      'diaSemana',
      'diasSemana',
      'contexto',
      'notificarAntes',
      'alertaStockBajo',
      'ultimaAplicacion',
      'duracion',
    ];
    for (const campo of camposDescartados) {
      expect(body).not.toHaveProperty(campo);
    }
    expect(Object.keys(body).sort()).toEqual(
      [
        'ownerType',
        'kind',
        'nombre',
        'unidad',
        'dosisPorToma',
        'frecuenciaDias',
        'horarios',
        'stockActual',
        'autoCrearRefill',
      ].sort(),
    );
  });
});
