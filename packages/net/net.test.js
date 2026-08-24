// The netcode contract: N sessions over a lossy, laggy, reordering wire keep
// bit-identical timelines. The loopback bus runs whole rooms on a virtual
// clock, so latency, loss and gaps are deterministic and the suite never
// touches a network.
//
// Two boards are used deliberately: QUIET (no walls, score zero, so nothing
// can ever kill and rounds run as long as the test needs) for the mechanism
// tests, and survival for the one test that must see a full round end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, MODES } from '../engine/engine.js';
import { createSession, loopbackBus, foldHash, SNAP_KEEP, SNAP_EVERY } from './net.js';

const QUIET = { seed: 90210, tickMs: 100, wallsEnabled: false };

// a dense, deterministic tap stream: every ~650ms each player turns through
// an up/left/down/right cycle (each step perpendicular, so none is filtered)
function denseTaps(p, untilMs) {
  const CYCLE = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  const taps = [];
  let k = p;   // stagger the phase per player
  for (let t = 300 + p * 170; t < untilMs; t += 650) taps.push([t, ...CYCLE[k++ % 4]]);
  return taps;
}

// Build a room of n sessions over one bus and run it to endMs on a shared
// virtual clock, feeding each player its taps at the scripted instants.
function runRoom(n, busOpts, endMs, cfg, tapsOf) {
  const bus = loopbackBus(n, busOpts);
  const results = [];
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const game = createGame({ ...cfg, players: n });
    const r = { game, ended: 0, desync: null };
    results.push(r);
    sessions.push(createSession({
      game, myIdx: i, transport: bus.endpoints[i],
      onEnd: () => { r.ended++; },
      onDesync: (why) => { r.desync = why; },
    }));
  }
  const taps = Array.from({ length: n }, (_, i) => tapsOf(i));
  for (let now = 0; now <= endMs; now += 10) {
    bus.pump(now);
    for (let i = 0; i < n; i++) {
      for (const [at, x, y] of taps[i]) if (at === now) sessions[i].localDir(x, y);
      sessions[i].frame(now);
    }
  }
  return { bus, sessions, results };
}

// two timelines agree when their logs agree; the log IS the round
const logOf = r => JSON.stringify(r.game.log);

test('two sessions over 120ms latency converge on one timeline, rollbacks and all', () => {
  const { sessions, results } = runRoom(2, { latency: 120, jitter: 30, seed: 5 }, 30000,
    QUIET, i => denseTaps(i, 25000));
  for (const r of results) assert.equal(r.desync, null, 'no desync');
  assert.equal(logOf(results[0]), logOf(results[1]), 'both machines recorded the same round');
  assert.ok(results[0].game.log.inputs.length >= 60, 'the stream really carried traffic');
  assert.ok(sessions.every(s => s.stats.rollbacks > 0), 'latency actually forced rollbacks on both sides');
});

test('20% loss with heavy reorder still converges: the gap protocol repairs the wire', () => {
  const { sessions, results } = runRoom(2, { latency: 90, jitter: 140, drop: 0.2, seed: 11 }, 30000,
    QUIET, i => denseTaps(i, 25000));
  for (const r of results) assert.equal(r.desync, null, 'no desync despite the lossy wire');
  assert.equal(logOf(results[0]), logOf(results[1]));
  assert.ok(sessions.some(s => s.stats.needsSent > 0), 'losses actually triggered resend requests');
  assert.ok(sessions.some(s => s.stats.resends > 0), 'and the other side actually resent');
});

