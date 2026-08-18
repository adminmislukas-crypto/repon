import { clearSession, loadSession, saveSession } from './session-storage.web';
import type { Sesion } from './session.types';

const sesion: Sesion = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000,
  perfil: { id: 'p1', role: 'user', status: 'activo', nombre: 'Ana', email: 'ana@example.com' },
};

function buildLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
    }),
    clear: jest.fn(() => store.clear()),
    key: jest.fn(() => null),
    get length() {
      return store.size;
    },
  } as unknown as Storage;
}

describe('session-storage.web (localStorage fallback)', () => {
  let mock: Storage;

  beforeEach(() => {
    mock = buildLocalStorageMock();
    Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
  });

  it('saveSession writes one atomic JSON blob under the repon.session key', async () => {
    await saveSession(sesion);

    expect(mock.setItem).toHaveBeenCalledTimes(1);
    expect(mock.setItem).toHaveBeenCalledWith('repon.session', JSON.stringify(sesion));
  });

  it('loadSession returns the parsed session when one is stored', async () => {
    mock.setItem('repon.session', JSON.stringify(sesion));

    await expect(loadSession()).resolves.toEqual(sesion);
  });

  it('loadSession returns null when nothing is stored', async () => {
    await expect(loadSession()).resolves.toBeNull();
  });

  it('loadSession returns null, not a throw, on corrupted JSON', async () => {
    mock.setItem('repon.session', '{not valid json');

    await expect(loadSession()).resolves.toBeNull();
  });

  it('clearSession removes the key', async () => {
    mock.setItem('repon.session', JSON.stringify(sesion));

    await clearSession();

    expect(mock.removeItem).toHaveBeenCalledWith('repon.session');
    await expect(loadSession()).resolves.toBeNull();
  });

  it('a second save fully replaces the first — one atomic write, never a half-updated pair', async () => {
    await saveSession(sesion);
    const rotated: Sesion = { ...sesion, accessToken: 'access-2', refreshToken: 'refresh-2' };
    await saveSession(rotated);

    await expect(loadSession()).resolves.toEqual(rotated);
    expect(mock.setItem).toHaveBeenCalledTimes(2);
  });
});
