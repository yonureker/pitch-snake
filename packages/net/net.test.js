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

test('20% loss with heavy reorder still converges, healed mostly by input ballast', () => {
  const { sessions, results } = runRoom(2, { latency: 90, jitter: 140, drop: 0.2, seed: 11 }, 30000,
    QUIET, i => denseTaps(i, 25000));
  for (const r of results) assert.equal(r.desync, null, 'no desync despite the lossy wire');
  assert.equal(logOf(results[0]), logOf(results[1]));
  assert.ok(sessions.some(s => s.stats.patched > 0),
    'dropped inputs were healed by the next packet\'s ballast, no round trip');
});

test('a loss burst deeper than the ballast still converges via the resend path', () => {
  // 40% sustained loss sits past the ballast (three in a row all lost) but
  // inside the repair envelope; beyond ~50% the beat/need/resend chain itself
  // drowns and the session is DESIGNED to fail loudly instead of forking
  const { sessions, results } = runRoom(2, { latency: 80, jitter: 60, drop: 0.4, seed: 7 }, 40000,
    QUIET, i => denseTaps(i, 32000));
  for (const r of results) assert.equal(r.desync, null, 'no desync at 40% loss');
  assert.equal(logOf(results[0]), logOf(results[1]));
  assert.ok(sessions.some(s => s.stats.needsSent > 0), 'deep gaps actually triggered resend requests');
  assert.ok(sessions.some(s => s.stats.resends > 0), 'and the other side actually resent');
});

test('a press between frames advances the sim and stamps the true instant', () => {
  const bus = loopbackBus(2, { latency: 10 });
  const g0 = createGame({ ...QUIET, players: 2 });
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0] });
  const g1 = createGame({ ...QUIET, players: 2 });
  const s1 = createSession({ game: g1, myIdx: 1, transport: bus.endpoints[1] });
  for (let now = 0; now <= 1000; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  assert.equal(g0.quanta, 100);
  s0.localDir(0, -1, 1015);                    // pressed 15ms after the last frame
  assert.equal(g0.quanta, 101, 'the sim caught up to the press before stamping');
  const mine = s0._debug.table[0];
  assert.equal(mine[mine.length - 1].q, 102, 'stamped for the quantum after the press instant');
  // and the room still converges to one timeline afterward
  for (let now = 1020; now <= 8000; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  assert.equal(JSON.stringify(g0.log), JSON.stringify(g1.log));
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

test('a dead rival going quiet never leashes the survivor', () => {
  const bus = loopbackBus(2, { latency: 10 });
  const g0 = createGame({ ...QUIET, players: 2 });
  const g1 = createGame({ ...QUIET, players: 2 });
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0] });
  const s1 = createSession({ game: g1, myIdx: 1, transport: bus.endpoints[1] });
  for (let now = 0; now <= 3000; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  // the rival falls on both machines at the same quantum, as the shared sim
  // would decide, and then their client goes dark, spectator-style
  for (const g of [g0, g1]) {
    const p = g.players[1];
    p.alive = false; p.deadReason = 'wall'; p.diedAt = g.quanta;
    p.snake.length = 0; p.snakeSet.clear();
  }
  const qAt = g0.quanta;
  let everStalled = false;
  for (let now = 3010; now <= 12000; now += 10) {
    bus.pump(now); s0.frame(now);
    if (s0.stalled) everStalled = true;
  }
  assert.equal(everStalled, false, 'a dead snake has no inputs left to wait for');
  assert.ok(!g0.alive || g0.quanta > qAt + 600, 'the survivor kept playing (or clinched)');
});

test('a LIVE peer gone silent leashes only until the give-up window', () => {
  const bus = loopbackBus(2, { latency: 10 });
  const g0 = createGame({ ...QUIET, players: 2 });
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0] });
  const g1 = createGame({ ...QUIET, players: 2 });
  const s1 = createSession({ game: g1, myIdx: 1, transport: bus.endpoints[1] });
  for (let now = 0; now <= 5000; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  let now = 5010;
  for (; now <= 9000; now += 10) { bus.pump(now); s0.frame(now); }
  assert.equal(s0.stalled, true, 'fresh silence from a live snake holds the room');
  const qHeld = g0.quanta;
  for (; now <= 20000; now += 10) { bus.pump(now); s0.frame(now); }
  assert.equal(s0.stalled, false, 'past the give-up window nobody waits for a vanished client');
  assert.ok(g0.quanta > qHeld + 400, 'the sim ran on, their snake on the rails');
});

