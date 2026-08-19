import type { Pet } from '@repon/types';
import { fireEvent, render } from '@testing-library/react-native';

import { OwnerTabs, type OwnerTab } from '../owner-tabs';

// usuario-mobile-consumo design.md D-9: hidden at 0 pets, [Yo][pet] at 1, a
// scrollable N-pet strip — never a dropdown. Props-driven only, no fetch.

function buildPet(overrides: Partial<Pet> = {}): Pet {
  return { id: 'pet-1', userId: 'user-a', nombre: 'Rocky', especie: 'perro', ...overrides };
}

describe('OwnerTabs', () => {
  it('renders nothing at 0 pets — no lone "Yo" tab suggesting a choice that does not exist', async () => {
    const screen = await render(
      <OwnerTabs pets={[]} selected={{ key: 'self' }} onSelect={jest.fn()} />,
    );

    expect(screen.queryByTestId('owner-tabs')).toBeNull();
  });

  it('renders exactly [Yo][pet] at 1 pet', async () => {
    const screen = await render(
      <OwnerTabs pets={[buildPet()]} selected={{ key: 'self' }} onSelect={jest.fn()} />,
    );

    expect(screen.getByTestId('owner-tab-self')).toBeTruthy();
    expect(screen.getByTestId('owner-tab-pet:pet-1')).toBeTruthy();
    expect(screen.getByText('Rocky')).toBeTruthy();
  });

  it('renders a tab per pet at N pets, all reachable', async () => {
    const pets = [buildPet({ id: 'p1', nombre: 'Rocky' }), buildPet({ id: 'p2', nombre: 'Luna' })];
    const screen = await render(
      <OwnerTabs pets={pets} selected={{ key: 'self' }} onSelect={jest.fn()} />,
    );

    expect(screen.getByTestId('owner-tab-self')).toBeTruthy();
    expect(screen.getByTestId('owner-tab-pet:p1')).toBeTruthy();
    expect(screen.getByTestId('owner-tab-pet:p2')).toBeTruthy();
  });

  it('calls onSelect with the tapped tab, self or pet', async () => {
    const onSelect = jest.fn<void, [OwnerTab]>();
    const screen = await render(
      <OwnerTabs pets={[buildPet()]} selected={{ key: 'self' }} onSelect={onSelect} />,
    );

    await fireEvent.press(screen.getByTestId('owner-tab-pet:pet-1'));

    expect(onSelect).toHaveBeenCalledWith({ key: 'pet', petId: 'pet-1' });
  });
});
