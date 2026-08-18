import type { ActorPort, AuthenticatedActor } from '../../../shared/auth/ports/actor.port';
import {
  AuthProviderNoDisponibleError,
  EmpresaSuspendidaError,
  PerfilSuspendidoError,
  SesionExpiradaError,
} from '../domain/identidad.errors';
import {
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
  type AuthSession,
} from '../ports-out/auth-provider.port';
import type { ProfileRepository } from '../ports-out/profile-repository.port';
import { RefrescarSesionUseCase } from './refrescar-sesion.use-case';

function buildActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    profileId: 'uid-1',
    role: 'user',
    status: 'activo',
    companyId: null,
    companyStatus: null,
    adminRole: null,
    ...overrides,
  };
}

function buildDeps() {
  const authProvider: jest.Mocked<AuthProvider> = {
    createAccount: jest.fn(),
    deleteAccount: jest.fn(),
    findAccountByEmail: jest.fn(),
    signIn: jest.fn(),
    refreshSession: jest.fn(),
    revokeSession: jest.fn(),
  };
  const actorPort: jest.Mocked<ActorPort> = { findActorById: jest.fn() };
  const profileRepository: jest.Mocked<ProfileRepository> = {
    insertIfAbsent: jest.fn(),
    update: jest.fn(),
    findById: jest.fn(),
  };
  const useCase = new RefrescarSesionUseCase(authProvider, actorPort, profileRepository);
  return { authProvider, actorPort, profileRepository, useCase };
}

const refreshedSession: AuthSession = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresAt: 1_700_000_100,
  userId: 'uid-1',
};

describe('RefrescarSesionUseCase', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a fresh session and profile on success', async () => {
    const { authProvider, actorPort, profileRepository, useCase } = buildDeps();
    authProvider.refreshSession.mockResolvedValue(refreshedSession);
    actorPort.findActorById.mockResolvedValue(buildActor());
    profileRepository.findById.mockResolvedValue({
      id: 'uid-1',
      role: 'user',
      status: 'activo',
      nombre: 'Ana',
      email: 'ana@example.com',
    });

    const result = await useCase.execute('old-refresh-token');

    expect(result).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: 1_700_000_100,
      perfil: { id: 'uid-1', role: 'user', status: 'activo', nombre: 'Ana', email: 'ana@example.com' },
      companyStatus: null,
    });
    expect(authProvider.refreshSession).toHaveBeenCalledWith('old-refresh-token');
    expect(authProvider.revokeSession).not.toHaveBeenCalled();
  });

  it('maps a deterministic failure (expired/reused/rotated-away token) to SesionExpiradaError', async () => {
    const { authProvider, useCase } = buildDeps();
    authProvider.refreshSession.mockRejectedValue(
      new AuthProviderDeterministicError('invalid_credentials'),
    );

    await expect(useCase.execute('stale-token')).rejects.toBeInstanceOf(SesionExpiradaError);
  });

  it('maps an ambiguous failure to AuthProviderNoDisponibleError', async () => {
    const { authProvider, useCase } = buildDeps();
    authProvider.refreshSession.mockRejectedValue(new AuthProviderAmbiguousError(new Error('timeout')));

    await expect(useCase.execute('some-token')).rejects.toBeInstanceOf(AuthProviderNoDisponibleError);
  });

  it('refuses an orphan profile as SesionExpiradaError and warns', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.refreshSession.mockResolvedValue(refreshedSession);
    actorPort.findActorById.mockResolvedValue(null);

    await expect(useCase.execute('some-token')).rejects.toBeInstanceOf(SesionExpiradaError);
    expect(warnSpy).toHaveBeenCalled();
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-2');
  });

  it('refuses (and revokes) a profile suspended AFTER the original login — proves D-2\'s claim', async () => {
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.refreshSession.mockResolvedValue(refreshedSession);
    // The original login would have seen status:'activo' — this profile was
    // suspended sometime between login and this refresh call.
    actorPort.findActorById.mockResolvedValue(buildActor({ status: 'suspendido' }));

    await expect(useCase.execute('some-token')).rejects.toBeInstanceOf(PerfilSuspendidoError);
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-2');
  });

  it('refuses (and revokes) a provider whose company was suspended after the original login', async () => {
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.refreshSession.mockResolvedValue(refreshedSession);
    actorPort.findActorById.mockResolvedValue(
      buildActor({ role: 'provider', companyId: 'co-1', companyStatus: 'suspendido' }),
    );

    await expect(useCase.execute('some-token')).rejects.toBeInstanceOf(EmpresaSuspendidaError);
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-2');
  });

  it('does not re-check expectedRole — refresh only re-validates status/companyStatus', async () => {
    const { authProvider, actorPort, profileRepository, useCase } = buildDeps();
    authProvider.refreshSession.mockResolvedValue(refreshedSession);
    actorPort.findActorById.mockResolvedValue(buildActor({ role: 'provider', companyId: 'co-1', companyStatus: 'activo' }));
    profileRepository.findById.mockResolvedValue({
      id: 'uid-1',
      role: 'provider',
      status: 'activo',
      nombre: 'P',
      email: 'p@example.com',
      companyId: 'co-1',
    });

    await expect(useCase.execute('some-token')).resolves.toBeDefined();
    expect(authProvider.revokeSession).not.toHaveBeenCalled();
  });

  it('still refuses even if the best-effort revoke itself fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.refreshSession.mockResolvedValue(refreshedSession);
    actorPort.findActorById.mockResolvedValue(buildActor({ status: 'suspendido' }));
    authProvider.revokeSession.mockRejectedValue(new Error('gotrue down'));

    await expect(useCase.execute('some-token')).rejects.toBeInstanceOf(PerfilSuspendidoError);
    expect(warnSpy).toHaveBeenCalled();
  });
});
