import { InvalidProfileError } from '../domain/identidad.errors';
import {
  AuthProviderAmbiguousError,
  AuthProviderDeterministicError,
  type AuthProvider,
} from '../ports-out/auth-provider.port';
import type { ProfileRepository } from '../ports-out/profile-repository.port';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import { EmailYaRegistradoError, AuthProviderError, RegistroFallidoError } from '../domain/identidad.errors';
import { RegistrarUsuarioUseCase, type RegistrarUsuarioCommand } from './registrar-usuario.use-case';

// `auth-provisioning` spec's two required scenarios (deterministic-delete,
// ambiguous-forward-recovery) plus `core-api-identidad` spec's full branch
// set (tasks.md 4b.2): success; deterministic profiles-failure→delete+503;
// ambiguous auth-failure→forward-recovery (found/not-found); deterministic
// auth-failure (email_taken→409-equivalent, other→502-equivalent).

function buildDeps() {
  const authProvider: jest.Mocked<AuthProvider> = {
    createAccount: jest.fn(),
    deleteAccount: jest.fn(),
    findAccountByEmail: jest.fn(),
  };
  const profileRepository: jest.Mocked<ProfileRepository> = {
    insertIfAbsent: jest.fn(),
    update: jest.fn(),
    findById: jest.fn(),
  };
  const eventPublisher: jest.Mocked<EventPublisher> = { publish: jest.fn() };
  const useCase = new RegistrarUsuarioUseCase(authProvider, profileRepository, eventPublisher);
  return { authProvider, profileRepository, eventPublisher, useCase };
}

const command: RegistrarUsuarioCommand = {
  email: 'nueva@example.com',
  password: 'super-secreto',
  nombre: 'Nueva Usuaria',
  role: 'user',
};

describe('RegistrarUsuarioUseCase', () => {
  afterEach(() => jest.restoreAllMocks());

  it('success: creates the account, inserts the profile, and publishes UsuarioRegistrado', async () => {
    const { authProvider, profileRepository, eventPublisher, useCase } = buildDeps();
    authProvider.createAccount.mockResolvedValue('uid-1');
    profileRepository.insertIfAbsent.mockResolvedValue(undefined);

    const profile = await useCase.execute(command);

    expect(profile).toEqual({
      id: 'uid-1',
      role: 'user',
      status: 'activo',
      nombre: 'Nueva Usuaria',
      email: 'nueva@example.com',
      telefono: undefined,
      companyId: undefined,
    });
    expect(authProvider.createAccount).toHaveBeenCalledWith(command.email, command.password);
    expect(profileRepository.insertIfAbsent).toHaveBeenCalledWith(profile);
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'usuario.registrado', profile }),
    );
    expect(authProvider.deleteAccount).not.toHaveBeenCalled();
  });

  it('rejects a provider command with no companyId before ever calling AuthProvider', async () => {
    const { authProvider, useCase } = buildDeps();

    await expect(useCase.execute({ ...command, role: 'provider' })).rejects.toThrow(InvalidProfileError);

    expect(authProvider.createAccount).not.toHaveBeenCalled();
  });

  it('deterministic profiles-insert failure compensates with deleteAccount and throws RegistroFallidoError, no retry', async () => {
    const { authProvider, profileRepository, eventPublisher, useCase } = buildDeps();
    authProvider.createAccount.mockResolvedValue('uid-2');
    profileRepository.insertIfAbsent.mockRejectedValue(new Error('duplicate key value violates constraint'));
    authProvider.deleteAccount.mockResolvedValue(undefined);

    await expect(useCase.execute(command)).rejects.toThrow(RegistroFallidoError);

    expect(authProvider.deleteAccount).toHaveBeenCalledWith('uid-2');
    expect(authProvider.deleteAccount).toHaveBeenCalledTimes(1);
    expect(profileRepository.insertIfAbsent).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('compensation failing itself still throws RegistroFallidoError and logs the orphaned uid (never retried)', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { authProvider, profileRepository, useCase } = buildDeps();
    authProvider.createAccount.mockResolvedValue('uid-orphan');
    profileRepository.insertIfAbsent.mockRejectedValue(new Error('constraint violation'));
    authProvider.deleteAccount.mockRejectedValue(new Error('delete also failed'));

    await expect(useCase.execute(command)).rejects.toThrow(RegistroFallidoError);

    expect(authProvider.deleteAccount).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('orphaned auth account'),
      expect.objectContaining({ uid: 'uid-orphan' }),
    );
  });

  it('ambiguous auth failure recovers forward and retries insertIfAbsent when an account is found', async () => {
    const { authProvider, profileRepository, eventPublisher, useCase } = buildDeps();
    authProvider.createAccount.mockRejectedValue(new AuthProviderAmbiguousError());
    authProvider.findAccountByEmail.mockResolvedValue({ id: 'uid-recovered' });
    profileRepository.insertIfAbsent.mockResolvedValue(undefined);

    const profile = await useCase.execute(command);

    expect(profile.id).toBe('uid-recovered');
    expect(authProvider.findAccountByEmail).toHaveBeenCalledWith(command.email);
    expect(authProvider.deleteAccount).not.toHaveBeenCalled();
    expect(profileRepository.insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'uid-recovered' }),
    );
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
  });

  it('ambiguous auth failure with no matching account throws a clean, retryable RegistroFallidoError, never deletes', async () => {
    const { authProvider, profileRepository, eventPublisher, useCase } = buildDeps();
    authProvider.createAccount.mockRejectedValue(new AuthProviderAmbiguousError());
    authProvider.findAccountByEmail.mockResolvedValue(null);

    await expect(useCase.execute(command)).rejects.toThrow(RegistroFallidoError);

    expect(authProvider.deleteAccount).not.toHaveBeenCalled();
    expect(profileRepository.insertIfAbsent).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('deterministic auth failure with reason email_taken throws EmailYaRegistradoError, no compensation', async () => {
    const { authProvider, profileRepository, useCase } = buildDeps();
    authProvider.createAccount.mockRejectedValue(new AuthProviderDeterministicError('email_taken'));

    await expect(useCase.execute(command)).rejects.toThrow(EmailYaRegistradoError);

    expect(authProvider.deleteAccount).not.toHaveBeenCalled();
    expect(profileRepository.insertIfAbsent).not.toHaveBeenCalled();
  });

  it.each(['invalid_credentials', 'other'] as const)(
    'deterministic auth failure with reason %s throws AuthProviderError, no compensation',
    async (reason) => {
      const { authProvider, profileRepository, useCase } = buildDeps();
      authProvider.createAccount.mockRejectedValue(new AuthProviderDeterministicError(reason));

      await expect(useCase.execute(command)).rejects.toThrow(AuthProviderError);

      expect(authProvider.deleteAccount).not.toHaveBeenCalled();
      expect(profileRepository.insertIfAbsent).not.toHaveBeenCalled();
    },
  );
});
