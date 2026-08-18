import { render } from '@testing-library/react-native';

import { REPON_AUTH_PACKAGE_ID } from '@repon/auth';

import DashboardScreen from '../index';

describe('DashboardScreen', () => {
  it('renders the @repon/auth wiring probe', async () => {
    const { getByTestId, getByText } = await render(<DashboardScreen />);

    expect(getByTestId('auth-wiring-probe')).toBeTruthy();
    expect(getByText('@repon/auth wiring OK')).toBeTruthy();
    expect(REPON_AUTH_PACKAGE_ID).toBe('@repon/auth');
  });
});