test('a peer written off as gone still gets their turns applied when they return', () => {
  // Presence-driven `gone` is a LOCAL guess reached at different moments by
  // different clients (a socket blip looks like a departure). If it silenced
  // a returning player's inputs, the client that wrote them off would run a
  // different timeline from the one that did not: a fork dressed as a
  // reconnect. Pacing may differ between peers; WHICH inputs land may not.
  const bus = loopbackBus(2, { latency: 20 });
  const g0 = createGame({ ...QUIET, players: 2 });
  const g1 = createGame({ ...QUIET, players: 2 });
  let why0 = null, why1 = null;
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0], onDesync: w => { why0 = w; } });
  const s1 = createSession({ game: g1, myIdx: 1, transport: bus.endpoints[1], onDesync: w => { why1 = w; } });
  for (let now = 0; now <= 3000; now += 10) { bus.pump(now); s0.frame(now); s1.frame(now); }
  s0.dropPeer(1);                                   // "they left" (they did not)
  for (let now = 3010; now <= 6000; now += 10) {
    bus.pump(now);
    if (now === 4000) s1.localDir(0, -1, now);      // ...and then they turn
    if (now === 4700) s1.localDir(-1, 0, now);
    s0.frame(now); s1.frame(now);
  }
  assert.equal(why0, null, 'no desync on the client that wrote them off');
  assert.equal(why1, null, 'nor on the returning client');
  assert.equal(JSON.stringify(g0.log), JSON.stringify(g1.log), 'one timeline, not two');
  assert.equal(g0.log.inputs.filter(e => e[3] === 1).length, 2, 'both of their turns are in the record');
  // the two sims may sit a few quanta apart (pacing is local), so compare the
  // heading their turns produced rather than a position
  assert.deepEqual(g0.players[1].dir, { x: -1, y: 0 }, 'their turns steered their snake here too');
  assert.deepEqual(g1.players[1].dir, { x: -1, y: 0 });
  assert.equal(s0.stalled, false, 'and being gone still means nobody waits for them');
});

test('junk on the wire is refused without taking the session down', () => {
  // anyone with the room code can broadcast; a malformed slot used to reach
  // a missing bucket and throw out of the socket handler
  const bus = loopbackBus(2, { latency: 0 });
  const g0 = createGame({ ...QUIET, players: 2 });
  let why = null;
  const s0 = createSession({ game: g0, myIdx: 0, transport: bus.endpoints[0], onDesync: w => { why = w; } });
  for (let now = 0; now <= 500; now += 10) { bus.pump(now); s0.frame(now); }
  const before = JSON.stringify(g0.log);
  for (const junk of [
    { t: 'i', v: 1, s: 1, q: 10, x: 0, y: 1 },                       // no slot at all
    { t: 'i', v: 1, p: 'x', s: 1, q: 10, x: 0, y: 1 },               // slot is a string
    { t: 'i', v: 1, p: 9, s: 1, q: 10, x: 0, y: 1 },                 // slot out of range
    { t: 'i', v: 1, p: 1, s: 1, q: 10, x: 7, y: 0 },                 // not a unit step
    { t: 'i', v: 1, p: 1, s: 1, q: 10, x: 1, y: 1 },                 // diagonal
    { t: 'i', v: 1, p: 1, s: 1, q: 10 },                             // no direction
    { t: 'i', v: 1, p: 1, s: 'a', q: 10, x: 0, y: 1 },               // junk sequence
    { t: 'ri', v: 1, p: 1, list: 'not-a-list' },
    { t: 'ri', v: 1, p: 1, list: [[1, 10, 'a', 'b']] },
    { t: 'b', v: 1, p: undefined, q: 5, s: 0, hq: -1, h: 0 },
  ]) {
    bus.endpoints[1].send(junk);
    bus.pump(510);
    s0.frame(510);
  }
  assert.equal(why, null, 'the session survived every one');
  assert.equal(s0.failed, false);
  assert.equal(JSON.stringify(g0.log), before, 'and none of it entered the record');
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
