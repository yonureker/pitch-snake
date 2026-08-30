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
    });
    let session = (await client.getSession()).data.session;
    session ??= (await client.signInAnonymously()).data.session;
    token = session ? session.access_token : null;
  } catch {
    // no identity today; the game does not care
  }
}
