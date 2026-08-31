/**
 * Validated rounds: the server decides the score. A seed is minted by
 * pitch_snake_issue_seed before a round starts, and the finished round goes
 * back as its input LOG to the validate-score edge function, which replays
 * it with the very same engine and computes the score itself. The number
 * this app holds is never what the board believes.
 * @module
 */
import type { RoundLog } from '@pitch-snake/engine';

import { authToken } from './auth';
import { rpc } from './leaderboard';
import type { RuleMode } from './modes';
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURED, SUPABASE_URL } from './supabase-config';

/** A server-minted seed and when this device pocketed it. */
export interface SeedTicket {
  id: number;
  seed: number;
  at: number;
}

// a type GUARD narrows without asserting, same idiom as the leaderboard layer
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Mint the next round's seed; null when the server is unreachable. */
export async function issueSeed(): Promise<SeedTicket | null> {
  if (!SUPABASE_CONFIGURED) return null;
  try {
    const r = await rpc('pitch_snake_issue_seed', {});
    if (isRecord(r)) {
      const { id, seed } = r;
      if (typeof id === 'number' && typeof seed === 'number') {
        return { id, seed: seed >>> 0, at: Date.now() };
      }
    }
  } catch {
    // no ticket: the round plays identically, it just cannot enter a board
  }
  return null;
}

// a replay plus an insert deserves more patience than a plain RPC
const VALIDATE_TIMEOUT_MS = 12000;

/** The validator's verdict; refused means the server said no (not retryable). */
export class ValidateError extends Error {
  refused: boolean;
  /**
   * Carry the verdict with the failure.
   * @param refused true for a 4xx verdict, false for wire trouble.
   */
  constructor(message: string, refused: boolean) {
    super(message);
    this.refused = refused;
  }
}

/** Submit a finished round's log; resolves to the row id and the SERVER's score. */
export async function validateRound(args: {
  seedId: number;
  mode: RuleMode;
  name: string;
  code?: string;
  log: RoundLog;
}): Promise<{ id: number; score: number }> {
  if (!SUPABASE_CONFIGURED) throw new ValidateError('not configured', false);
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, VALIDATE_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/validate-score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${authToken() ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(args),
      signal: ac.signal,
    });
    if (response.status >= 400 && response.status < 500) throw new ValidateError('refused', true);
    if (!response.ok) throw new ValidateError(`validate: ${String(response.status)}`, false);
    const out: unknown = await response.json();
    if (isRecord(out)) {
      const { id, score } = out;
      if (typeof id === 'number' && typeof score === 'number') return { id, score };
    }
    throw new ValidateError('unexpected response', false);
  } finally {
    clearTimeout(timer);
  }
}
