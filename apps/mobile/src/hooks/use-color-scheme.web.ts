import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const emptySubscribe = () => () => {};

/**
 * Web variant: static rendering has no client color scheme, so the server
 * snapshot is a fixed 'light' and the client snapshot re-reads after
 * hydration. useSyncExternalStore expresses that without the
 * setState-in-effect cascade the lint rule (correctly) rejects.
 */
export function useColorScheme() {
  const colorScheme = useRNColorScheme();
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  return hydrated ? colorScheme : 'light';
}
