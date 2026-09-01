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
} from 'https://cdn.jsdelivr.net/gh/yonureker/pitch-snake@98905edb1a41e40ee60eea7b46049ba47fbf5256/packages/engine/engine.js';

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
};

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
    .insert({ name: clean, score, mode, user_id: uid, seed: Number(issued.seed) })
    .select('id')
    .single();
  if (error || !row) return refuse('insert failed', 500);
  return reply({ id: row.id, score }, 200);
});
