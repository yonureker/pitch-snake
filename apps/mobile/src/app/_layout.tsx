import { Stack } from 'expo-router';

/** Root layout: a single stack; the game screen owns the whole viewport. */
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
