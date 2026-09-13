/**
 * Which shape the on-screen control wears: the four-wedge PAD this game
 * shipped with, or an analog STICK.
 *
 * The web's CONTROLS chips, ported, and stored exactly the way the theme
 * preference is: a storage failure falls back to the default, because a
 * preference must never break boot. PAD is that default, so nobody's thumbs
 * change under them.
 *
 * Nothing here reaches the engine. Both shapes end at the same `onDir`, which
 * is rule 12's whole point, so this is a preference about the hand and never
 * about the round.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CONTROL_KEY = 'pitchSnakeControls';

/** The two shapes the pad surface can take. */
export type ControlPref = 'pad' | 'stick';

/** Type guard for a stored value. */
export function isControlPref(v: unknown): v is ControlPref {
  return v === 'pad' || v === 'stick';
}

/** Load the stored choice; the wedges when unset or unreadable. */
export async function loadControlPref(): Promise<ControlPref> {
  try {
    const v = await AsyncStorage.getItem(CONTROL_KEY);
    return isControlPref(v) ? v : 'pad';
  } catch {
    return 'pad';
  }
}

/** Persist the choice; failures are swallowed. */
export async function saveControlPref(pref: ControlPref): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTROL_KEY, pref);
  } catch {
    // a preference that fails to save is a preference for one session
  }
}
