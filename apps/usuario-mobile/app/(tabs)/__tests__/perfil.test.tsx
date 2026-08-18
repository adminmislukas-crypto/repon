import { render } from '@testing-library/react-native';

import { REPON_AUTH_PACKAGE_ID } from '@repon/auth';

import PerfilScreen from '../perfil';

describe('PerfilScreen', () => {
  it('renders the @repon/auth wiring probe', async () => {
    const { getByTestId, getByText } = await render(<PerfilScreen />);

    expect(getByTestId('auth-wiring-probe')).toBeTruthy();
    expect(getByText('@repon/auth wiring OK')).toBeTruthy();
    expect(REPON_AUTH_PACKAGE_ID).toBe('@repon/auth');
  });
});
