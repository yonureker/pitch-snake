/**
 * The leaderboard data layer: plain fetch against the two pitch_snake_ RPCs,
 * exactly like the web page (no supabase-js needed for anonymous RPC calls).
 * Every call carries an abort timer so a dead network can never hang the
 * FULL TIME screen. Components never call this directly; the TanStack Query
 * hooks in hooks/queries/ are the sanctioned wrappers.
 * @module
 */
import { isCountry } from '@pitch-snake/flags';

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

/** How many places a world board has. One source for the hundred. */
export const BOARD_PLACES = 100;

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
    if (!response.ok) {
      // Carry the server's OWN words, not just the status. PostgREST answers a
      // raised exception with {message}, and callers read it: set_profile's
      // 'That name is taken.' is a refusal to show the player, not a network
      // fault to apologise for. Falls back to the status when there is no body.
      let said = '';
      try {
        const body: unknown = await response.json();
        if (isRecord(body) && typeof body.message === 'string') said = body.message;
      } catch {
        // no JSON body; the status alone will have to do
      }
      throw new Error(said === '' ? `${fn}: HTTP ${String(response.status)}` : said);
    }
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

/**
 * The global top N for one rule mode, best first; server-ordered and limited.
 * `season` null is the all-time board (unchanged); a 'YYYY-MM' string windows
 * it to that UTC month, the same key the season ladder uses.
 */
export async function fetchTopScores(
  limit = 10,
  mode: RuleMode = 'classic',
  season: string | null = null,
): Promise<ScoreRow[]> {
  const rows = await rpc(
    'pitch_snake_top_scores',
    season === null ?
      { limit_count: limit, p_mode: mode }
    : { limit_count: limit, p_mode: mode, p_season: season },
  );
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

// ---- the ladder (ELO) ----

/** One rung of the ladder, as pitch_snake_top_rated describes it. */
export interface RatingRow {
  name: string;
  country: string | null;
  rating: number;
  /** fewer than ten rated rounds: listed and marked, the chess convention */
  provisional: boolean;
}

/** Your own standing per mode, from pitch_snake_my_rating; {} when unrated. */
export interface MyRating {
  rating: number;
  rounds: number;
  provisional: boolean;
}

/**
 * The world ladder. Rooms play and are rated as classic (ROOM_RULES in the
 * page), so that is the one pool the sheet asks for.
 */
export async function fetchTopRated(limit = 100): Promise<RatingRow[]> {
  const rows = await rpc('pitch_snake_top_rated', { p_mode: 'classic', p_limit: limit });
  if (!Array.isArray(rows)) return [];
  const list: unknown[] = rows;
  const out: RatingRow[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { name, country, rating, provisional } = r;
    if (typeof name === 'string' && typeof rating === 'number') {
      out.push({
        name,
        country: isCountry(country) ? country.toUpperCase() : null,
        rating,
        provisional: provisional === true,
      });
    }
  }
  return out;
}

/** Your own rating for rooms, or null when you have never been rated. */
export async function fetchMyRating(): Promise<MyRating | null> {
  const got = await rpc('pitch_snake_my_rating', {});
  if (!isRecord(got)) return null;
  const mine = got['classic'];
  if (!isRecord(mine)) return null;
  const { rating, rounds } = mine;
  if (typeof rating !== 'number' || typeof rounds !== 'number') return null;
  return { rating, rounds, provisional: rounds < 10 };
}

// ---- seasons (the monthly ladder) ----

/** The season ladder for one UTC month, the ELO board's this-month face. */
export async function fetchTopRatedSeason(season: string, limit = 100): Promise<RatingRow[]> {
  const rows = await rpc('pitch_snake_top_rated_season', {
    p_mode: 'classic',
    p_season: season,
    p_limit: limit,
  });
  if (!Array.isArray(rows)) return [];
  const list: unknown[] = rows;
  const out: RatingRow[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { name, country, rating, provisional } = r;
    if (typeof name === 'string' && typeof rating === 'number') {
      out.push({
        name,
        country: isCountry(country) ? country.toUpperCase() : null,
        rating,
        provisional: provisional === true,
      });
    }
  }
  return out;
}

/** Your season standing, with the net move this season (rating - base). */
export interface MyRatingSeason extends MyRating {
  gain: number;
}

/** Your own season rating for rooms this month, or null when unrated. */
export async function fetchMyRatingSeason(season: string): Promise<MyRatingSeason | null> {
  const got = await rpc('pitch_snake_my_rating_season', { p_season: season });
  if (!isRecord(got)) return null;
  const mine = got['classic'];
  if (!isRecord(mine)) return null;
  const { rating, rounds, gain } = mine;
  if (typeof rating !== 'number' || typeof rounds !== 'number') return null;
  return { rating, rounds, provisional: rounds < 10, gain: typeof gain === 'number' ? gain : 0 };
}

// ---- stats (all derive-on-read, caller-scoped) ----

/** One mode's solo record, from pitch_snake_my_stats. */
export interface SoloStats {
  games: number;
  avg: number;
  best: number;
}

/** Your solo record for a mode, lifetime or one season. */
export async function fetchMyStats(mode: RuleMode, season: string | null = null): Promise<SoloStats> {
  const got = await rpc(
    'pitch_snake_my_stats',
    season === null ? { p_mode: mode } : { p_mode: mode, p_season: season },
  );
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  if (!isRecord(got)) return { games: 0, avg: 0, best: 0 };
  return { games: n(got['games']), avg: n(got['avg']), best: n(got['best']) };
}

/** Your multiplayer record, from pitch_snake_my_mp_stats. */
export interface MpStats {
  played: number;
  won: number;
  lost: number;
  delta: number;
}

/** Your MP record, lifetime or one season. */
export async function fetchMyMpStats(season: string | null = null): Promise<MpStats> {
  const got = await rpc('pitch_snake_my_mp_stats', season === null ? {} : { p_season: season });
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  if (!isRecord(got)) return { played: 0, won: 0, lost: 0, delta: 0 };
  return { played: n(got['played']), won: n(got['won']), lost: n(got['lost']), delta: n(got['delta']) };
}

/** One opponent you have played, with the head-to-head record. */
export interface RivalRow {
  name: string;
  country: string | null;
  games: number;
  myWins: number;
  theirWins: number;
}

/** Recent opponents, most recent first, with the record against each. */
export async function fetchRecentOpponents(limit = 20): Promise<RivalRow[]> {
  const rows = await rpc('pitch_snake_recent_opponents', { p_limit: limit });
  if (!Array.isArray(rows)) return [];
  const list: unknown[] = rows;
  const out: RivalRow[] = [];
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { name, country, games, my_wins, their_wins } = r;
    if (typeof name === 'string') {
      out.push({
        name,
        country: isCountry(country) ? country.toUpperCase() : null,
        games: n(games),
        myWins: n(my_wins),
        theirWins: n(their_wins),
      });
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
