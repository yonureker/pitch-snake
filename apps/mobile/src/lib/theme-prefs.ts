/**
 * The theme choice, kept on this device: AUTO follows the system, LIGHT and
 * DARK force a table. The web's THEME chips, ported, and stored exactly the
 * way the mode preference is: a storage failure falls back to the default,
 * because a preference must never break boot.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'pitchSnakeTheme';

/** The three states the web's chips have: follow the system, or force one. */
export type ThemePref = 'auto' | 'light' | 'dark';

/** Type guard for a stored value. */
export function isThemePref(v: unknown): v is ThemePref {
  return v === 'auto' || v === 'light' || v === 'dark';
}

/** Load the stored choice; AUTO when unset or unreadable. */
export async function loadThemePref(): Promise<ThemePref> {
  try {
    const v = await AsyncStorage.getItem(THEME_KEY);
    return isThemePref(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Persist the choice; failures are swallowed. */
export async function saveThemePref(pref: ThemePref): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_KEY, pref);
  } catch {
    // a preference that fails to save is a preference for one session
  }
}
