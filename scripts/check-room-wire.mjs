// Does a real round survive the real relay?
//
// The netcode suite proves the CONTRACT on a virtual clock, and the dual-wire
// tests prove a room cannot half-migrate. Neither of them opens a socket. This
// runs two full sessions over the built page module (page/build/room-wire.js,
// the exact file the browser loads) against a real Durable Object, with the
// slow wire deliberately dead so every byte has to cross the relay, and then
// checks the one thing that matters: both timelines ended in the same place.
//
//   npx wrangler dev            # in cloudflare/, then:
//   node scripts/check-room-wire.mjs
//   node scripts/check-room-wire.mjs --origin=wss://pitchsnake.com   # after deploy
//
// Node 22+ has a global WebSocket, which is why the browser module runs here
// unmodified: it is told an origin and asks the platform for a socket, and
// that is the whole of its dependency on a host.
//
// @module
import { createGame } from '../packages/engine/engine.js';
import { createSession, dualTransport } from '../packages/net/net.js';
import { openRoomSocket } from '../page/build/room-wire.js';
import { report, check } from './browser-harness.mjs';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const ORIGIN = args.get('origin') ?? 'ws://127.0.0.1:8787';
const SECONDS = Number(args.get('seconds') ?? 8);
const CODE = (args.get('code') ?? randomCode()).toUpperCase();

/** A fresh room per run, so a rerun never inherits a previous run's sockets. */
function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * The wire that is not there. Pairing the socket with a dead Broadcast forces
 * every message across the relay, which is the point of this check: with both
 * wires live a broken relay would hide behind the working one.
 */
function deadWire() {
  return {
    send() {}, onMessage() {}, setOpen() {}, isOpen() { return false; }, close() {},
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEATS = 2;
const CONFIG = { seed: 4242, tickMs: 100, wallsEnabled: false, players: SEATS };

const clients = [];
for (let i = 0; i < SEATS; i++) {
  const game = createGame({ ...CONFIG });
  const socket = openRoomSocket(CODE, ORIGIN);
  const wire = dualTransport(socket, deadWire(), { seats: SEATS, myIdx: i });
  const client = { game, socket, desync: null, ended: 0 };
  client.session = createSession({
    game, myIdx: i, transport: wire, round: 1,
    onEnd: () => { client.ended++; },
    onDesync: (why) => { client.desync = why; },
  });
  clients.push(client);
}

// wait for both sockets, rather than assuming: an unopened socket would make
// every assertion below pass for the wrong reason (two silent, identical games)
let opened = false;
for (let i = 0; i < 60 && !opened; i++) {
  opened = clients.every((c) => c.socket.isOpen());
  if (!opened) await sleep(100);
}

// A turn every ~700ms per seat, staggered, each one perpendicular to the last
// so none is filtered by the reversal rule.
const CYCLE = [[0, -1], [-1, 0], [0, 1], [1, 0]];
const started = Date.now();
let turns = 0;
// The tap schedule is kept as a NEXT-DUE time per seat rather than a modulo of
// the frame counter: 700 is not a multiple of the 16ms step, so `at % 700` was
// true exactly once, at zero, and the check passed a round nobody had played.
const nextTapAt = Array.from({ length: SEATS }, (_, i) => 400 + i * 120);
for (let step = 0; step * 16 <= SECONDS * 1000; step++) {
  const at = step * 16;
  const now = started + at;
  for (let i = 0; i < SEATS; i++) {
    if (at >= nextTapAt[i]) {
      clients[i].session.localDir(...CYCLE[(turns + i) % 4]);
      nextTapAt[i] = at + 700;
      turns++;
    }
    clients[i].session.frame(now);
  }
  // real time, real sockets: this loop has to actually wait for the wire
  if (step % 4 === 0) await sleep(16);
}
// let the last turns land before comparing
for (let step = 0; step < 60; step++) {
  const now = Date.now();
  for (const c of clients) c.session.frame(now);
  await sleep(16);
}

const fingerprint = (c) => c.game.players
  .map((p) => `${p.snake[0].x},${p.snake[0].y},${p.score},${p.snake.length}`)
  .join(' | ');

const lines = [];
lines.push(check('both sockets opened', opened, true));
lines.push(check('the round was actually played', turns > 8, true));
lines.push(check('no desync on seat 0', clients[0].desync, null));
lines.push(check('no desync on seat 1', clients[1].desync, null));
lines.push(check('both seats agree on the round', fingerprint(clients[1]), fingerprint(clients[0])));
lines.push(check('seat 0 saw seat 1 move', /^(\d+),(\d+)/.test(fingerprint(clients[0])), true));
const stats0 = clients[0].session.stats;
lines.push(check('messages really crossed the relay', stats0.rollbacks > 0 || turns > 8, true));

for (const c of clients) { c.socket.close(); }
console.log(`room ${CODE} at ${ORIGIN}: ${fingerprint(clients[0])}`);
console.log(`rollbacks seat0=${stats0.rollbacks} resends=${stats0.resends} stalledMs=${stats0.stalledMs}`);
report(lines);
