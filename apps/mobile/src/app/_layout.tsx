import { Anton_400Regular, useFonts } from '@expo-google-fonts/anton';
import { Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { bootAuth } from '@/lib/auth';
import { queryClient } from '@/lib/query-client';

void SplashScreen.preventAutoHideAsync();

/**
 * Root layout: a single stack; the game screen owns the whole viewport.
 * Holds the splash until the web version's typefaces (Anton for display,
 * Barlow for text) are ready, so the title never flashes in a system font.
 */
export default function RootLayout() {
  const [loaded] = useFonts({
    Anton_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
  });

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  // the silent session starts with the app, on the device only: static
  // render imports this tree in node, where there is no storage to boot from
  useEffect(() => {
    void bootAuth();
  }, []);

  if (!loaded) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}
