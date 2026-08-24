// Pitch Snake netcode: rollback sessions over any message pipe.
//
// The engine made a round a pure function of (seed, config, inputs), so
// multiplayer is input-sharing: every client runs the full simulation and
// broadcasts only its own quantum-stamped turns. This module owns everything
// between the engine and the wire: sequence numbers and gap repair (the wire
// is at-most-once), snapshots and rollback (a late remote input rewinds the
// machine and re-runs it, which the engine's snapshot()/restore() exist for),
// frame pacing against the peers, the stall rule, and a settled-state hash
// exchange that catches divergence instead of letting two screens drift apart.
//
// Like the engine, this file touches no host API on its own: the clock comes
// in through frame(nowMs), the wire through a transport object, and both are
// injected. The loopback bus below runs whole rooms in-process on a virtual
// clock, which is how the tests drive latency, loss and reorder
// deterministically; the Supabase adapter is just another transport.
//
// A transport is: { send(obj), onMessage(cb), close() }. Delivery may drop,
// duplicate or reorder; the session assumes nothing else.

import { SIM_DT } from '../engine/engine.js';

export const NET_PROTO = 1;

export const SNAP_EVERY = 32;     // quanta between keyframes (320ms)
export const SNAP_KEEP = 96;      // keyframes retained: ~30s of rollback horizon
export const STALL_AT = 250;      // quanta a live peer may lag before we hold the sim
export const BEAT_MS = 1000;      // heartbeat cadence
// Hash only state old enough that every repair path (a dropped input, then a
// dropped resend request, then a dropped resend, each caught by a later
// beat) has had ample time to finish: comfortably several beat cycles, and
// still well inside the snapshot horizon.
export const SETTLED_Q = 600;
export const CATCHUP_MAX = 3000;  // ms one frame() may simulate before giving up
export const NEED_COOLDOWN = 300; // ms between repeat resend requests per peer

// FNV-1a over a string: cheap, stable, good enough to catch divergence
export function foldHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Drive one player's view of a shared round.
 *
 * game     an engine instance every peer created identically (seed, config)
 * myIdx    which players[] slot is this client
 * transport the wire (see above)
 * onEnd    called once when the round is over (game.alive went false)
 * onDesync called once when the timelines cannot be reconciled: a peer's
 *          settled hash disagrees, an input arrived from beyond the snapshot
 *          horizon, or this client fell too far behind to catch up
 */
