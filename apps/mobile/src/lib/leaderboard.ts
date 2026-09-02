/**
 * The leaderboard data layer: plain fetch against the two pitch_snake_ RPCs,
 * exactly like the web page (no supabase-js needed for anonymous RPC calls).
 * Every call carries an abort timer so a dead network can never hang the
 * FULL TIME screen. Components never call this directly; the TanStack Query
 * hooks in hooks/queries/ are the sanctioned wrappers.
 * @module
 */
import { authToken } from './auth';
import { isRuleMode, type RuleMode } from './modes';
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from './supabase-config';

/** One row of the global board. */
export interface ScoreRow {
  id: number;
  name: string;
  score: number;
  /** ISO2, or null when the player has set no flag (or predates identity). */
  country: string | null;
}

/** How many places a world board has. One source for the ten. */
export const BOARD_PLACES = 10;

/**
 * Whether a score reaches the board, and so whether the round is worth asking
 * a name for. The board orders by score desc, created_at asc, so matching the
 * tenth is not reaching it: an equal score sorts behind the older row and has
 * to be beaten. A board with room takes anyone, which is why a missing tenth
 * is a yes. Lives here rather than in the screen because it is a fact about
 * the board's shape, and the rows it judges are fetched three lines down.
 */
export function placesOnBoard(rows: ScoreRow[], score: number): boolean {
  const tenth = rows[BOARD_PLACES - 1];
  return tenth === undefined || score > tenth.score;
}

const TIMEOUT_MS = 6000;

