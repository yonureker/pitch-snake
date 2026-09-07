/**
 * The player's profile: the five-character name the boards show and the flag
 * beside it.
 *
 * One row per user (`pitch_snake_profiles`), keyed by the user id and never by
 * the name, because the id is the identity. Names ARE unique though, case
 * insensitively, except the shared un-name YOU that every unnamed player
 * carries; `set_profile` refuses a taken one and `nameTaken` is the friendly
 * pre-check so a player learns before they press save.
 *
 * The country contract is `set_profile`'s and is easy to get wrong: null keeps
 * whatever flag is there, '' clears it, and a code sets it.
 *
 * @module
 */
import { rpc } from './leaderboard';

/** What the shell shows and edits. */
export interface Profile {
  name: string;
  country: string | null;
}

function asProfile(v: unknown): Profile | null {
  if (typeof v !== 'object' || v === null) return null;
  const r: Record<string, unknown> = { ...v };
  if (typeof r.name !== 'string') return null;
  return { name: r.name, country: typeof r.country === 'string' ? r.country : null };
}

/**
 * This device's profile, or null when nobody is signed in.
 *
 * @returns the row, or null when there is no session or no row yet.
 */
export async function fetchProfile(): Promise<Profile | null> {
  try {
    const row = await rpc('pitch_snake_get_profile', {});
    return asProfile(Array.isArray(row) ? row[0] : row);
  } catch {
    return null;
  }
}

/**
 * Is this name somebody else's?
 *
 * Washes exactly as the server does and never counts the caller's own row, so
 * renaming yourself to yourself is never "taken".
 *
 * @param name - the name as typed.
 * @returns true when another player already holds it.
 */
export async function nameTaken(name: string): Promise<boolean> {
  try {
    return (await rpc('pitch_snake_name_taken', { p_name: name })) === true;
  } catch {
    return false; // the server's own unique index is the real guard
  }
}

/** What a save can answer. */
export type SaveResult = 'saved' | 'taken' | 'error';

/**
 * Write the profile.
 *
 * @param name - five characters, washed server-side anyway.
 * @param country - null keeps the current flag, '' clears it, a code sets it.
 * @returns whether it landed, and why not when it did not.
 */
export async function saveProfile(name: string, country: string | null): Promise<SaveResult> {
  try {
    await rpc('pitch_snake_set_profile', { p_name: name, p_country: country });
    return 'saved';
  } catch (e) {
    const msg = e instanceof Error ? e.message.toLowerCase() : '';
    return msg.includes('taken') ? 'taken' : 'error';
  }
}
