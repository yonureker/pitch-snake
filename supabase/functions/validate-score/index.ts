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
} from 'https://cdn.jsdelivr.net/gh/yonureker/pitch-snake@666b86dc1cb24ffc8a7ef75b9dddaa49804877d7/packages/engine/engine.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const reply = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const refuse = (error: string, status = 422) => reply({ error }, status);

// every knob a log may carry, with the CURRENT classic default it means when
// absent (since v22 a classic TNT and a teleport trip both grow five, so
// tntGrowth and portalGrowth default 5 here; pre-v15 logs that carried
// neither are museum pieces only replay() ever sees, and it keeps its own
// backward-compat defaults). A claimed mode must match exactly.
const KNOBS: Record<string, unknown> = {
  durationMs: 0, startGhosts: 0, startBombs: 0, bombFirstMs: 0,
  scoreByTime: false, startLen: START_LEN,
  eatGrowth: 1, bonusGrowth: 5, tntGrowth: 5, portalGrowth: 5,
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
// `coins` is the one-time bounty a badge pays into the ledger when it is
// granted, in the same pass and nowhere else. Amounts are content, like the
// names: changing one is a redeploy, and it changes only what FUTURE grants
// pay (economy.sql's backfill was a snapshot, not a subscription).
const ACHIEVEMENTS: { id: string; name: string; note: string; coins: number; test: (c: Ctx) => boolean }[] = [
  { id: 'first-whistle', name: 'FIRST WHISTLE', note: 'You finished a round.', coins: 25,
    test: () => true },
  { id: 'ten-up', name: 'TEN UP', note: 'Ten in a single round.', coins: 30,
    test: (c) => c.mode !== 'survival' && c.score >= 10 },
  { id: 'half-century', name: 'HALF CENTURY', note: 'Fifty in a single round.', coins: 100,
    test: (c) => c.mode !== 'survival' && c.score >= 50 },
  { id: 'last-ditch', name: 'LAST DITCH', note: 'You flew into a wall and turned out of it.', coins: 40,
    test: (c) => c.saves >= 1 },
  { id: 'through-the-window', name: 'THROUGH THE WINDOW', note: 'You took a teleport trip.', coins: 40,
    test: (c) => c.hops >= 1 },
  { id: 'hat-trick', name: 'HAT-TRICK', note: 'Three window trips in one round.', coins: 75,
    test: (c) => c.hops >= 3 },
  { id: 'struck', name: 'STRUCK', note: 'You took a thunderbolt and dragged the pack with it.', coins: 50,
    test: (c) => c.zaps >= 1 },
  { id: 'clean-sheet', name: 'CLEAN SHEET', note: 'Fifteen without touching a single TNT.', coins: 75,
    test: (c) => c.mode !== 'survival' && c.score >= 15 && c.tnts === 0 },
  { id: 'the-full-ninety', name: 'THE FULL NINETY', note: 'Ninety seconds of survival.', coins: 100,
    test: (c) => c.mode === 'survival' && c.score >= 90 },
];

// ---- the mint ----
// Coins exist so achievements and honest rounds can pay for cosmetics, and
// they are minted HERE and nowhere else, for the reason the comment above
// gives about currency. Both mints are idempotent by the ledger's unique
// (user, reason, ref): a badge pays once per badge id, a round once per
// seed, so a retry of this whole request cannot pay twice. Never fatal, the
// achievements rule: a player must not lose a validated score because the
// bank had a bad day, and a missed payment is recoverable where a lost
// score is not.
//
// The round pay is one coin per five points (seconds in survival), capped
// at forty, floored at nothing for a scoreless round. Deliberately modest:
// coins buy paint, but a number that inflates is a number that stops
// meaning anything.
async function payRound(
  service: ReturnType<typeof createClient>,
  uid: string,
  seed: number,
  score: number,
): Promise<number> {
  const delta = Math.min(40, Math.floor(Math.max(0, score) / 5));
  if (delta <= 0) return 0;
  try {
    // no generated database types here, so the table handle collapses to
    // never: one narrow cast, the same trade the rpc calls make
    const ledger = service.from('pitch_snake_coins') as unknown as {
      insert: (rows: Record<string, unknown>[]) => Promise<{ error: unknown }>;
    };
    const { error } = await ledger.insert([
      { user_id: uid, delta, reason: 'round', ref: String(seed) },
    ]);
    return error ? 0 : delta;
  } catch {
    return 0;
  }
}

interface Ctx {
  mode: string; score: number; quanta: number; reason: string;
  saves: number; hops: number; zaps: number; tnts: number; eats: number; bonuses: number;
}

// ---- room rounds ----
// A rated round is one the SERVER set up, seated and scored. rooms.sql mints
// the seed and writes the round of record at kickoff; each peer claims its own
// seat by auth.uid() while nobody yet knows who will win; and the finishing
// order below comes from a replay rather than from anyone's word for it.
//
// Nothing here writes a score row. A room result is not a solo board score and
// must never become one: the boards are per-player rounds against a seed minted
// for that player, and a five-way race is a different thing that happens to
// produce numbers.

// A stable fingerprint of the round, computed from what the round IS rather
// than from how it was serialised: two peers holding the same deterministic
// round agree here even if their JSON does not. This is what lets the ladder
// require corroboration, which is the only defence against a peer fabricating
// a different log against the same real seed, in which it wins.
function logFingerprint(log: Record<string, unknown>): number {
  const inputs = (log.inputs ?? []) as number[][];
  let h = 2166136261 >>> 0;
  const mix = (v: number) => {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(log.seed as number);
  mix(log.tickMs as number);
  mix((log.players ?? 1) as number);
  mix(log.end as number);
  mix(log.wallsEnabled ? 1 : 0);
  // The knobs, not only the inputs. Agreement has to cover the RULES the
  // round was played under, or the same presses submitted under a different
  // ruleset would corroborate the real round while being rated in another
  // pool. Booleans and numbers alike, in the fixed order KNOBS declares.
  for (const [k, dflt] of Object.entries(KNOBS)) {
    const v = log[k] ?? dflt;
    mix(typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));
  }
  for (const row of inputs) for (const v of row) mix(v);
  // Postgres has no unsigned integer, and the column is bigint: keep it
  // positive rather than letting the sign flip on the way across.
  return h;
}

// Which mode a room played, read off the log's own knobs instead of taken
// from the caller. A room's mode was never sent to the server, and asking the
// client for it now would be asking the loser to describe the match.
function modeFromKnobs(log: Record<string, unknown>): string | null {
  for (const [name, m] of Object.entries(MODES as Record<string, Record<string, unknown>>)) {
    if (name === 'versus') continue;
    let fits = true;
    for (const [k, dflt] of Object.entries(KNOBS)) {
      if ((log[k] ?? dflt) !== (m[k] ?? dflt)) { fits = false; break; }
    }
    if (fits) return name;
  }
  return null;
}

// Exactly the order the room itself showed its players: score descending,
// then whoever lasted longer. A rating that disagrees with the results screen
// the players just read is a rating nobody will believe.
//
// `place` is carried explicitly rather than left as the position in the
// array, because EQUAL SCORES ON THE SAME QUANTUM ARE A DRAW and must rate
// as one. Two snakes walking into the same wall on the same tick with the
// same score is not a rare curiosity here: it is what an untouched room does
// within seven seconds. Ranking by array position would hand that to
// whichever seat sorted first, which is a coin toss the loser can see.
// Competition ranking, so a shared first place is followed by third.
function placingsOf(game: { players: { idx: number; score: number; diedAt: number }[] }) {
  const rows = game.players
    .map((p) => ({ seat: p.idx, score: p.score, diedAt: p.diedAt, place: 1 }))
    .sort((a, b) => b.score - a.score || b.diedAt - a.diedAt || a.seat - b.seat);
  for (let i = 0; i < rows.length; i++) {
    const prev = i > 0 ? rows[i - 1] : null;
    rows[i].place = prev && prev.score === rows[i].score && prev.diedAt === rows[i].diedAt
      ? prev.place
      : i + 1;
  }
  return rows;
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
  const room = body.room as { code?: unknown; n?: unknown } | undefined;
  const log = body.log as Record<string, unknown> | null;
  if (!log || typeof log !== 'object') return refuse('bad request');

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // whose round this is: the caller's own session says, nobody else
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await service.auth.getUser(jwt);
  if (userErr || !userData?.user) return refuse('no session', 401);
  const uid = userData.user.id;

  if (room) return await roomRound(service, uid, room, log);

  // A solo or tournament round from here: it needs the seed ticket minted for
  // this player and the mode it claims to have been played under. A room
  // round has neither, which is why the branch above comes first.
  if (!Number.isInteger(seedId) || typeof mode !== 'string') return refuse('bad request');

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
  // Each row is [quantum, x, y], and (x, y) must be exactly one unit step.
  // The engine rejects non-unit vectors too, but that is only as current as
  // the pinned import; checking here closes a striding-head log server-side
  // regardless of which engine commit this function runs.
  if (!Array.isArray(inputs) || inputs.length > 20000 ||
      !inputs.every((r) => Array.isArray(r) && r.length === 3 && r.every(Number.isInteger) &&
        Math.abs(r[1]) + Math.abs(r[2]) === 1)) {
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
    // a tournament round is a validated round like any other; it pays the
    // same, keyed by the same single-use seed
    const coins = await payRound(service, uid, Number(issued.seed), score);
    return reply({ id: row.id, score, coins }, 200);
  }

  const { data: row, error } = await service
    .from('pitch_snake_scores')
    .insert({ name: clean, score, mode, user_id: uid, seed: Number(issued.seed), log, ...feat })
    .select('id')
    .single();
  if (error || !row) return refuse('insert failed', 500);

  // Achievements and coins last, and never fatal. The score is already
  // written and a player must never lose a validated round because the badge
  // or bank write had a bad day; a missed grant is recoverable on the next
  // round, a lost score is not.
  const earned = await grantAchievements(service, uid, mode, game, row.id);
  const coins = await payRound(service, uid, Number(issued.seed), score);
  return reply({ id: row.id, score, earned, coins }, 200);
});