export function createSession({ game, myIdx, transport, onEnd, onDesync }) {
  const N = game.players.length;
  const table = Array.from({ length: N }, () => []);   // accepted inputs, seq order
  const applied = new Array(N).fill(0);                // next table[p] entry not yet applied
  const lastSeq = new Array(N).fill(0);
  const buffered = Array.from({ length: N }, () => new Map());  // out-of-order arrivals
  const peerQ = new Array(N).fill(0);                  // last quantum a peer reported
  const gone = new Array(N).fill(false);               // peer left: never stall on them
  const needAt = new Array(N).fill(0);                 // resend-request throttle
  const snaps = [];                                    // {q, s, h?} ascending by q
  const myHist = [];                                   // my own sends, for resend
  let mySeq = 0;
  let lastNow = -1, acc = 0, lastBeat = -1;
  let ended = false, dead = false;                     // dead = desynced/aborted
  let stalled = false;
  const stats = { rollbacks: 0, resimmed: 0, needsSent: 0, resends: 0 };

  const rbTrace = [];
  const fail = (why) => {
    if (dead || ended) return;
    dead = true;
    if (onDesync) onDesync(why);
  };

  function maybeSnap() {
    if (game.quanta % SNAP_EVERY !== 0) return;
    const last = snaps[snaps.length - 1];
    if (last && last.q === game.quanta) return;
    snaps.push({ q: game.quanta, s: game.snapshot(), h: 0 });
    if (snaps.length > SNAP_KEEP) snaps.shift();
  }

  function applyDue(q) {
    for (let p = 0; p < N; p++) {
      const list = table[p];
      while (applied[p] < list.length && list[applied[p]].q === q) {
        const e = list[applied[p]];
        game.setDir(e.x, e.y, p);
        applied[p]++;
      }
      // an entry stamped before the current quantum with no rollback pending
      // means the horizon logic failed; refuse to invent a different timeline
      if (applied[p] < list.length && list[applied[p]].q < q) return fail('late-input');
    }
  }

  function stepOne() {
    maybeSnap();
    applyDue(game.quanta);
    game.advanceQuanta(1);
  }

  function rollback(q) {
    // restore the newest keyframe at or before q, then re-run to where we were
    let i = snaps.length - 1;
    while (i >= 0 && snaps[i].q > q) i--;
    if (i < 0) return fail('horizon');
    const target = game.quanta;
    game.restore(snaps[i].s);
    snaps.length = i + 1;                       // later keyframes are now stale
    for (let p = 0; p < N; p++) {
      const list = table[p];
      let idx = 0;
      while (idx < list.length && list[idx].q < game.quanta) idx++;
      applied[p] = idx;
    }
    stats.rollbacks++;
    stats.resimmed += target - game.quanta;
    rbTrace.push([q, game.quanta, target, game.log.inputs.length]);
    if (rbTrace.length > 64) rbTrace.shift();
    while (game.quanta < target && game.alive && !dead) stepOne();
  }

  function commit(p, e) {
    lastSeq[p] = e.s;
    table[p].push(e);
    return e.q < game.quanta ? e.q : Infinity;   // how far back this one reaches
  }

  function acceptInput(msg, nowMs) {
    const p = msg.p;
    if (p === myIdx || p < 0 || p >= N || gone[p]) return Infinity;
    if (msg.s <= lastSeq[p]) return Infinity;              // duplicate
    if (msg.q > peerQ[p]) peerQ[p] = msg.q;
    if (msg.s !== lastSeq[p] + 1) {                        // a gap: hold it, ask again
      buffered[p].set(msg.s, msg);
      requestResend(p, nowMs);
      return Infinity;
    }
    let back = commit(p, { s: msg.s, q: msg.q, x: msg.x, y: msg.y });
    let next;
    while ((next = buffered[p].get(lastSeq[p] + 1))) {     // drain what queued behind it
      buffered[p].delete(next.s);
      back = Math.min(back, commit(p, { s: next.s, q: next.q, x: next.x, y: next.y }));
    }
    return back;
  }

  function requestResend(p, nowMs) {
    if (nowMs - needAt[p] < NEED_COOLDOWN) return;
    needAt[p] = nowMs;
    stats.needsSent++;
    transport.send({ t: 'n', v: NET_PROTO, p: myIdx, of: p, from: lastSeq[p] + 1 });
  }

  function settledSnap() {
    let i = snaps.length - 1;
    while (i >= 0 && snaps[i].q > game.quanta - SETTLED_Q) i--;
    return i >= 0 ? snaps[i] : null;
  }

  function sendBeat() {
    const s = settledSnap();
    if (s && !s.h) s.h = foldHash(JSON.stringify(s.s)) || 1;
    transport.send({
      t: 'b', v: NET_PROTO, p: myIdx, q: game.quanta, s: mySeq,
      hq: s ? s.q : -1, h: s ? s.h : 0,
    });
  }

  transport.onMessage((msg) => {
    if (!msg || msg.v !== NET_PROTO || dead) return;
    const nowMs = lastNow < 0 ? 0 : lastNow;
    if (msg.t === 'i') {
      const back = acceptInput(msg, nowMs);
      if (back !== Infinity) rollback(back);
    } else if (msg.t === 'ri') {                 // a resend batch: same as inputs
      let back = Infinity;
      for (const e of msg.list) back = Math.min(back, acceptInput({ p: msg.p, s: e[0], q: e[1], x: e[2], y: e[3] }, nowMs));
      if (back !== Infinity) rollback(back);
    } else if (msg.t === 'b') {
      const p = msg.p;
      if (p === myIdx || p < 0 || p >= N) return;
      if (msg.q > peerQ[p]) peerQ[p] = msg.q;
      if (msg.s > lastSeq[p]) requestResend(p, nowMs);     // they sent things we never saw
      // compare only what is settled on BOTH sides: my copy of that quantum
      // may still be awaiting a repair of my own
      if (msg.hq >= 0 && msg.hq <= game.quanta - SETTLED_Q) {
        const mine = snaps.find(sn => sn.q === msg.hq);
        if (mine) {
          if (!mine.h) mine.h = foldHash(JSON.stringify(mine.s)) || 1;
          if (mine.h !== msg.h) fail('hash');
        }
      }
    } else if (msg.t === 'n') {
      if (msg.of !== myIdx) return;
      const list = [];
      for (const e of myHist) if (e.s >= msg.from) list.push([e.s, e.q, e.x, e.y]);
      if (list.length) {
        stats.resends++;
        transport.send({ t: 'ri', v: NET_PROTO, p: myIdx, list: list.slice(0, 400) });
      }
    }
  });

  return {
    stats,
    // internals for tests and diagnostics; not part of the contract
    _debug: { snaps, table, applied, lastSeq, peerQ, rbTrace },
    get stalled() { return stalled; },
    get over() { return ended; },
    get failed() { return dead; },

    /**
     * My turn, from any input source. It is stamped for the NEXT quantum and
     * fed through the same table-and-apply path as every remote input: one
     * application path means every machine puts the press on the same side
     * of the same keyframe, which is what keeps the settled hashes equal.
     * (A press mid-quantum costs at most SIM_DT of extra latency, and a turn
     * only ever lands at the next cell boundary anyway.) The engine's
     * reversal/repeat filter runs at apply time, identically everywhere.
     */
    localDir(x, y) {
      if (dead || ended || !game.players[myIdx].alive) return;
      const e = { s: ++mySeq, q: game.quanta + 1, x, y };
      myHist.push(e);
      table[myIdx].push(e);
      lastSeq[myIdx] = mySeq;
      transport.send({ t: 'i', v: NET_PROTO, p: myIdx, s: e.s, q: e.q, x, y });
    },

    /** A peer left for good (presence said so): their snake runs straight. */
    dropPeer(p) { if (p !== myIdx && p >= 0 && p < N) gone[p] = true; },

    /**
     * Advance toward now. Call every frame with an absolute clock; the
     * remainder rides game.accMs so renderers keep their interpolation.
     */
    frame(nowMs) {
      if (dead) return 'failed';
      if (ended) return 'over';
      if (lastNow < 0) { lastNow = nowMs; lastBeat = nowMs; }
      let dt = nowMs - lastNow;
      lastNow = nowMs;
      if (dt < 0) dt = 0;
      if (dt > CATCHUP_MAX) { fail('behind'); return 'failed'; }

      // the slowest peer still in the room sets the leash; the fastest sets a
      // gentle slew so everyone converges on one clock without a server
      let minPeer = Infinity, maxPeer = -Infinity;
      for (let p = 0; p < N; p++) {
        if (p === myIdx || gone[p]) continue;
        if (peerQ[p] < minPeer) minPeer = peerQ[p];
        if (peerQ[p] > maxPeer) maxPeer = peerQ[p];
      }
      stalled = minPeer !== Infinity && minPeer < game.quanta - STALL_AT;
      if (!stalled) {
        const lead = maxPeer === -Infinity ? 0 : maxPeer - game.quanta;
        const rate = lead > 15 ? 1.05 : lead < -15 ? 0.95 : 1;
        acc += dt * rate;
        let guard = (CATCHUP_MAX / SIM_DT) | 0;
        while (acc >= SIM_DT && game.alive && !dead && guard-- > 0) {
          stepOne();
          acc -= SIM_DT;
        }
        game.accMs = game.alive ? acc : 0;
      }
      if (nowMs - lastBeat >= BEAT_MS) { lastBeat = nowMs; sendBeat(); }
      if (!game.alive && !ended) { ended = true; if (onEnd) onEnd(); }
      return ended ? 'over' : stalled ? 'stalled' : 'running';
    },

    close() { transport.close(); },
  };
}

