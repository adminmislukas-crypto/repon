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
import type { Pet } from '@repon/types';
import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __back: backMock } = require('expo-router');

import ConsumoNuevoPetScreen from '../consumo-nuevo-pet';

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
      <ConsumoNuevoPetScreen />
    </SessionProvider>,
  );
  await waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session'));
  return screen;
}

function lastBody(fetchSpy: jest.SpiedFunction<typeof fetch>): Record<string, unknown> {
  const calls = fetchSpy.mock.calls;
  const [, init] = calls[calls.length - 1]!;
  return JSON.parse(String((init as RequestInit).body));
}

describe('ConsumoNuevoPetScreen (s-consumo-nuevo-pet) — 0 pets path', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  it('with 0 pets, shows the pet form directly — no selector', async () => {
    fetchSpy.mockImplementation(async (input) => {
      if (String(input).endsWith('/consumo/mis-mascotas')) return jsonResponse(200, []);
      throw new Error('unexpected');
    });

    const screen = await renderScreen();

    expect(await screen.findByTestId('consumo-nuevo-pet-nombre')).toBeTruthy();
    expect(screen.queryByTestId('consumo-nuevo-pet-select-pet-1')).toBeNull();
  });

  it('step 1 success advances to step 2 with petId pre-filled, then step 2 submits a valid pet-owned payload', async () => {
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method;
      if (url.endsWith('/consumo/mis-mascotas') && method === undefined) return jsonResponse(200, []);
      if (url.endsWith('/consumo/mis-mascotas') && method === 'POST') {
        return jsonResponse(201, { id: 'nueva-mascota-1', userId: 'p1', nombre: 'Rocky', especie: 'perro' });
      }
      if (url.endsWith('/consumo/mis-consumos')) return jsonResponse(201, { id: 'c-1' });
      throw new Error(`unexpected ${url} ${method}`);
    });

    const screen = await renderScreen();
    await screen.findByTestId('consumo-nuevo-pet-nombre');

    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre'), 'Rocky');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-especie'), 'perro');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-crear-mascota'));

    // Step 2 now visible (kind chips only exist on step 2).
    await screen.findByTestId('consumo-nuevo-pet-kind-medicamento');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre-consumo'), 'Losartan');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-submit'));

    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
    const body = lastBody(fetchSpy);
    expect(body).toMatchObject({ ownerType: 'pet', petId: 'nueva-mascota-1', kind: 'medicamento' });
  });
});

describe('ConsumoNuevoPetScreen — >=1 pet path', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  function mockConMascotas(pets: Pet[]) {
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method;
      if (url.endsWith('/consumo/mis-mascotas') && method === undefined) return jsonResponse(200, pets);
      if (url.endsWith('/consumo/mis-mascotas') && method === 'POST') {
        return jsonResponse(201, { id: 'segunda-mascota', userId: 'p1', nombre: 'Luna', especie: 'gato' });
      }
      if (url.endsWith('/consumo/mis-consumos')) return jsonResponse(201, { id: 'c-1' });
      throw new Error(`unexpected ${url} ${method}`);
    });
  }

  it('shows a pet selector, never the create form, when pets already exist', async () => {
    mockConMascotas([{ id: 'p1', userId: 'p1', nombre: 'Rocky', especie: 'perro' }]);

    const screen = await renderScreen();

    expect(await screen.findByTestId('consumo-nuevo-pet-select-p1')).toBeTruthy();
    expect(screen.queryByTestId('consumo-nuevo-pet-nombre')).toBeNull();
    expect(screen.getByTestId('consumo-nuevo-pet-mostrar-form')).toBeTruthy();
  });

  it('choosing an existing pet skips straight to step 2', async () => {
    mockConMascotas([{ id: 'p1', userId: 'p1', nombre: 'Rocky', especie: 'perro' }]);

    const screen = await renderScreen();
    await screen.findByTestId('consumo-nuevo-pet-select-p1');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-select-p1'));

    expect(await screen.findByTestId('consumo-nuevo-pet-kind-medicamento')).toBeTruthy();
  });

  it('"+ nueva mascota" reveals the pet form inline, without hiding it behind a POST to mis-mascotas until submitted', async () => {
    mockConMascotas([{ id: 'p1', userId: 'p1', nombre: 'Rocky', especie: 'perro' }]);

    const screen = await renderScreen();
    await screen.findByTestId('consumo-nuevo-pet-mostrar-form');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-mostrar-form'));

    expect(screen.getByTestId('consumo-nuevo-pet-nombre')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the initial GET so far
  });
});