/**
 * A finished room round, reported by one of the people who played it.
 *
 * The shape of the trust here is different from a solo score and worth
 * stating. Solo: the server minted a seed for THIS player, so a valid log
 * against it can only have come from them. Room: the server minted one seed
 * for the whole room and recorded the round before kickoff, so a valid log
 * proves the round happened but not who is reporting it. That gap is closed
 * from two directions, neither of which is this function's replay:
 *
 *   the seat, claimed at kickoff by each player's own session, before anyone
 *   knows which seat is going to win; and
 *
 *   corroboration, since every peer holds a byte-identical copy of a
 *   deterministic round, so pitch_snake_seal_round rates only the log a
 *   majority of the seats reported.
 *
 * What this function contributes is the finishing order, computed from a
 * replay, and a fingerprint of the log it computed it from.
 */
async function roomRound(
  service: ReturnType<typeof createClient>,
  uid: string,
  room: { code?: unknown; n?: unknown },
  log: Record<string, unknown>,
) {
  const code = typeof room.code === 'string' ? room.code.toUpperCase().trim() : '';
  const startN = typeof room.n === 'number' ? room.n : NaN;
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code) || !Number.isInteger(startN)) {
    return refuse('bad room round');
  }

  // The round the SERVER wrote at kickoff. Nothing the caller says can
  // conjure one: no row, no rating, and no argument about it.
  const { data: found } = await service
    .from('pitch_snake_rounds')
    .select('id, seed, players, started_at, sealed_at')
    .eq('code', code)
    .eq('start_n', startN)
    .maybeSingle();
  // The client carries no generated database types, so a select's row type
  // collapses to never; name the shape here rather than reaching into it.
  const rnd = found as unknown as {
    id: number; seed: number; players: number; started_at: string; sealed_at: string | null;
  } | null;
  if (!rnd) return refuse('no such round');
  if (rnd.sealed_at) return refuse('round already sealed');

  const players = log.players;
  if (!Number.isInteger(players) || (players as number) < 2 || (players as number) > 5) {
    return refuse('not a room round');
  }
  if (players !== rnd.players) return refuse('seat count does not match the room');
  if (((log.seed as number) >>> 0) !== Number(rnd.seed)) return refuse('wrong seed');

  // FOUR, not three. The engine stamps a solo turn as [quantum, x, y] and a
  // room turn as [quantum, x, y, player], because a room has to say whose
  // turn it was. Copying the solo shape here refused every real room round
  // with 'malformed inputs', and nothing but a live round could have shown
  // it: a synthetic placings blob never goes near the log.
  const inputs = log.inputs;
  // [quantum, x, y, seat]: (x, y) exactly one unit step (see the solo path),
  // seat a real slot in this room.
  if (!Array.isArray(inputs) || inputs.length > 60000 ||
      !inputs.every((r) =>
        Array.isArray(r) && r.length === 4 && r.every(Number.isInteger) &&
        Math.abs(r[1]) + Math.abs(r[2]) === 1 &&
        r[3] >= 0 && r[3] < (players as number))) {
    return refuse('malformed inputs');
  }
  if (!Number.isInteger(log.end) || (log.end as number) <= 0 || (log.end as number) > 720000) {
    return refuse('implausible length');
  }
  if (!Object.values(SPEEDS).includes(log.tickMs)) return refuse('unknown speed');
  if (typeof log.wallsEnabled !== 'boolean') return refuse('bad walls flag');

  const mode = modeFromKnobs(log);
  if (!mode) return refuse('knobs match no mode');

  // Same wall-clock floor the solo path uses, against the room's own kickoff
  // rather than a personal seed: the round simulated end * 10ms and both
  // clocks are the server's. A bot cannot simulate faster than time.
  const elapsed = Date.now() - Date.parse(rnd.started_at);
  if (elapsed + 500 < (log.end as number) * 10) return refuse('round faster than time itself');

  let played;
  try { played = replay(log); } catch { return refuse('log does not replay'); }
  const game = played as unknown as {
    alive: boolean; quanta: number;
    players: { idx: number; score: number; diedAt: number }[];
  };
  if (game.alive) return refuse('round never ended');
  if (game.quanta !== log.end) return refuse('length mismatch');

  // Same reason as the select above: no generated types, so rpc's argument
  // type collapses to undefined. One narrow cast beats `any` on the client.
  const rpc = service.rpc.bind(service) as unknown as
    (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const placings = placingsOf(game);
  const { data: verdict, error } = await rpc('pitch_snake_record_round', {
    p_round: rnd.id,
    p_user: uid,
    p_mode: mode,
    p_placings: placings,
    p_hash: logFingerprint(log),
  });
  if (error) return refuse('record failed', 500);
  // 'no seat' is the ordinary answer for a player who was signed out at
  // kickoff, and not an error worth surfacing in a game: the round happened,
  // it simply does not count towards a ladder nobody entered.
  if (verdict !== 'ok') return reply({ rated: false, reason: verdict }, 200);
  return reply({ rated: true, mode, placings }, 200);
}

