import type { AuthProvider } from '../ports-out/auth-provider.port';
import { CerrarSesionUseCase } from './cerrar-sesion.use-case';

function buildDeps() {
  const authProvider: jest.Mocked<AuthProvider> = {
    createAccount: jest.fn(),
    deleteAccount: jest.fn(),
    findAccountByEmail: jest.fn(),
    signIn: jest.fn(),
    refreshSession: jest.fn(),
    revokeSession: jest.fn(),
  };
  const useCase = new CerrarSesionUseCase(authProvider);
  return { authProvider, useCase };
}

describe('CerrarSesionUseCase', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls revokeSession with the given token and resolves', async () => {
    const { authProvider, useCase } = buildDeps();
    authProvider.revokeSession.mockResolvedValue(undefined);

    await expect(useCase.execute('access-token-xyz')).resolves.toBeUndefined();
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-token-xyz');
  });

  it('still resolves even when revokeSession rejects — logout is client-authoritative', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { authProvider, useCase } = buildDeps();
    authProvider.revokeSession.mockRejectedValue(new Error('gotrue down'));

    await expect(useCase.execute('access-token-xyz')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
