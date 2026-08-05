import { InvalidProfileError } from './identidad.errors';
import { createProfile } from './profile.entity';

// core-api-identidad spec's domain invariant, unit-tested directly on the
// factory (tasks.md 4a.7, "domain invariant rejection").
describe('createProfile', () => {
  it('rejects a provider profile with no companyId', () => {
    expect(() =>
      createProfile({
        id: '11111111-1111-1111-1111-111111111111',
        role: 'provider',
        nombre: 'Proveedor SPA',
        email: 'p@example.com',
      }),
    ).toThrow(InvalidProfileError);
  });

  it('accepts a provider profile with a companyId, defaulting status to activo', () => {
    const profile = createProfile({
      id: '11111111-1111-1111-1111-111111111111',
      role: 'provider',
      nombre: 'Proveedor SPA',
      email: 'p@example.com',
      companyId: '22222222-2222-2222-2222-222222222222',
    });

    expect(profile.status).toBe('activo');
    expect(profile.companyId).toBe('22222222-2222-2222-2222-222222222222');
  });
});