async function grantAchievements(
  service: ReturnType<typeof createClient>,
  uid: string,
  mode: string,
  game: Record<string, unknown>,
  scoreId: number,
) {
  try {
    // Mirror the catalogue for the shelf. The page has to be able to show
    // the badges you have NOT earned, and a hand-kept second copy of this
    // list is the flag-sprite mistake: one artefact in two places, drifting
    // in silence. Pushed from the source of truth instead, so the mirror is
    // never more than one validated round stale. Display only; nothing over
    // there decides a grant, and a failure here must not cost a score.
    const rpcSync = service.rpc.bind(service) as unknown as
      (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    await rpcSync('pitch_snake_sync_achievements', {
      p_list: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, note: a.note, coins: a.coins })),
    });

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
    // The bounty, in the same pass as the grant it belongs to, in its OWN
    // try: a bank failure must not eat the badge announcement the player
    // just earned. The ledger's unique (user, 'achievement', id) means no
    // badge pays twice however this is retried.
    try {
      const paid = fresh.filter((a) => a.coins > 0)
        .map((a) => ({ user_id: uid, delta: a.coins, reason: 'achievement', ref: a.id }));
      if (paid.length) await service.from('pitch_snake_coins').insert(paid);
    } catch { /* recoverable by a repair pass; the grant row is the truth */ }
    return fresh.map((a) => ({ id: a.id, name: a.name, note: a.note, coins: a.coins }));
  } catch {
    return [];
  }
}
