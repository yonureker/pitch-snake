/**
 * Whether the game's sound effects play, kept on this device. The page's
 * SOUND toggle, ported, stored the way the theme, control and walls
 * preferences are: a storage failure falls back to the default, because a
 * preference must never break boot. ON is that default, matching the page.
 *
 * This gates the sfx layer only. The crowd bed has its own CROWD row, exactly
 * as on the page, because the two are independent there.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SFX_KEY = 'pitchSnakeSound';

/** Load the stored choice; sound ON when unset or unreadable. */
export async function loadSfxPref(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SFX_KEY)) !== 'off';
  } catch {
    return true;
  }
}

/** Persist the choice; failures are swallowed. */
export async function saveSfxPref(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(SFX_KEY, on ? 'on' : 'off');
  } catch {
    // a preference that fails to save is a preference for one session
  }
}
