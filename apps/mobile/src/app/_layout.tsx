import { Anton_400Regular, useFonts } from '@expo-google-fonts/anton';
import { Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

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

  if (!loaded) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
