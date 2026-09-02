// Pitch Snake: the validator. The client submits its round LOG against a
// server-issued seed (validate.sql), and THIS replays it with the very same
// engine the page plays with, computes the score itself, and writes the row.
// The browser's claimed score is not an input anywhere in this file.
//
// Deploy: Dashboard -> Edge Functions -> Deploy a new function -> name it
// exactly `validate-score`, paste this file, leave "Verify JWT" ON.
//
// The engine import is pinned to the commit that last touched engine.js, so
// the validator's rules are frozen and auditable. WHEN ENGINE_VERSION BUMPS:
// update the commit hash below and redeploy, or new-version logs will be
// refused ('log does not replay') and pages fall back to their device
// boards: degraded, never wrong.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  replay, MODES, SPEEDS, START_LEN,
} from 'https://cdn.jsdelivr.net/gh/yonureker/pitch-snake@cb1da11ff5830c821927bc7d71bca2241a8095e1/packages/engine/engine.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const reply = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const refuse = (error: string, status = 422) => reply({ error }, status);

// every knob a log may carry, with the classic default it means when absent
// (pre-v15 logs cannot carry them); a claimed mode must match exactly
const KNOBS: Record<string, unknown> = {
  durationMs: 0, startGhosts: 0, startBombs: 0, bombFirstMs: 0,
  scoreByTime: false, startLen: START_LEN,
  eatGrowth: 1, bonusGrowth: 5, tntGrowth: -5, portalGrowth: 0,
  ghostEveryMs: 0, bombEveryMs: 0, boltEveryMs: 0,
  // levels are the only rounds with a goal and they never submit, so a
  // submitted round claiming a board mode must carry none
  goalScore: 0,
};

// ---- the evidence trail ----
// The validator closes fabricated scores, edited memory, sped-up clients,
// replayed logs and seed shopping. It cannot close a bot that plays honestly
// well: that round IS real and IS honestly submitted. Catching one is a
// question about HOW it was played, and input timing is where the answer is.
//
// These are derived from the log this function already has in hand, so they
// cost nothing beyond the arithmetic, and they are stored as plain columns so
// the question can be asked in SQL without pulling logs back out.
//
// Nothing here judges. It records. Thresholds tuned against a population with
// no known bots in it would be guesses, and a published heuristic is a
// specification for evading it. The classifier comes later, from data.
//
// Measured before shipping, driving the real page through the real keyboard
// path against two synthetic bots (tick 130, so 13 quanta):
//
//                    gap_sd   align_top
//   real play         10.02       0.125
//   boundary bot       0.00       1.000
//   jittered bot       2.23       0.154
//
// So align_top catches only the naive bot, and gap_sd catches both. Neither
// is proof and both are one signal among several: a bot that jitters its
// timing AND its phase defeats this pair, and would need the path-repetition
// analysis that keeping the raw log makes possible later.
//
// One warning for whoever calibrates this. The v4 golden fixtures look
// wildly aligned (align_top near 1.0) because they were recorded by a
// SCRIPTED pilot advancing tick by tick, not by a person. They are not a
// human baseline and must never be used as one.
function timingFeatures(log: Record<string, unknown>) {
  const inputs = (log.inputs ?? []) as number[][];
  const tickQuanta = Math.max(1, Math.round((log.tickMs as number) / 10));
  const presses = inputs.length;
  if (presses === 0) {
    return { presses: 0, gap_mean: null, gap_sd: null, gap_min: null, align_top: null, apm: 0 };
  }

  // Where in the tick cycle each press landed. A human presses at arbitrary
  // wall-clock moments and spreads across every phase; a program driving
  // turns fires at a fixed offset from the cell boundary and piles onto one.
  const phase = new Array(tickQuanta).fill(0);
  let gapSum = 0, gapMin = Infinity, prev = -1, gaps = 0;
  for (const row of inputs) {
    const q = row[0];
    phase[((q % tickQuanta) + tickQuanta) % tickQuanta]++;
    if (prev >= 0) {
      const gap = q - prev;
      gapSum += gap; gaps++;
      if (gap < gapMin) gapMin = gap;
    }
    prev = q;
  }
  const mean = gaps ? gapSum / gaps : 0;
  // second pass for the spread: humans are jittery, machines are not
  let varSum = 0; prev = -1;
  for (const row of inputs) {
    if (prev >= 0) { const d = row[0] - prev - mean; varSum += d * d; }
    prev = row[0];
  }
  const sd = gaps ? Math.sqrt(varSum / gaps) : 0;
  const top = Math.max(...phase) / presses;
  const seconds = ((log.end as number) * 10) / 1000;

  return {
    presses,
    gap_mean: gaps ? +mean.toFixed(2) : null,
    gap_sd: gaps ? +sd.toFixed(2) : null,
    gap_min: gaps ? gapMin : null,
    align_top: +top.toFixed(4),
    apm: seconds > 0 ? +((presses / seconds) * 60).toFixed(2) : 0,
  };
}

