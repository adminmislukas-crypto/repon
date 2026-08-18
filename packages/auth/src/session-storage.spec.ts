jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { clearSession, loadSession, saveSession } from './session-storage';
import type { Sesion } from './session.types';

const sesion: Sesion = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000,
  perfil: { id: 'p1', role: 'user', status: 'activo', nombre: 'Ana', email: 'ana@example.com' },
};

describe('session-storage (native, expo-secure-store)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('saveSession writes one atomic JSON blob under the repon.session key', async () => {
    await saveSession(sesion);

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('repon.session', JSON.stringify(sesion));
  });

  it('loadSession returns the parsed session when one is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(JSON.stringify(sesion));

    await expect(loadSession()).resolves.toEqual(sesion);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('repon.session');
  });

  it('loadSession returns null when nothing is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

    await expect(loadSession()).resolves.toBeNull();
  });

  it('loadSession returns null, not a throw, on corrupted JSON', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('{not valid json');

    await expect(loadSession()).resolves.toBeNull();
  });

  it('clearSession deletes the key', async () => {
    await clearSession();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('repon.session');
  });

  it('a save-then-load round-trip returns an equal session', async () => {
    let stored: string | null = null;
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (_key: string, value: string) => {
      stored = value;
    });
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async () => stored);

    await saveSession(sesion);

    await expect(loadSession()).resolves.toEqual(sesion);
  });

  it('a second save fully replaces the first — one atomic write, never a half-updated pair', async () => {
    let stored: string | null = null;
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (_key: string, value: string) => {
      stored = value;
    });
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async () => stored);

    await saveSession(sesion);
    const rotated: Sesion = { ...sesion, accessToken: 'access-2', refreshToken: 'refresh-2' };
    await saveSession(rotated);

    await expect(loadSession()).resolves.toEqual(rotated);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(2);
  });
});
