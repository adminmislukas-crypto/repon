import type { Pet } from '@repon/types';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text } from '@/components/Themed';

/**
 * usuario-mobile-consumo design.md D-9: one generic owner concept, shared
 * by `s-consumo`/`s-consumo-config`/`s-consumo-historial` — never per-screen
 * self/pet branching (the mockup's `switchConsumo`/`switchConsumoConfig`/
 * `switchConsumoHist` triplication).
 */
export type OwnerTab = { key: 'self' } | { key: 'pet'; petId: string };

export function ownerTabKey(tab: OwnerTab): string {
  return tab.key === 'self' ? 'self' : `pet:${tab.petId}`;
}

function ownerTabEquals(a: OwnerTab, b: OwnerTab): boolean {
  return ownerTabKey(a) === ownerTabKey(b);
}

export interface OwnerTabsProps {
  pets: Pet[];
  selected: OwnerTab;
  onSelect: (tab: OwnerTab) => void;
}

/**
 * Multi-pet UI: a horizontally scrollable strip, never a dropdown (D-9's
 * rationale — degrades correctly at 0/1/N). Hidden entirely at 0 pets
 * (D-8) — there's nothing to switch between, and showing a lone "Yo" tab
 * would suggest a choice that doesn't exist yet.
 */
export function OwnerTabs({ pets, selected, onSelect }: OwnerTabsProps) {
  if (pets.length === 0) {
    return null;
  }

  const tabs: { tab: OwnerTab; label: string }[] = [
    { tab: { key: 'self' }, label: 'Yo' },
    ...pets.map((pet) => ({ tab: { key: 'pet', petId: pet.id } as OwnerTab, label: pet.nombre })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="owner-tabs"
      style={styles.scroll}
    >
      {tabs.map(({ tab, label }) => {
        const isSelected = ownerTabEquals(tab, selected);
        return (
          <Pressable
            key={ownerTabKey(tab)}
            testID={`owner-tab-${ownerTabKey(tab)}`}
            onPress={() => onSelect(tab)}
            style={[styles.tab, isSelected && styles.tabSelected]}
          >
            <Text numberOfLines={1} style={isSelected && styles.labelSelected}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  tabSelected: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  labelSelected: {
    color: '#ffffff',
  },
});
