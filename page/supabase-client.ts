/**
 * The Supabase door: the one place the page speaks to the backend.
 *
 * OWNS the project URL, the publishable key, the per-request abort timer,
 * and the signed-in session token that every call carries. Everything the
 * page asks of the server (boards, rooms, the ladder, the shop, telemetry,
 * the validator) goes out through `supabaseRpc`, so there is exactly one
 * place where a timeout, a header or a key is decided.
 *
 * MUST NEVER decide what to do about a failure. It throws, and the caller
 * falls back, because "fall back to the device board" is a product rule and
 * belongs where the board is drawn, not in the transport. It also holds no
 * opinion about identity: it is TOLD the session token by the auth code and
 * stamps it, and a null token is a perfectly ordinary signed-out call.
 *
 * **The key here is meant to be public.** `sb_publishable_` names the
 * project to the Data API and nothing more. What makes that safe is that
 * every `pitch_snake_` table has RLS on with no policies and no grants, so
 * this key reaches exactly the `pitch_snake_` functions and nothing else.
 * Never put a secret key in this file, and never "fix" an access error by
 * adding a policy to those tables: the RPCs are the access. See the
 * leaderboard rules in the root CLAUDE.md.
 *
 * @module
 */

/** The project's REST and auth origin. */
export const SUPABASE_URL = 'https://vyqlwoqvsnxyziutmgqz.supabase.co';

/** The publishable key: public by design, and the tables behind it are shut. */
export const SUPABASE_KEY = 'sb_publishable_tbNA8JWlc3V9twrk2knWtg__g6-K8lj';

// A request that never answers must not leave FULL TIME sitting there with a
// dead SAVE button, so every call gets its own timer rather than trusting the
// network to give up.
const REQUEST_TIMEOUT_MS = 6000;

/**
 * Is there a backend to talk to at all?
 *
 * False on a fork with the keys stripped, which is a supported way to run
 * the game: every board path falls back to the browser's own list.
 *
 */
export function supabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

// Held here rather than in the page because `supabaseRpc` is the only thing
// that has to read it on every call. The auth code sets it and forgets it.
let currentSessionToken: string | null = null;

/**
 * The signed-in session token, or null when nobody is signed in.
 *
 */
export function sessionToken(): string | null {
  return currentSessionToken;
}

/**
 * Record the session token for every later call.
 *
 * @param token - from the auth client's session, or null on sign-out.
 *   Anything falsy clears it.
 */
export function setSessionToken(token: string | null | undefined): void {
  currentSessionToken = token || null;
}

/**
 * The Authorization value every request carries.
 *
 * A signed-out client sends the publishable key in its place, which is what
 * keeps the anonymous tier working: the same call shape, signed or not.
 *
 */
export function authorizationHeader(): string {
  return 'Bearer ' + (currentSessionToken || SUPABASE_KEY);
}

/**
 * Call one `pitch_snake_` RPC.
 *
 * The key goes in both headers with the same value, which is what a
 * publishable key allows and what a legacy anon key expects.
 *
 * @param fn - the function name, e.g. `pitch_snake_top_scores`.
 * @param args - its named arguments, sent as the JSON body.
 * @returns whatever the function returns, parsed. It is `unknown` on purpose:
 *   the server's shape is not the page's to assume, so every caller narrows.
 * @throws {Error} on a non-2xx answer (the message carries the status) or
 *   when the abort timer fires. Callers fall back; this never decides.
 */
export async function supabaseRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: authorizationHeader(),
      },
      body: JSON.stringify(args),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(fn + ': ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
