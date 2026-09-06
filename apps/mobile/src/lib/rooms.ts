/**
 * The rooms data layer: the realtime client, the room RPCs, and the round
 * report. The protocol is the web page's, verbatim: a room is a channel
 * named ps-<code> whose presence is the roster, whose 'lobby' broadcasts
 * carry kickoffs (sent by the SERVER through room_start's realtime.send),
 * and whose 'ready' broadcasts are the fast path presence cannot be. Seats
 * are claimed at kickoff, never at full time, and every peer reports its own
 * copy of the deterministic log so the server rates the majority's round.
 * Everything here is a bonus tier: a room that cannot reach any of it plays
 * the identical round and simply is not rated.
 * @module
 */
import { RealtimeClient } from '@supabase/realtime-js';

import type { RoundLog } from '@pitch-snake/engine';

import { authToken } from './auth';
import { rpc } from './leaderboard';
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from './supabase-config';

/** The fewest snakes a round seats. */
export const VS_MIN = 2;
/** The most snakes a round seats. */
export const VS_MAX = 5;

// The code alphabet: no 0/O/1/I, exactly what the server mints from. The
// entropy linter sees 32 opaque characters; it is a public alphabet.
// eslint-disable-next-line no-secrets/no-secrets
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let client: RealtimeClient | null = null;

/** The shared realtime client, built on first use. */
export function realtimeClient(): RealtimeClient | null {
  if (!SUPABASE_CONFIGURED) return null;
  client ??= new RealtimeClient(`${SUPABASE_URL.replace(/^https/, 'wss')}/realtime/v1`, {
    params: { apikey: SUPABASE_ANON_KEY },
  });
  return client;
}

/** Wash a room code to the server's shape; '' when hopeless. */
export function cleanCode(v: string): string {
  return v
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .replace(/[01IO]/g, '')
    .slice(0, 5);
}

/** Wash a player name the way every board does. */
export function cleanName(v: string): string {
  const n = v
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 5);
  return n === '' ? 'YOU' : n;
}

/**
 * A local code for the no-tier fallback, same alphabet as the server's. A
 * code only has to be SHARED and unlikely to collide tonight, so the clock
 * serves and no randomness is needed (app code bans Math.random near
 * gameplay, and a room code brackets a round).
 */
export function makeLocalCode(): string {
  let n = (Date.now() ^ Math.floor(performance.now() * 997)) >>> 0;
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length) ^ (n << 7);
    n >>>= 0;
  }
  return out;
}

/**
 * Which third of the world this device sits in, from its timezone: 'am',
 * 'eu' or 'as'. Coarse on purpose: a matchmaking preference, not identity.
 */
export function region(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz.startsWith('America/')) return 'am';
    if (/^(?:Europe|Africa|Atlantic)\//.test(tz)) return 'eu';
    if (/^(?:Asia|Australia|Pacific|Indian)\//.test(tz)) return 'as';
  } catch {
    // fall through to the offset
  }
  const east = -new Date().getTimezoneOffset() / 60;
  return (
    east <= -2 ? 'am'
    : east < 4 ? 'eu'
    : 'as'
  );
}

/** Ask the server for a fresh room code; null without the rooms tier. */
export async function roomCreate(): Promise<string | null> {
  try {
    const r = await rpc('pitch_snake_room_create', {});
    if (typeof r === 'string' && r.length === 5) return r;
  } catch {
    // no tier: the caller mints a local code instead
  }
  return null;
}

/** A quick-match seat: an open room near this region, or a fresh one. */
export async function roomQuickmatch(): Promise<{ code: string; created: boolean } | null> {
  try {
    const rows = await rpc('pitch_snake_room_quickmatch', { p_region: region() });
    const r: unknown = Array.isArray(rows) ? rows[0] : null;
    if (typeof r === 'object' && r !== null) {
      const { code, created } = r as { code?: unknown; created?: unknown };
      if (typeof code === 'string' && code.length === 5) return { code, created: created === true };
    }
  } catch {
    // quick match needs the tier; the caller says so
  }
  return null;
}

/** The acting host's kickoff. The server broadcasts the start to everyone. */
export async function roomStart(
  code: string,
  roster: { ref: string; name: string }[],
  engineVersion: number,
): Promise<boolean> {
  try {
    await rpc('pitch_snake_room_start', { p_code: code, p_roster: roster, p_ev: engineVersion });
    return true;
  } catch (e) {
    // a 404 means no rooms tier (caller falls back to a local kickoff);
    // any other refusal means somebody else's kickoff is already in flight
    return !(e instanceof Error && e.message.includes('404'));
  }
}

/** Keep the room row warm so quick match can see it breathing. Host only. */
export function roomTouch(code: string, count: number): void {
  void rpc('pitch_snake_room_touch', { p_code: code, p_count: count }).catch(() => undefined);
}

/**
 * Claim my seat at kickoff, before anybody knows which seat wins. Reads
 * auth.uid() server-side, so it can seat nobody else. Fire and forget.
 */
export function takeSeat(code: string, startN: number, seat: number, name: string): void {
  if (authToken() === null) return;
  void rpc('pitch_snake_take_seat', {
    p_code: code,
    p_start_n: startN,
    p_seat: seat,
    p_name: name,
  }).catch(() => undefined);
}

// a replay plus the rating write deserves the validator's own patience
const REPORT_TIMEOUT_MS = 12000;

/**
 * Report the finished room round: this peer's own copy of the shared log.
 * The server replays it, computes the finishing order, and rates the log a
 * majority of the seats agree on. Silent either way; nothing delays a
 * whistle.
 */
export function reportRoomRound(code: string, startN: number, log: RoundLog): void {
  if (!SUPABASE_CONFIGURED) return;
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, REPORT_TIMEOUT_MS);
  void fetch(`${SUPABASE_URL}/functions/v1/validate-score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${authToken() ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ room: { code, n: startN }, log }),
    signal: ac.signal,
  })
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timer);
    });
}