/**
 * Wrap a Supabase Realtime channel (or anything shaped like one) as a
 * transport. The page flips setOpen(true) once the channel reports
 * SUBSCRIBED and back off when it drops, so a send never silently takes the
 * client library's REST fallback; anything unsent while closed is repaired by
 * the session's gap protocol.
 */
export function channelTransport(channel, { event = 'm' } = {}) {
  let cb = null;
  let open = false;
  channel.on('broadcast', { event }, (msg) => { if (cb) cb(msg.payload); });
  return {
    send(obj) {
      if (!open) return;
      void channel.send({ type: 'broadcast', event, payload: obj });
    },
    onMessage(f) { cb = f; },
    setOpen(v) { open = !!v; },
    close() { cb = null; open = false; },
  };
}

/**
 * An in-process room of N transports on a virtual clock, for tests and local
 * two-tab play. Latency, jitter, loss and the resulting reorder are seeded
 * and deterministic; messages cross a JSON round-trip like the real wire.
 */
export function loopbackBus(n, { latency = 0, jitter = 0, drop = 0, seed = 1 } = {}) {
  let a = seed >>> 0;
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const queues = Array.from({ length: n }, () => []);
  const cbs = new Array(n).fill(null);
  const bus = {
    now: 0,
    endpoints: Array.from({ length: n }, (_, i) => ({
      send(obj) {
        const wire = JSON.stringify(obj);
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          if (rnd() < drop) continue;
          queues[j].push({ at: bus.now + latency + rnd() * jitter, obj: JSON.parse(wire) });
        }
      },
      onMessage(f) { cbs[i] = f; },
      close() { cbs[i] = null; },
    })),
    pump(to) {
      bus.now = to;
      for (let j = 0; j < n; j++) {
        const q = queues[j];
        q.sort((x, y) => x.at - y.at);
        while (q.length && q[0].at <= to) {
          const m = q.shift();
          if (cbs[j]) cbs[j](m.obj);
        }
      }
    },
  };
  return bus;
}
