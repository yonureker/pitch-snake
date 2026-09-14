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
 * follows the ROOM. See cloudflare/room-wire.js for the other end, which is a
 * different program (the relay), never a copy of this one (the plug).
 *
 * IT IS NEVER THE ONLY WIRE. `dualTransport` in packages/net keeps Broadcast
 * alongside it until every seat has been heard here, so a socket that cannot
 * open, or that dies mid-round, costs a room nothing but money. That is why
 * this module never throws and never reports failure: being down is an
 * ordinary state, answered honestly by `isOpen()`.
 *
 * SHARED, NOT COPIED. This lived twice, as page/room-wire.ts and the app's
 * lib/room-wire.ts, "kept in step" by hand, and by 2026-09-14 the page's copy
 * had already grown reconnect bookkeeping the app's never received. Both
 * clients speak the same WHATWG WebSocket, so one source now serves them: the
 * page through the stamped import map, the app through the workspace. The page
 * has retired the relay from its fast slot (the WebRTC mesh took it) but the
 * app's rooms still ride this, and scripts/check-room-wire.mjs drives it
 * against a real relay.
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
export declare function openRoomSocket(code: string, origin?: string): NetTransport;