// ---- achievements ----
// Granted HERE and nowhere else. They are about to carry coins and
// competitive tickets, which makes them currency, and a client that can award
// itself currency is a client that can print money. So the same rule as the
// score: the server replays the round and decides what happened.
//
// The catalogue lives in this file rather than the engine on purpose. Putting
// it in the engine would chain every new achievement to an ENGINE_VERSION
// bump and a re-pin of this very import, which is absurd for what is content.
// Nothing here affects a replay, so adding one is a redeploy and nothing else.
//
// `test` reads a context built once from the round the validator has already
// replayed: the finished game, and the event stream the replay retained.
// Counting is therefore free.
const ACHIEVEMENTS: { id: string; name: string; note: string; test: (c: Ctx) => boolean }[] = [
  { id: 'first-whistle', name: 'FIRST WHISTLE', note: 'You finished a round.',
    test: () => true },
  { id: 'ten-up', name: 'TEN UP', note: 'Ten in a single round.',
    test: (c) => c.mode !== 'survival' && c.score >= 10 },
  { id: 'half-century', name: 'HALF CENTURY', note: 'Fifty in a single round.',
    test: (c) => c.mode !== 'survival' && c.score >= 50 },
  { id: 'last-ditch', name: 'LAST DITCH', note: 'You flew into a wall and turned out of it.',
    test: (c) => c.saves >= 1 },
  { id: 'through-the-window', name: 'THROUGH THE WINDOW', note: 'You took a teleport trip.',
    test: (c) => c.hops >= 1 },
  { id: 'hat-trick', name: 'HAT-TRICK', note: 'Three window trips in one round.',
    test: (c) => c.hops >= 3 },
  { id: 'struck', name: 'STRUCK', note: 'You took a thunderbolt and dragged the pack with it.',
    test: (c) => c.zaps >= 1 },
  { id: 'clean-sheet', name: 'CLEAN SHEET', note: 'Fifteen without touching a single TNT.',
    test: (c) => c.mode !== 'survival' && c.score >= 15 && c.tnts === 0 },
  { id: 'the-full-ninety', name: 'THE FULL NINETY', note: 'Ninety seconds of survival.',
    test: (c) => c.mode === 'survival' && c.score >= 90 },
];

interface Ctx {
  mode: string; score: number; quanta: number; reason: string;
  saves: number; hops: number; zaps: number; tnts: number; eats: number; bonuses: number;
}

