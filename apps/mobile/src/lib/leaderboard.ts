/**
 * The leaderboard data layer: plain fetch against the two pitch_snake_ RPCs,
 * exactly like the web page (no supabase-js needed for anonymous RPC calls).
 * Every call carries an abort timer so a dead network can never hang the
 * FULL TIME screen. Components never call this directly; the TanStack Query
 * hooks in hooks/queries/ are the sanctioned wrappers.
 * @module
 */
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from './supabase-config';

/** One row of the global board. */
export interface ScoreRow {
  id: number;
  name: string;
  score: number;
}

const TIMEOUT_MS = 6000;

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
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
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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

/** The global top N, best first; server-ordered, server-limited. */
export async function fetchTopScores(limit = 10): Promise<ScoreRow[]> {
  const rows = await rpc('pitch_snake_top_scores', { limit_count: limit });
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

/**
 * Submit one finished round. The server squashes the name to five A-Z0-9 and
 * refuses impossible scores; the returned id identifies the new row so the
 * board can highlight it.
 */
export async function submitScore(name: string, score: number): Promise<number> {
  const id = await rpc('pitch_snake_submit_score', { p_name: name, p_score: score });
  if (typeof id !== 'number') throw new Error('unexpected submit response');
  return id;
}
