import type { ActorPort, AuthenticatedActor } from '../../../shared/auth/ports/actor.port';
import {
  AuthProviderNoDisponibleError,
  CredencialesInvalidasError,
  EmpresaSuspendidaError,
  PerfilSuspendidoError,
  RolNoPermitidoError,
} from '../domain/identidad.errors';
import {
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
  type AuthSession,
} from '../ports-out/auth-provider.port';
import type { ProfileRepository } from '../ports-out/profile-repository.port';
import { IniciarSesionUseCase } from './iniciar-sesion.use-case';

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
  const useCase = new IniciarSesionUseCase(authProvider, actorPort, profileRepository);
  return { authProvider, actorPort, profileRepository, useCase };
}

const validSession: AuthSession = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000,
  userId: 'uid-1',
};

describe('IniciarSesionUseCase', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the session and profile on success', async () => {
    const { authProvider, actorPort, profileRepository, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(buildActor());
    profileRepository.findById.mockResolvedValue({
      id: 'uid-1',
      role: 'user',
      status: 'activo',
      nombre: 'Ana',
      email: 'ana@example.com',
    });

    const result = await useCase.execute({ email: 'ana@example.com', password: 'secret' });

    expect(result).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_000_000,
      perfil: { id: 'uid-1', role: 'user', status: 'activo', nombre: 'Ana', email: 'ana@example.com' },
      companyStatus: null,
    });
    expect(authProvider.revokeSession).not.toHaveBeenCalled();
  });

  it('succeeds for a provider with a pending company', async () => {
    const { authProvider, actorPort, profileRepository, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(
      buildActor({ role: 'provider', companyId: 'co-1', companyStatus: 'pendiente' }),
    );
    profileRepository.findById.mockResolvedValue({
      id: 'uid-1',
      role: 'provider',
      status: 'activo',
      nombre: 'Proveedor',
      email: 'p@example.com',
      companyId: 'co-1',
    });

    const result = await useCase.execute({
      email: 'p@example.com',
      password: 'secret',
      expectedRole: 'provider',
    });

    expect(result.companyStatus).toBe('pendiente');
    expect(authProvider.revokeSession).not.toHaveBeenCalled();
  });

  it('maps a deterministic AuthProvider failure to CredencialesInvalidasError', async () => {
    const { authProvider, useCase } = buildDeps();
    authProvider.signIn.mockRejectedValue(new AuthProviderDeterministicError('invalid_credentials'));

    await expect(useCase.execute({ email: 'a@example.com', password: 'wrong' })).rejects.toBeInstanceOf(
      CredencialesInvalidasError,
    );
  });

  it("collapses a deterministic 'other' reason into the same CredencialesInvalidasError", async () => {
    const { authProvider, useCase } = buildDeps();
    authProvider.signIn.mockRejectedValue(new AuthProviderDeterministicError('other'));

    await expect(useCase.execute({ email: 'a@example.com', password: 'x' })).rejects.toBeInstanceOf(
      CredencialesInvalidasError,
    );
  });

  it('maps an ambiguous AuthProvider failure to AuthProviderNoDisponibleError', async () => {
    const { authProvider, useCase } = buildDeps();
    authProvider.signIn.mockRejectedValue(new AuthProviderAmbiguousError(new Error('timeout')));

    await expect(useCase.execute({ email: 'a@example.com', password: 'x' })).rejects.toBeInstanceOf(
      AuthProviderNoDisponibleError,
    );
  });

  it('refuses an orphan profile (grant ok, no profiles row) as CredencialesInvalidasError and warns', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(null);

    await expect(useCase.execute({ email: 'a@example.com', password: 'x' })).rejects.toBeInstanceOf(
      CredencialesInvalidasError,
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-1');
  });

  it('revokes and refuses a suspended profile — no session data returned', async () => {
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(buildActor({ status: 'suspendido' }));

    const promise = useCase.execute({ email: 'a@example.com', password: 'x' });

    await expect(promise).rejects.toBeInstanceOf(PerfilSuspendidoError);
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-1');
  });

  it('revokes and refuses a provider with a suspended company', async () => {
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(
      buildActor({ role: 'provider', companyId: 'co-1', companyStatus: 'suspendido' }),
    );

    await expect(useCase.execute({ email: 'a@example.com', password: 'x' })).rejects.toBeInstanceOf(
      EmpresaSuspendidaError,
    );
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-1');
  });

  it('revokes and refuses a role mismatch', async () => {
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(buildActor({ role: 'user' }));

    await expect(
      useCase.execute({ email: 'a@example.com', password: 'x', expectedRole: 'provider' }),
    ).rejects.toBeInstanceOf(RolNoPermitidoError);
    expect(authProvider.revokeSession).toHaveBeenCalledWith('access-1');
  });

  it('rejects an admin credential against either expectedRole, revoking each time', async () => {
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(buildActor({ role: 'admin', adminRole: 'soporte' }));

    await expect(
      useCase.execute({ email: 'a@example.com', password: 'x', expectedRole: 'user' }),
    ).rejects.toBeInstanceOf(RolNoPermitidoError);
    expect(authProvider.revokeSession).toHaveBeenCalledTimes(1);
  });

  it('still refuses (revoking) even if the best-effort revoke itself fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { authProvider, actorPort, useCase } = buildDeps();
    authProvider.signIn.mockResolvedValue(validSession);
    actorPort.findActorById.mockResolvedValue(buildActor({ status: 'suspendido' }));
    authProvider.revokeSession.mockRejectedValue(new Error('gotrue down'));

    await expect(useCase.execute({ email: 'a@example.com', password: 'x' })).rejects.toBeInstanceOf(
      PerfilSuspendidoError,
    );
    expect(warnSpy).toHaveBeenCalled();
  });
});