test('a full five-snake survival room over a mediocre wire ends identically everywhere', () => {
  const early = [
    [[200, 0, -1], [600, -1, 0], [1000, 0, 1]],
    [[250, 0, 1], [700, 1, 0], [1200, 0, -1]],
    [[300, 0, -1], [800, -1, 0]],
    [[350, 0, 1], [900, 1, 0]],
    [[400, 0, -1], [1100, 1, 0]],
  ];
  const { results } = runRoom(5, { latency: 150, jitter: 60, drop: 0.05, seed: 23 }, 90000,
    { seed: 4242, tickMs: 100, ...MODES.survival }, i => early[i]);
  for (const r of results) assert.equal(r.desync, null, 'no desync');
  assert.equal(results[0].game.alive, false, 'the survival pack ends the room');
  const first = logOf(results[0]);
  for (let i = 1; i < 5; i++) assert.equal(logOf(results[i]), first, `session ${i} matches session 0`);
  for (const r of results) assert.equal(r.ended, 1, 'every session called full time exactly once');
  assert.deepEqual(results[1].game.players.map(p => p.score), results[0].game.players.map(p => p.score));
  assert.deepEqual(results[1].game.players.map(p => p.diedAt), results[0].game.players.map(p => p.diedAt));
});

test('an input from beyond the snapshot horizon fails loudly, never silently forks', () => {
  const bus = loopbackBus(2, { latency: 0 });
  let why = null;
  const a = createSession({
    game: createGame({ ...QUIET, players: 2 }), myIdx: 0, transport: bus.endpoints[0],
    onDesync: w => { why = w; },
  });
  // a live peer beats alongside so a's sim actually runs the full 40s
  const b = createSession({
    game: createGame({ ...QUIET, players: 2 }), myIdx: 1, transport: bus.endpoints[1],
  });
  for (let now = 0; now <= 40000; now += 10) { bus.pump(now); a.frame(now); b.frame(now); }
  assert.ok(a.stats.rollbacks === 0 && !a.failed, 'a healthy quiet run so far');
  // hand-deliver a turn stamped way before the oldest keyframe a holds
  bus.endpoints[1].send({ t: 'i', v: 1, p: 1, s: 1, q: 100, x: 0, y: 1 });
  bus.pump(40010);
  a.frame(40010);
  assert.equal(why, 'horizon', 'the session refused to invent a timeline it cannot verify');
  assert.equal(a.failed, true);
  assert.ok(40000 / 10 - 100 > SNAP_KEEP * SNAP_EVERY, 'the stamp really was outside the horizon');
});

test('a silent peer stalls the sim; dropPeer releases it', () => {
  const bus = loopbackBus(2, { latency: 10 });
  const g0 = createGame({ ...QUIET, players: 2 });
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0] });
  const g1 = createGame({ ...QUIET, players: 2 });
  const s1 = createSession({ game: g1, myIdx: 1, transport: bus.endpoints[1] });
  // both run for 5s so beats flow, then peer 1 goes silent
  for (let now = 0; now <= 5000; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  const qAtSilence = g0.quanta;
  for (let now = 5010; now <= 12000; now += 10) { bus.pump(now); s0.frame(now); }
  assert.equal(s0.stalled, true, 'a live peer gone silent leashes the sim');
  assert.ok(g0.quanta - qAtSilence <= 300, `the sim held instead of running away (${g0.quanta - qAtSilence})`);
  s0.dropPeer(1);
  for (let now = 12010; now <= 13000; now += 10) { bus.pump(now); s0.frame(now); }
  assert.equal(s0.stalled, false, 'a departed peer no longer holds the room');
  assert.ok(g0.quanta > qAtSilence + 300, 'the sim runs again, their snake on rails');
});

test('desynced state hashes are caught by the beat exchange', () => {
  const bus = loopbackBus(2, { latency: 10 });
  const g0 = createGame({ ...QUIET, players: 2 });
  let why = null;
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0], onDesync: w => { why = w; } });
  const g1 = createGame({ ...QUIET, seed: QUIET.seed + 1, players: 2 });   // a subtly different machine
  const s1 = createSession({ game: g1, myIdx: 1, transport: bus.endpoints[1] });
  for (let now = 0; now <= 20000 && !why; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  assert.equal(why, 'hash', 'two different timelines cannot beat at each other for long');
});

test('foldHash is stable and spreads', () => {
  assert.equal(foldHash('pitch'), foldHash('pitch'));
  assert.notEqual(foldHash('pitch'), foldHash('snake'));
  assert.notEqual(foldHash('a'), foldHash('b'));
});
