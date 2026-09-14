/**
 * Whether the pitch has walls, kept on this device. The page's WALLS toggle,
 * ported, stored the way the theme and control preferences are: a storage
 * failure falls back to the default, because a preference must never break
 * boot. ON is that default, matching the engine's own wallsEnabled default
 * and the page's pageWalls.
 *
 * This is the one setting here that reaches the engine, so like the page it
 * applies to the NEXT round, never the one in play.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const WALLS_KEY = 'pitchSnakeWalls';

/** Load the stored choice; walls ON when unset or unreadable. */
export async function loadWallsPref(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WALLS_KEY)) !== 'off';
  } catch {
    return true;
  }
}

/** Persist the choice; failures are swallowed. */
export async function saveWallsPref(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(WALLS_KEY, on ? 'on' : 'off');
  } catch {
    // a preference that fails to save is a preference for one session
  }
}
