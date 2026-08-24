/**
 * The player's own best score, kept on this device. Deliberately separate
 * from the global board: BEST is yours; the top ten is everyone's.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RuleMode } from './modes';

// classic keeps the historical key, so a best saved before modes existed
// carries over without a migration step
const KEYS: Record<RuleMode, string> = {
  classic: 'pitchSnakeBest',
  speedrun: 'pitchSnakeBest.speedrun',
  survival: 'pitchSnakeBest.survival',
};

/** Read the stored best for one rule mode; 0 when unset or unreadable. */
export async function loadPersonalBest(mode: RuleMode): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[mode]);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist a new best; failures are swallowed (a save must never break play). */
export async function savePersonalBest(mode: RuleMode, score: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[mode], String(score));
  } catch {
    // storage being unavailable must not surface into the game
  }
}
