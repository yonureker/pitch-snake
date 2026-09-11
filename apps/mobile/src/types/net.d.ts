// The shared netcode ships as plain JS (packages/net); this is its typed
// surface for the app, kept to exactly what the room build touches.
declare module '@pitch-snake/net' {
  import type { Game } from '@pitch-snake/engine';

  /** The wire the session speaks through; channelTransport builds one. */
  export interface NetTransport {
    /** Whether this wire can carry a message right now. */
    isOpen(): boolean;
    send(obj: unknown): void;
    onMessage(f: (m: unknown) => void): void;
    setOpen(v: boolean): void;
    close(): void;
  }

  /** One player's view of a shared round (rollback, pacing, repair). */
  export interface NetSession {
    frame(nowMs: number): void;
    localDir(x: number, y: number, nowMs: number): void;
    /**
     * Take this seat out of the reckoning on the shared timeline: `remove`
     * takes the body with it (LEAVE), otherwise the corpse stays (FORFEIT).
     * Rides the input stream, so every peer applies it at the same quantum.
     */
    localExit(remove: boolean, nowMs: number): void;
    dropPeer(i: number): void;
    flush(): void;
    stalled: boolean;
    stats: {
      rollbacks: number;
      resimmed: number;
      stalledMs: number;
      longestStallMs: number;
      lagGiveUps: number;
      needsSent: number;
      resends: number;
      patched: number;
    };
    status(): 'running' | 'stalled' | 'over';
    close(): void;
  }

  /** One shared round: rollback, pacing, repair; see packages/net. */
  export function createSession(opts: {
    game: Game;
    myIdx: number;
    transport: NetTransport;
    onEnd?: () => void;
    onDesync?: (why: string) => void;
    round?: number;
  }): NetSession;

  /** Wrap a realtime channel (or anything shaped like one) as a transport. */
  export function channelTransport(channel: unknown, opts?: { event?: string }): NetTransport;

  /**
   * Two wires with no negotiation: send on `fast` when it is open, and on
   * `slow` as well until every seat has been HEARD on the fast one. The
   * session dedupes, so a doubled message is free and a room can never
   * half-migrate onto a wire only some of its players can reach.
   */
  export function dualTransport(
    fast: NetTransport,
    slow: NetTransport,
    opts: { seats: number; myIdx: number; now?: () => number },
  ): NetTransport;
}
