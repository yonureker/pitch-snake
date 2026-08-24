/**
 * The player's mode choice and joined tournament, kept on this device so the
 * app reopens where they left it. Storage failures fall back to defaults; a
 * preference must never break boot.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TournamentRow } from './leaderboard';
import { isRuleMode, type UiMode } from './modes';

const MODE_KEY = 'pitchSnakeMode';
const TOURNEY_KEY = 'pitchSnakeTourney';

/** What the screen restores on boot. */
export interface ModePrefs {
  uiMode: UiMode;
  tourney: TournamentRow | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asTourney(v: unknown): TournamentRow | null {
  if (!isRecord(v)) return null;
  const { code, title, mode, startsAt, endsAt } = v;
  if (
    typeof code !== 'string' ||
    typeof title !== 'string' ||
    !isRuleMode(mode) ||
    typeof startsAt !== 'string' ||
    typeof endsAt !== 'string'
  ) {
    return null;
  }
  return { code, title, mode, startsAt, endsAt };
}

/** Load the stored mode and tournament; sane defaults when unset or unreadable. */
export async function loadModePrefs(): Promise<ModePrefs> {
  try {
    const [m, t] = await Promise.all([AsyncStorage.getItem(MODE_KEY), AsyncStorage.getItem(TOURNEY_KEY)]);
    const tourney = t === null ? null : asTourney(JSON.parse(t));
    const uiMode: UiMode =
      m === 'classic' || m === 'speedrun' || m === 'survival' ? m
      : m === 'tourney' && tourney !== null ? 'tourney'
      : 'classic';
    return { uiMode, tourney };
  } catch {
    return { uiMode: 'classic', tourney: null };
  }
}

/** Persist the current choice; failures are swallowed. */
export async function saveModePrefs(prefs: ModePrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(MODE_KEY, prefs.uiMode);
    if (prefs.tourney === null) await AsyncStorage.removeItem(TOURNEY_KEY);
    else await AsyncStorage.setItem(TOURNEY_KEY, JSON.stringify(prefs.tourney));
  } catch {
    // a preference that fails to save is a preference for one session
  }
}
