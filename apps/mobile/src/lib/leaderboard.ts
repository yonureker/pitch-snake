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

/** The global top N for one rule mode, best first; server-ordered, server-limited. */
export async function fetchTopScores(limit = 10, mode: RuleMode = 'classic'): Promise<ScoreRow[]> {
  const rows = await rpc('pitch_snake_top_scores', { limit_count: limit, p_mode: mode });
  if (!Array.isArray(rows)) return [];
  const list: unknown[] = rows;
  const out: ScoreRow[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { id, name, score } = r;
    if (typeof id === 'number' && typeof name === 'string' && typeof score === 'number') {
      out.push({ id, name, score });
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
    const { name, score } = r;
    if (typeof name === 'string' && typeof score === 'number') out.push({ name, score });
  }
  return out;
}

// Tournament submissions go through the validator too (same edge function,
// with the tournament code riding along); see the note above submitScore's
// old spot.