// One pass over the events the replay kept. `drainEvents` returns everything
// that happened, because a replay never drains as it goes.
function roundContext(game: Record<string, unknown>, mode: string): Ctx {
  const events = (game.drainEvents as () => Record<string, unknown>[])();
  const c: Ctx = {
    mode, score: game.score as number, quanta: game.quanta as number,
    reason: String(game.deadReason ?? ''),
    saves: 0, hops: 0, zaps: 0, tnts: 0, eats: 0, bonuses: 0,
  };
  for (const e of events) {
    switch (e.t) {
      case 'save': c.saves++; break;
      case 'hop': c.hops++; break;
      case 'zap': c.zaps++; break;
      case 'tnt': c.tnts++; break;
      case 'eat': c.eats++; if (e.bonus) c.bonuses++; break;
    }
  }
  return c;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return refuse('POST only', 405);
  const size = Number(req.headers.get('content-length') ?? 0);
  if (!size || size > 262144) return refuse('log too large');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return refuse('bad json'); }
  const seedId = body.seedId;
  const mode = body.mode;
  const name = body.name;
  const code = body.code;
  const log = body.log as Record<string, unknown> | null;
  if (!Number.isInteger(seedId) || typeof mode !== 'string' || !log || typeof log !== 'object') {
    return refuse('bad request');
  }

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // whose round this is: the caller's own session says, nobody else
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await service.auth.getUser(jwt);
  if (userErr || !userData?.user) return refuse('no session', 401);
  const uid = userData.user.id;

  // claim the seed: mine, unused, under two hours old, spent atomically.
  // A failed validation after this point burns it: one shot per seed.
  const { data: claimed, error: claimErr } = await service
    .from('pitch_snake_seeds')
    .update({ used_at: new Date().toISOString() })
    .eq('id', seedId)
    .eq('user_id', uid)
    .is('used_at', null)
    .gt('issued_at', new Date(Date.now() - 7_200_000).toISOString())
    .select('seed, issued_at');
  if (claimErr) return refuse('seed lookup failed', 500);
  if (!claimed || claimed.length !== 1) return refuse('unknown, expired or spent seed');
  const issued = claimed[0] as { seed: number; issued_at: string };

  // the log must be the round that seed was minted for: one snake, sane
  // size, solo input shape, and the very seed we handed out
  if ((log.players ?? 1) !== 1) return refuse('solo rounds only');
  const inputs = log.inputs;
  if (!Array.isArray(inputs) || inputs.length > 20000 ||
      !inputs.every((r) => Array.isArray(r) && r.length === 3 && r.every(Number.isInteger))) {
    return refuse('malformed inputs');
  }
  if (!Number.isInteger(log.end) || (log.end as number) <= 0 || (log.end as number) > 720000) {
    return refuse('implausible length');
  }
  if (((log.seed as number) >>> 0) !== Number(issued.seed)) return refuse('wrong seed');

  // the knobs must be exactly what the page can produce for the claimed
  // mode: the mode's own values, any of the three speeds, walls either way
  const m = (MODES as Record<string, Record<string, unknown>>)[mode];
  if (!m || mode === 'versus') return refuse('unknown mode');
  for (const [k, dflt] of Object.entries(KNOBS)) {
    if ((log[k] ?? dflt) !== (m[k] ?? dflt)) return refuse('knobs do not match the mode');
  }
  if (!Object.values(SPEEDS).includes(log.tickMs)) return refuse('unknown speed');
  if (typeof log.wallsEnabled !== 'boolean') return refuse('bad walls flag');

  // Real time must actually have passed: the round simulated end * 10ms,
  // and both clocks here are the server's own. Half a second of slack covers
  // the machinery; a real client's 3-second countdown alone dwarfs it, and
  // the seed is minted before the countdown even starts.
  const elapsed = Date.now() - Date.parse(issued.issued_at);
  if (elapsed + 500 < (log.end as number) * 10) return refuse('round faster than time itself');

  // the one judgment that matters: replay, and let the engine decide
  let game;
  try { game = replay(log); } catch { return refuse('log does not replay'); }
  if (game.alive) return refuse('round never ended');
  if (game.quanta !== log.end) return refuse('length mismatch');
  const score = game.score as number;
  if (score < -999 || score > (mode === 'speedrun' ? 300 : 9999)) return refuse('score out of range');

  // same name wash the SQL always applied
  const clean = String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'YOU';

  // only computed for a round that PASSED: a refused log is not evidence of
  // anything except a refused log, and it is never stored
  const feat = timingFeatures(log);

  if (typeof code === 'string' && code) {
    const { data: t } = await service
      .from('pitch_snake_tournaments')
      .select('id, mode, starts_at, ends_at')
      .eq('code', code.toUpperCase().trim())
      .maybeSingle();
    if (!t) return refuse('no such tournament');
    if (t.mode !== mode) return refuse('mode mismatch');
    const now = Date.now();
    if (now < Date.parse(t.starts_at) || now > Date.parse(t.ends_at)) return refuse('tournament is not open');
    const { data: row, error } = await service
      .from('pitch_snake_tournament_scores')
      .insert({ tournament_id: t.id, name: clean, score, user_id: uid, seed: Number(issued.seed) })
      .select('id')
      .single();
    if (error || !row) return refuse('insert failed', 500);
    return reply({ id: row.id, score }, 200);
  }

  const { data: row, error } = await service
    .from('pitch_snake_scores')
    .insert({ name: clean, score, mode, user_id: uid, seed: Number(issued.seed), log, ...feat })
    .select('id')
    .single();
  if (error || !row) return refuse('insert failed', 500);

  // Achievements last, and never fatal. The score is already written and a
  // player must never lose a validated round because the badge write had a
  // bad day; a missed achievement is recoverable on the next round, a lost
  // score is not.
  const earned = await grantAchievements(service, uid, mode, game, row.id);
  return reply({ id: row.id, score, earned }, 200);
});

async function grantAchievements(
  service: ReturnType<typeof createClient>,
  uid: string,
  mode: string,
  game: Record<string, unknown>,
  scoreId: number,
) {
  try {
    const ctx = roundContext(game, mode);
    const hit = ACHIEVEMENTS.filter((a) => a.test(ctx));
    if (hit.length === 0) return [];

    // What they already have, so 'earned' means NEWLY earned: the primary key
    // would swallow a repeat anyway, but the page announces what comes back
    // and announcing the same badge every round is noise, not a reward.
    const { data: had } = await service
      .from('pitch_snake_achievements')
      .select('achievement')
      .eq('user_id', uid)
      .in('achievement', hit.map((a) => a.id));
    const already = new Set((had ?? []).map((r: { achievement: string }) => r.achievement));
    const fresh = hit.filter((a) => !already.has(a.id));
    if (fresh.length === 0) return [];

    await service.from('pitch_snake_achievements').insert(
      fresh.map((a) => ({ user_id: uid, achievement: a.id, score_id: scoreId })),
    );
    return fresh.map((a) => ({ id: a.id, name: a.name, note: a.note }));
  } catch {
    return [];
  }
}
