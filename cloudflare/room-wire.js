// The room wire: one Durable Object per room code, and nothing else.
//
// WHY THIS EXISTS. A relay makes peer latency `me -> relay` plus `relay -> you`,
// so where the relay sits decides how a room feels and being near your opponent
// buys nothing at all. Supabase Realtime is one region per project, chosen at
// creation and not changeable, so five players sitting together in Istanbul
// still see ~190ms of each other through a relay in California. A Durable
// Object is created in the data centre nearest the request that first opens it,
// so the relay follows the ROOM instead of the project.
//
// The second reason is the bill. Supabase counts a broadcast as one message
// sent plus one per recipient, and the fan-out is the whole cost: a five-player
// room bills ~2,400 messages a minute, which is about fourteen room-hours a
// month on the free tier for the entire game. Here, incoming messages bill at
// 20:1 and outgoing messages are free, which is the same traffic at a fraction
// of the ceiling.
//
// WHAT IT OWNS: sockets, and forwarding. That is the whole of it.
//
// WHAT IT MUST NEVER DO: keep state. A peer that misses an input asks the PEER
// that sent it, never the relay (see the resend path in packages/net/net.js),
// so an object that is evicted and restarts mid-round is a socket blip the
// session already knows how to repair. The moment this file remembers a round,
// a game with exactly one source of truth has two. It also never parses a game
// message: every one already carries its own sender, round tag and protocol
// version, and a relay that understood them would be a second place the rules
// live.
//
// DEPLOY. A Durable Object needs a class binding and a migration, which the
// dashboard editor cannot paste in, so this worker is deployed with wrangler
// from cloudflare/: `npx wrangler deploy`. That replaces the paste-into-the-
// dashboard step in pitchsnake-router.js, and it is the only thing about the
// deployment that changed.
//
// @module

/** Sockets one room may hold: five seats, plus slack for a reconnect racing its own close. */
const MAX_SOCKETS = 8;
/** Bytes one message may carry. The largest real message is a resend burst, orders below this. */
const MAX_BYTES = 8192;
/** Messages a socket may send per second before it is dropped, averaged over a window. */
const MAX_PER_SEC = 80;
/** How long that average is taken over. */
const RATE_WINDOW_MS = 2000;

/**
 * Which pages may open a room socket.
 *
 * The github.io origin is on this list deliberately: it stays live as the
 * localStorage exporter for the move to pitchsnake.com (see index.html), so a
 * player who has not migrated yet is a real player and not an intruder. A
 * WebSocket has no CORS preflight, so this header check is the only door.
 */
const ALLOWED_ORIGINS = new Set([
  'https://pitchsnake.com',
  'https://www.pitchsnake.com',
  'https://yonureker.github.io',
]);

/**
 * Is this an origin a room socket may come from?
 *
 * A missing Origin is allowed on purpose: the mobile app is not a browser and
 * sends none, and neither does the latency probe in scripts/wire-latency.mjs.
 * The header is a browser's own honest statement, so it is worth checking when
 * present and worth nothing when absent; it keeps other people's PAGES from
 * quietly using this relay, which is all a header can ever do.
 *
 * @param {string | null} origin - the request's Origin header.
 * @param {string} devOrigins - comma-separated extra origins, or 'loopback'.
 *   Set only by `wrangler dev --var DEV_ORIGINS:loopback`, never in production.
 * @returns {boolean} whether to accept the socket.
 */
export function originAllowed(origin, devOrigins = '') {
  if (origin === null || origin === '') return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // The dev door, and the reason it is a variable rather than a constant: the
  // browser harness serves index.html from 127.0.0.1 on a port it picks at
  // run time, so a real browser driving a real room sends an origin no
  // production allowlist should ever contain. DEV_ORIGINS lives in
  // cloudflare/.dev.vars, which wrangler reads for `dev` and never deploys, so
  // this branch is unreachable in production by construction rather than by
  // remembering to take it out.
  // 'loopback' stands for any port on the local machine, because the browser
  // harness serves the page from a port it picks at run time and an exact list
  // cannot name it. Production never sees this: DEV_ORIGINS is set by the
  // `--var` flag on `wrangler dev` and by nothing else, so it exists only for
  // as long as a local run does. It is deliberately NOT a .dev.vars entry:
  // that file is where a real secret would go one day, and a file that must be
  // present for the tests to pass is a file somebody will commit.
  const wanted = devOrigins.split(',').map((o) => o.trim()).filter((o) => o !== '');
  if (wanted.includes('loopback') && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    return true;
  }
  return wanted.includes(origin);
}

