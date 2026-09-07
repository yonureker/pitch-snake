/**
 * Identity, the invisible tier. Every player is signed in anonymously on
 * first launch so every score can carry a user id from day one; nobody ever
 * sees a login screen to play. "Signing in" later links a real identity onto
 * the SAME user id (verified end to end against a local stack), which is why
 * nothing anywhere keys on email or provider.
 *
 * Auth is a bonus, never a dependency: if the network is down or the
 * project's anonymous switch is off, `authToken()` stays null and every
 * request falls back to the publishable key, exactly as the app worked
 * before this file existed.
 * @module
 */
import { GoTrueClient } from '@supabase/auth-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config';

// Constructed lazily inside bootAuth, never at import time: the client
// touches AsyncStorage the moment it exists, and expo-router's static
// render imports this module in a node context where there is no storage
// to touch. Only a real device, inside an effect, ever builds it.
let client: GoTrueClient | null = null;

let token: string | null = null;

/** The session's bearer token, or null when playing without identity. */
export function authToken(): string | null {
  return token;
}

/** Who the session belongs to, as far as the shell needs to know. */
export interface AuthWho {
  /** signed in, but with no real identity linked yet */
  anonymous: boolean;
  /** the linked address, once there is one */
  email: string | null;
}

let who: AuthWho = { anonymous: true, email: null };

/** The current tier. Anonymous until an address is linked. */
export function authWho(): AuthWho {
  return who;
}

function readWho(session: { user?: { is_anonymous?: boolean; email?: string | null } } | null): void {
  const u = session?.user;
  who = { anonymous: u?.is_anonymous !== false, email: u?.email ?? null };
}

/**
 * Send a six-digit code to an address, to LINK it onto this same user id.
 *
 * The whole design rests on that id never changing, so the score history, the
 * coins and the rating a player already earned anonymously survive signing
 * in. An address that already belongs to somebody else answers 422
 * email_exists, and the caller switches this device to that account instead.
 *
 * @param email - where to send the code.
 * @returns 'sent' when a code is on its way, 'exists' when the address is
 *   already an account (sign in to it rather than linking), or 'error'.
 */
export async function sendEmailCode(email: string): Promise<'sent' | 'exists' | 'error'> {
  if (client === null) return 'error';
  try {
    const { error } = await client.updateUser({ email });
    if (error === null) return 'sent';
    const code = (error as { code?: string }).code ?? '';
    const msg = error.message.toLowerCase();
    if (code === 'email_exists' || msg.includes('already')) {
      const sw = await client.signInWithOtp({ email });
      return sw.error === null ? 'exists' : 'error';
    }
    return 'error';
  } catch {
    return 'error';
  }
}

/**
 * Finish the link (or the switch) with the code from the mail.
 *
 * @param email - the address the code went to.
 * @param code - the six digits.
 * @param mode - 'link' keeps this user id and adds the address; 'switch'
 *   moves the device onto the account that address already owns.
 * @returns whether the session is now that identity.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  mode: 'link' | 'switch',
): Promise<boolean> {
  if (client === null) return false;
  try {
    const { data, error } = await client.verifyOtp({
      email,
      token: code,
      type: mode === 'link' ? 'email_change' : 'email',
    });
    if (error !== null) return false;
    token = data.session ? data.session.access_token : token;
    readWho(data.session);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign out, then straight back in anonymously.
 *
 * The invisible tier must never lapse: a signed-out player still earns coins
 * and badges, they simply earn them as a NEW guest, and the old account keeps
 * everything it had.
 */
export async function signOutToAnon(): Promise<void> {
  if (client === null) return;
  try {
    await client.signOut();
    const session = (await client.signInAnonymously()).data.session;
    token = session ? session.access_token : null;
    readWho(session);
  } catch {
    // stay as we are; nothing here may cost anyone a round
  }
}

/**
 * Establish the silent session: reuse a stored one, else sign in anonymously.
 * Fire-and-forget from the shell; failures leave the app exactly as it was.
 */
export async function bootAuth(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    client ??= new GoTrueClient({
      url: `${SUPABASE_URL}/auth/v1`,
      headers: { apikey: SUPABASE_ANON_KEY },
      storageKey: 'snakeAuth',
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    });
    client.onAuthStateChange((_event, session) => {
      token = session ? session.access_token : null;
      readWho(session);
    });
    let session = (await client.getSession()).data.session;
    session ??= (await client.signInAnonymously()).data.session;
    token = session ? session.access_token : null;
    readWho(session);
  } catch {
    // no identity today; the game does not care
  }
}
