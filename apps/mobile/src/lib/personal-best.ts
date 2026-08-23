/**
 * The player's own best score, kept on this device. Deliberately separate
 * from the global board: BEST is yours; the top ten is everyone's.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pitchSnakeBest';

/** Read the stored best; 0 when unset or unreadable. */
export async function loadPersonalBest(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist a new best; failures are swallowed (a save must never break play). */
export async function savePersonalBest(score: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(score));
  } catch {
    // storage being unavailable must not surface into the game
  }
}
