/**
 * The room socket: a WebSocket to this room's own relay, as a net transport.
 *
 * OWNS the socket, its reconnection, and nothing else. It is told a room code
 * and hands back the same four-method shape `channelTransport` returns, so the
 * netcode cannot tell the two apart and no rule, engine or protocol changes
 * when a room moves from one to the other.
 *
 * WHY. Supabase Realtime is one region per project, chosen at creation and not
 * changeable, so every input in every room crosses to that one region and back:
 * five players sitting together in Istanbul still see about 190ms of each other
 * through a relay in California. The relay behind this socket is a Durable
 * Object created in the data centre nearest whoever opened the room, so it
 * follows the ROOM. See cloudflare/room-wire.js for the other end.
 *
 * IT IS NEVER THE ONLY WIRE. `dualTransport` in packages/net keeps Broadcast
 * alongside it until every seat has been heard here, so a socket that cannot
 * open, or that dies mid-round, costs a room nothing but money. That is why
 * this module never throws and never reports failure: being down is an
 * ordinary state, answered honestly by `isOpen()`.
 *
 * MUST NEVER be reached from the frame loop.
 *
 * @module room-wire
 */

/** The four methods every wire in this game answers to. */
export interface NetTransport {
  send(obj: unknown): void;
  onMessage(f: (m: unknown) => void): void;
  setOpen(v: boolean): void;
  isOpen(): boolean;
  close(): void;
}

/**
 * Where the relay lives.
 *
 * Same origin as the page in production, which is what keeps the socket out of
 * CORS entirely and lets one Cloudflare worker answer both the page and the
 * room. A page served from the old github.io origin still points here, because
 * the relay is a property of the GAME rather than of whichever host served the
 * html, and the worker's origin allowlist expects exactly that.
 */
const RELAY_ORIGIN = 'wss://pitchsnake.com';

/** First reconnect delay, doubling to the cap. */
const RETRY_MIN_MS = 400;
/** The longest this will ever wait between attempts. */
const RETRY_MAX_MS = 5000;
/**
 * How many times to knock before deciding nobody is home.
 *
 * Only counted while the socket has NEVER opened here. A relay that is not
 * deployed, is switched off, or is blocked by this network is not going to
 * answer the ninetieth attempt either, and a room that has already fallen back
 * to Broadcast pays nothing for giving up: it plays exactly as it always did.
 * A socket that DID open and then dropped keeps retrying for ever, because
 * that is an ordinary blip and the room wants it back.
 */
const RETRY_GIVE_UP = 4;

/**
 * Open this room's socket and keep it open.
 *
 * Reconnection is unconditional until `close()`, because a room outlives any
 * one socket: a phone changing networks mid-round should rejoin the wire, and
 * the session repairs whatever it missed by asking its peers rather than the
 * relay. Anything sent while the socket is down is DROPPED rather than queued,
 * exactly as `channelTransport` drops it, so a reconnect never replays a
 * backlog of turns the round has long since moved past.
 *
 * @param code - the room code; the relay derives its object id from it, so
 *   every player typing the same code lands on the same relay.
 * @param origin - override for tests and local runs (`ws://127.0.0.1:8787`).
 * @returns a transport that is always safe to use and honest about being down.
 */
export function openRoomSocket(code: string, origin: string = RELAY_ORIGIN): NetTransport {
  const url = `${origin}/room/${encodeURIComponent(code.toUpperCase())}`;
  let socket: WebSocket | null = null;
  let cb: ((m: unknown) => void) | null = null;
  let closed = false;
  // A record rather than two locals, because both are written inside socket
  // callbacks: the compiler cannot see that ordering and narrows a plain `let`
  // to the literal it was initialised with, which turns the give-up test below
  // into "always truthy" and a lint error that is right about the types and
  // wrong about the program.
  const tries = { everOpened: false, failures: 0 };
  let retryMs = RETRY_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // A blocked scheme or a CSP that will not admit this origin lands here.
      // It is not an error the player can act on: the room plays on Broadcast.
      schedule();
      return;
    }
    socket = ws;
    ws.addEventListener('open', () => {
      retryMs = RETRY_MIN_MS;
      tries.everOpened = true;
      tries.failures = 0;
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (cb === null || typeof ev.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;                       // not ours; the relay forwards bytes, not meaning
      }
      cb(parsed);
    });
    const gone = (): void => {
      if (socket === ws) socket = null;
      schedule();
    };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  };

  const schedule = (): void => {
    if (closed || retryTimer !== null) return;
    if (!tries.everOpened && ++tries.failures > RETRY_GIVE_UP) {
      closed = true;             // nobody is home; stop knocking for this room
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
      connect();
    }, retryMs);
  };

  connect();

  return {
    send(obj: unknown): void {
      const ws = socket;
      if (ws?.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(obj));
      } catch {
        // A socket that reports OPEN and then refuses a write is already
        // closing; its close event is on the way and the retry follows it.
      }
    },
    onMessage(f: (m: unknown) => void): void { cb = f; },
    // The shell drives the Broadcast wire's open state from its subscribe
    // callback; a socket knows its own, so this is deliberately inert.
    setOpen(): void { /* a socket answers for itself */ },
    isOpen(): boolean { return socket?.readyState === WebSocket.OPEN; },
    close(): void {
      closed = true;
      cb = null;
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
      const ws = socket;
      socket = null;
      try { ws?.close(1000, 'left the room'); } catch { /* already gone */ }
    },
  };
}