/** Shared by the validate layer; components still go through query hooks. */
export async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  if (!SUPABASE_CONFIGURED) throw new Error('leaderboard not configured');
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        // the silent session when there is one, so scores carry a user id;
        // the publishable key otherwise, exactly as before identity existed
        Authorization: `Bearer ${authToken() ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(args),
      signal: ac.signal,
    });
    if (!response.ok) throw new Error(`${fn}: HTTP ${String(response.status)}`);
    const data: unknown = await response.json();
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// a type GUARD narrows without asserting, which keeps no-unsafe-type-assertion
// honest about the one place data enters from the network
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A country is a two-letter code or it is nothing; junk renders no flag. */
function isCountry(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z]{2}$/i.test(v);
}

/**
 * Flags are artwork, not emoji. A regional-indicator pair is only a flag if
 * the platform ships flag glyphs, and several do not, so the same board
 * looked different depending on who read it. assets/flags.png is a 16-wide
 * grid of 60x45 cells in alphabetical code order (250 flags, flag-icons,
 * MIT), which means the index IS the position and no lookup table has to be
 * shipped or kept in step with the art.
 */
// no-secrets sees 500 opaque characters and high entropy, which is exactly
// what it is meant to catch. This is the public ISO-3166 alpha-2 list in
// alphabetical order, one country per two characters, and its shape IS the
// sprite's layout: it cannot be broken up or reordered without moving every
// flag. Disabled here deliberately rather than disguised.
export const FLAG_CODES =
  // eslint-disable-next-line no-secrets/no-secrets
  'ADAEAFAGAIALAMAOAQARASATAUAWAXAZBABBBDBEBFBGBHBIBJBLBMBNBOBQBRBSBTBVBWBYBZCACCCDCFCGCHCICKCLCMCNCOCRCUCVCWCXCYCZDEDJDKDMDODZECEEEGEHERESETFIFJFKFMFOFRGAGBGDGEGFGGGHGIGLGMGNGPGQGRGSGTGUGWGYHKHMHNHRHTHUIDIEILIMINIOIQIRISITJEJMJOJPKEKGKHKIKMKNKPKRKWKYKZLALBLCLILKLRLSLTLULVLYMAMCMDMEMFMGMHMKMLMMMNMOMPMQMRMSMTMUMVMWMXMYMZNANCNENFNGNINLNONPNRNUNZOMPAPEPFPGPHPKPLPMPNPRPSPTPWPYQARERORSRURWSASBSCSDSESGSHSISJSKSLSMSNSOSRSSSTSVSXSYSZTCTDTFTGTHTJTKTLTMTNTOTRTTTVTWTZUAUGUMUSUYUZVAVCVEVGVIVNVUWFWSXKYEYTZAZMZW';
/** Cells per row in the sprite; the grid is 16 wide by 16 tall. */
export const FLAG_COLS = 16;

// Read the pairs into a map once rather than searching the string. Not a
// micro-optimisation: indexOf finds the FIRST occurrence, and 98 of the 250
// codes also appear straddling two of their neighbours ('UG' sits inside
// 'GU' + 'GW' long before Uganda's own slot), so a search would answer with
// somebody else's flag or, once guarded against that, with none at all.
const FLAG_AT = new Map<string, number>();
for (let i = 0; i < FLAG_CODES.length; i += 2) FLAG_AT.set(FLAG_CODES.slice(i, i + 2), i / 2);

/** Grid position of a country in the sprite, or -1 when it has no flag. */
export function flagIndex(code: string | null): number {
  if (code === null) return -1;
  return FLAG_AT.get(code) ?? -1;
}

/** The global top N for one rule mode, best first; server-ordered, server-limited. */
export async function fetchTopScores(limit = 10, mode: RuleMode = 'classic'): Promise<ScoreRow[]> {
  const rows = await rpc('pitch_snake_top_scores', { limit_count: limit, p_mode: mode });
  if (!Array.isArray(rows)) return [];
  const list: unknown[] = rows;
  const out: ScoreRow[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { id, name, score, country } = r;
    if (typeof id === 'number' && typeof name === 'string' && typeof score === 'number') {
      out.push({ id, name, score, country: isCountry(country) ? country.toUpperCase() : null });
    }
  }
  return out;
}

// Submitting a score is no longer a thing any client can do: the server
// retired the client-score RPCs in favour of validated rounds (a seed from
// pitch_snake_issue_seed, the finished round's LOG to the validate-score
// edge function, which replays it and computes the score itself). When the
// app grows gameplay, its submit path is that validator, same as the page.

// ---- tournaments ----

/** One tournament, as the server describes it. Times are ISO strings. */
export interface TournamentRow {
  code: string;
  title: string;
  mode: RuleMode;
  startsAt: string;
  endsAt: string;
}

/** One row of a tournament board: best per name, so the name is the identity. */
export interface TournamentScoreRow {
  name: string;
  score: number;
  /** The flag of whoever holds this name's best, or null. */
  country: string | null;
}

function asTournament(r: unknown): TournamentRow | null {
  if (!isRecord(r)) return null;
  const { code, title, mode, starts_at: startsAt, ends_at: endsAt } = r;
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

/** Look up a tournament by its 6-character code; null when there is none. */
export async function fetchTournament(code: string): Promise<TournamentRow | null> {
  const rows = await rpc('pitch_snake_tournament_get', { p_code: code });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return asTournament(rows[0]);
}

/** Create a tournament that opens now; the server generates the code and the clock. */
export async function createTournament(args: {
  title: string;
  mode: RuleMode;
  durationMinutes: number;
}): Promise<TournamentRow> {
  const rows = await rpc('pitch_snake_tournament_create', {
    p_title: args.title,
    p_mode: args.mode,
    p_starts_in_minutes: 0,
    p_duration_minutes: args.durationMinutes,
  });
  const t = Array.isArray(rows) ? asTournament(rows[0]) : null;
  if (t === null) throw new Error('unexpected create response');
  return t;
}

/** A tournament's standings: each name's best, ranked. */
export async function fetchTournamentTop(code: string, limit = 10): Promise<TournamentScoreRow[]> {
  const rows = await rpc('pitch_snake_tournament_top', { p_code: code, limit_count: limit });
  if (!Array.isArray(rows)) return [];
  const list: unknown[] = rows;
  const out: TournamentScoreRow[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { name, score, country } = r;
    if (typeof name === 'string' && typeof score === 'number') {
      out.push({ name, score, country: isCountry(country) ? country.toUpperCase() : null });
    }
  }
  return out;
}

// Tournament submissions go through the validator too (same edge function,
// with the tournament code riding along); see the note above submitScore's
// old spot.