describe('ConsumoNuevoPetScreen — per-kind payloads (D-6)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  async function irAPasoDos(): Promise<RenderResult> {
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method;
      if (url.endsWith('/consumo/mis-mascotas') && method === undefined) {
        return jsonResponse(200, [{ id: 'p1', userId: 'p1', nombre: 'Rocky', especie: 'perro' }]);
      }
      if (url.endsWith('/consumo/mis-consumos')) return jsonResponse(201, { id: 'c-1' });
      throw new Error(`unexpected ${url} ${method}`);
    });
    const screen = await renderScreen();
    await screen.findByTestId('consumo-nuevo-pet-select-p1');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-select-p1'));
    await screen.findByTestId('consumo-nuevo-pet-kind-medicamento');
    return screen;
  }

  it('alimento converts stock from kg to grams on the wire, sends porción as-is, and unidad is always g', async () => {
    const screen = await irAPasoDos();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-kind-alimento'));
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre-consumo'), 'Croquetas');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-porcion'), '125');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-stock-kg'), '15');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-submit'));

    await waitFor(() => expect(backMock).toHaveBeenCalled());
    const body = lastBody(fetchSpy);
    expect(body).toMatchObject({
      kind: 'alimento',
      unidad: 'g',
      dosisPorToma: 125,
      stockActual: 15000,
      frecuenciaDias: 1,
    });
  });

  it('vacuna collects a real horario and stock — no synthesized defaults, no "última aplicación"/"duración" fields', async () => {
    const screen = await irAPasoDos();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-kind-vacuna'));
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre-consumo'), 'Rabia');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-horario-vac'), '10:30');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-stock-vac'), '1');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-periodicidad-90'));
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-submit'));

    await waitFor(() => expect(backMock).toHaveBeenCalled());
    const body = lastBody(fetchSpy);
    expect(body).toMatchObject({
      kind: 'vacuna',
      horarios: ['10:30'],
      stockActual: 1,
      frecuenciaDias: 90,
    });
    expect(body).not.toHaveProperty('ultimaAplicacion');
    expect(body).not.toHaveProperty('duracion');
  });

  it('suplemento reuses the medicamento field block unchanged (D5)', async () => {
    const screen = await irAPasoDos();

    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-kind-suplemento'));
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre-consumo'), 'Vitamina');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-submit'));

    await waitFor(() => expect(backMock).toHaveBeenCalled());
    const body = lastBody(fetchSpy);
    expect(body).toMatchObject({ kind: 'suplemento', unidad: 'comprimido', dosisPorToma: 1 });
  });
});

describe('ConsumoNuevoPetScreen — initial mis-mascotas fetch failure', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  it('a load failure renders ErrorRetry, never conflated with the legitimate 0-pets first-run form', async () => {
    fetchSpy.mockImplementation(async () =>
      jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' }),
    );

    const screen = await renderScreen();

    expect(await screen.findByTestId('error-retry')).toBeTruthy();
    expect(screen.queryByTestId('consumo-nuevo-pet-nombre')).toBeNull();
    expect(screen.queryByTestId('consumo-nuevo-pet-loading')).toBeNull();
  });

  it('retrying after a failure re-fetches and recovers into the normal 0-pets form', async () => {
    let intentos = 0;
    fetchSpy.mockImplementation(async () => {
      intentos += 1;
      if (intentos === 1) return jsonResponse(503, { statusCode: 503, code: 'AUTH_PROVIDER_NO_DISPONIBLE', message: 'x' });
      return jsonResponse(200, []);
    });

    const screen = await renderScreen();
    await screen.findByTestId('error-retry');
    await fireEvent.press(screen.getByTestId('error-retry-boton'));

    expect(await screen.findByTestId('consumo-nuevo-pet-nombre')).toBeTruthy();
  });
});

describe('ConsumoNuevoPetScreen — partial-failure rule (D-8)', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(storedSession());
  });

  afterEach(() => fetchSpy.mockRestore());

  it('step 1 succeeds, step 2 fails: stays on step 2 with the pet already selected, and retry does NOT re-POST the pet', async () => {
    let intentosConsumo = 0;
    let postsMascota = 0;
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method;
      if (url.endsWith('/consumo/mis-mascotas') && method === undefined) return jsonResponse(200, []);
      if (url.endsWith('/consumo/mis-mascotas') && method === 'POST') {
        postsMascota += 1;
        return jsonResponse(201, { id: 'nueva-mascota-1', userId: 'p1', nombre: 'Rocky', especie: 'perro' });
      }
      if (url.endsWith('/consumo/mis-consumos')) {
        intentosConsumo += 1;
        if (intentosConsumo === 1) {
          return jsonResponse(400, { statusCode: 400, code: 'CONSUMO_INVALIDO', message: 'x' });
        }
        return jsonResponse(201, { id: 'c-1' });
      }
      throw new Error(`unexpected ${url} ${method}`);
    });

    const screen = await renderScreen();
    await screen.findByTestId('consumo-nuevo-pet-nombre');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre'), 'Rocky');
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-especie'), 'perro');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-crear-mascota'));

    await screen.findByTestId('consumo-nuevo-pet-kind-medicamento');
    expect(postsMascota).toBe(1);

    // Step 2 fails.
    await fireEvent.changeText(screen.getByTestId('consumo-nuevo-pet-nombre-consumo'), 'Losartan');
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-submit'));
    expect(await screen.findByTestId('consumo-nuevo-pet-error-consumo')).toHaveTextContent(
      'Revisa los datos del consumo.',
    );
    // Still on step 2 — the pet form never reappears.
    expect(screen.queryByTestId('consumo-nuevo-pet-crear-mascota')).toBeNull();
    expect(screen.getByTestId('consumo-nuevo-pet-kind-medicamento')).toBeTruthy();

    // Retry succeeds — and the pet was never re-created.
    await fireEvent.press(screen.getByTestId('consumo-nuevo-pet-submit'));
    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
    expect(postsMascota).toBe(1);
    const body = lastBody(fetchSpy);
    expect(body).toMatchObject({ petId: 'nueva-mascota-1' });
  });
});
