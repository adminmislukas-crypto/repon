import { Platform, useWindowDimensions } from 'react-native';

// No prior breakpoint convention exists in this repo's mockups/config; 768
// is the standard mobile/desktop split.
const DESKTOP_BREAKPOINT = 768;

export function useIsDesktopWeb() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}