/**
 * One room's relay. Every socket that opens `/room/<CODE>` with the same code
 * lands in the same object, because the id is derived from the code by name.
 */
export class RoomWire {
  /**
   * @param {DurableObjectState} state - the object's own runtime handle.
   * @param {{ DEV_ORIGINS?: string }} env - bindings; only the dev origin list
   *   is read, and only ever set by a local `wrangler dev --var` flag.
   */
  constructor(state, env) {
    this.state = state;
    this.env = env ?? {};
    // Rate state lives per socket and only in memory: a socket that outlives an
    // eviction comes back with a clean window, which is the correct answer
    // anyway, since the eviction proves it was quiet.
    this.rate = new WeakMap();
  }

  /**
   * Accept one WebSocket into this room.
   *
   * Hibernation is not optional here. `acceptWebSocket` hands the socket to the
   * runtime, which lets an idle room stop billing duration between rounds; an
   * ordinary `ws.accept()` with listeners in this scope keeps the object awake
   * for as long as a lobby is open, and a lobby is open far longer than a round
   * is played.
   *
   * @param {Request} request - the upgrade request.
   * @returns {Promise<Response>} the 101, or a refusal.
   */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket', { status: 426 });
    }
    if (!originAllowed(request.headers.get('Origin'), this.env.DEV_ORIGINS ?? '')) {
      return new Response('origin not allowed', { status: 403 });
    }
    if (this.state.getWebSockets().length >= MAX_SOCKETS) {
      return new Response('room full', { status: 409 });
    }
    const pair = new WebSocketPair();
    // EXPERIMENT (2026-09-08): ?hib=off accepts the socket the ordinary way,
    // keeping this object in memory for as long as it is open, so the cost of
    // hibernation's per-message wake can be measured rather than guessed.
    if (new URL(request.url).searchParams.get('hib') === 'off') {
      pair[1].accept();
      this.awake ??= new Set();
      this.awake.add(pair[1]);
      pair[1].addEventListener('message', (ev) => {
        for (const peer of this.awake) {
          if (peer === pair[1]) continue;
          try { peer.send(ev.data); } catch { /* going away */ }
        }
      });
      pair[1].addEventListener('close', () => { this.awake.delete(pair[1]); });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * Forward one message to everyone else in the room.
   *
   * The payload is never parsed. It is checked for size, counted against this
   * socket's rate, and passed on as it arrived, so this file cannot develop an
   * opinion about the game.
   *
   * @param {WebSocket} from - the socket that sent it.
   * @param {string | ArrayBuffer} message - the payload, untouched.
   */
  webSocketMessage(from, message) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_BYTES) { this.#drop(from, 1009, 'message too large'); return; }
    if (!this.#withinRate(from)) { this.#drop(from, 1008, 'too many messages'); return; }
    for (const peer of this.state.getWebSockets()) {
      if (peer === from) continue;            // a sender has no use for its own message
      try {
        peer.send(message);
      } catch {
        // A peer that cannot be written to is already gone; its close event is
        // on its way. Dropping the write is the whole of the handling: the
        // session repairs a missed message by asking the peer that sent it.
      }
    }
  }

  /**
   * @param {WebSocket} ws - the socket that closed.
   * @param {number} code - the close code the peer sent.
   * @param {string} reason - the peer's stated reason.
   */
  webSocketClose(ws, code, reason) {
    try { ws.close(code === 1006 ? 1000 : code, reason); } catch { /* already gone */ }
  }

  /**
   * @param {WebSocket} ws - the socket that failed.
   */
  webSocketError(ws) {
    try { ws.close(1011, 'socket error'); } catch { /* already gone */ }
  }

  /**
   * Is this socket inside its budget? A leaky window rather than a hard reset,
   * so a burst that is genuinely one round's worth of repair traffic is not
   * punished for arriving together.
   *
   * @param {WebSocket} ws - the sender.
   * @returns {boolean} whether to forward.
   */
  #withinRate(ws) {
    const now = Date.now();
    const seen = this.rate.get(ws) ?? { at: now, count: 0 };
    const elapsed = now - seen.at;
    if (elapsed >= RATE_WINDOW_MS) { seen.at = now; seen.count = 0; }
    seen.count++;
    this.rate.set(ws, seen);
    return seen.count <= (MAX_PER_SEC * RATE_WINDOW_MS) / 1000;
  }

  /**
   * @param {WebSocket} ws - the socket to end.
   * @param {number} code - a close code the client can read.
   * @param {string} why - the stated reason.
   */
  #drop(ws, code, why) {
    try { ws.close(code, why); } catch { /* already gone */ }
  }
}
