/**
 * The peer-to-peer wire: a WebRTC DataChannel mesh for one room.
 *
 * Why it exists: every Broadcast message round-trips through the project's
 * home region, so two players in the same city pay an ocean of latency each
 * way and the session pays for it in rollbacks (measured: 38 per average
 * round). A DataChannel goes point to point. This module owns the mesh and
 * NOTHING else: it is a transport with the same face as the others
 * (`send` / `onMessage` / `isOpen` / `close`), and dualTransport in
 * packages/net decides when it is trusted, exactly as it did for the relay.
 * Broadcast is never removed from under a round: a peer whose NAT eats the
 * handshake simply stays on the slow wire for ever, and the room cannot
 * half-migrate.
 *
 * Must never: carry signaling itself (the room's Supabase channel does
 * that, wired by the shell), know about seats or rounds (messages carry
 * their own seat stamp), or fail loudly (a mesh that cannot form IS the
 * working state on a hostile network).
 *
 * The shape of the handshake: for each pair, the lexicographically smaller
 * ref makes the offer, which kills offer-glare without negotiation. ICE is
 * STUN-only (two free servers); there is deliberately no TURN, because a
 * relayed "peer to peer" path is what Broadcast already is. Channels are
 * unordered and zero-retransmit on purpose: the session was built for a
 * lossy wire (sequence numbers, input ballast, resend requests), and a
 * reliable channel would trade its loss for head-of-line stalls, which is
 * the one thing a rollback netcode cannot hide.
 *
 * @module
 */
import type { NetTransport } from './room-wire.js';

/** How the shell ferries handshake payloads (over the room's channel). */
export type SignalSend = (toRef: string, data: Record<string, unknown>) => void;

/** The transport face the session expects, plus the mesh's own two knobs. */
export interface MeshTransport extends NetTransport {
  /** The room's current refs, mine excluded; connects and prunes to match. */
  setPeers(refs: string[]): void;
  /** An inbound signaling payload for this client (the shell's `rtc` event). */
  signal(fromRef: string, data: Record<string, unknown>): void;
}

/** Free STUN; TURN is a later, measured decision (see the peer-wire plan). */
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

/** Reconnect backoff for a peer whose connection failed: 2s, 4s, 8s, hold. */
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 8000;

/** A rejected ICE add is ordinary on a racing handshake; swallow it by name. */
function ignore(): void {
  /* intentionally empty: a failed candidate is not a failed connection */
}

/**
 * An SDP payload from a peer's signal, shaped enough for the WebRTC API.
 * @param v Anything at all, including what arrived over the wire.
 */
function isSdp(v: unknown): v is RTCSessionDescriptionInit {
  return typeof v === 'object' && v !== null && typeof (v as { sdp?: unknown }).sdp === 'string';
}

/**
 * An ICE candidate payload from a peer's signal.
 * @param v Anything at all, including what arrived over the wire.
 */
function isCand(v: unknown): v is RTCIceCandidateInit {
  return typeof v === 'object' && v !== null && 'candidate' in v;
}

interface Peer {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  open: boolean;
  /** candidates that arrived before the remote description; flushed after */
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  retryMs: number;
}

/**
 * Open the mesh for one room.
 *
 * @param myRef - this client's presence ref, the mesh's identity.
 * @param sendSignal - delivers one handshake payload to a peer over the
 *   room's channel (the shell wraps Broadcast; this module never touches
 *   Supabase). The shell stamps the sender, so this passes only the target.
 */
export function openMesh(myRef: string, sendSignal: SignalSend): MeshTransport {
  const peers = new Map<string, Peer>();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  let wanted: string[] = [];
  let onMsg: ((m: unknown) => void) | null = null;
  let closed = false;

  const say = (to: string, d: Record<string, unknown>): void => {
    try {
      sendSignal(to, d);
    } catch {
      /* a signal that cannot leave is a connection that stays on Broadcast */
    }
  };

  // lower ref calls: one deterministic caller per pair, so no glare
  const iCall = (ref: string): boolean => myRef < ref;

  function wireChannel(peer: Peer, dc: RTCDataChannel): void {
    peer.dc = dc;
    dc.addEventListener('open', () => {
      peer.open = true;
      peer.retryMs = RETRY_MIN_MS;   // a good connection resets the backoff
    });
    dc.addEventListener('close', () => {
      peer.open = false;
    });
    dc.addEventListener('message', (e: MessageEvent) => {
      if (onMsg === null || typeof e.data !== 'string') return;
      try {
        onMsg(JSON.parse(e.data));
      } catch {
        // junk is the session's to refuse (NET_PROTO check), not ours to crash on
        onMsg(null);
      }
    });
  }

  function connect(ref: string): void {
    if (closed || peers.has(ref)) return;
    const pc = new RTCPeerConnection(ICE);
    const peer: Peer = {
      pc, dc: null, open: false, pending: [], remoteSet: false, retryMs: RETRY_MIN_MS,
    };
    peers.set(ref, peer);

    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate) say(ref, { cand: e.candidate.toJSON() });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        scheduleRetry(ref, peer);
      }
    });
    pc.addEventListener('datachannel', (e) => {
      wireChannel(peer, e.channel);
    });

    if (iCall(ref)) {
      // the caller makes the channel; the callee receives it in ondatachannel
      wireChannel(peer, pc.createDataChannel('ps', { ordered: false, maxRetransmits: 0 }));
      void pc
        .createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          say(ref, { sdp: pc.localDescription?.toJSON() });
        })
        .catch(() => {
          scheduleRetry(ref, peer);
        });
    }
  }

  // Tear one peer down and, if still wanted, call again on a growing delay.
  function scheduleRetry(ref: string, peer: Peer): void {
    const wait = peer.retryMs;
    drop(ref);
    if (closed || !wanted.includes(ref)) return;
    const timer = setTimeout(() => {
      retryTimers.delete(timer);
      if (!closed && wanted.includes(ref) && !peers.has(ref)) {
        connect(ref);
        const fresh = peers.get(ref);
        if (fresh) fresh.retryMs = Math.min(RETRY_MAX_MS, wait * 2);
      }
    }, wait);
    retryTimers.add(timer);
  }

  function drop(ref: string): void {
    const peer = peers.get(ref);
    if (!peer) return;
    peers.delete(ref);
    peer.open = false;
    try { peer.dc?.close(); } catch { /* already down */ }
    try { peer.pc.close(); } catch { /* already down */ }
  }

  return {
    send(obj: unknown) {
      if (closed) return;
      let s: string | null = null;
      for (const peer of peers.values()) {
        if (!peer.open || peer.dc === null) continue;
        s ??= JSON.stringify(obj);   // stringified once, and only if anyone hears
        try { peer.dc.send(s); } catch { peer.open = false; }
      }
    },
    onMessage(f: (m: unknown) => void) { onMsg = f; },
    setOpen() { /* the channels know their own state; nothing to assert */ },
    isOpen() {
      for (const peer of peers.values()) if (peer.open) return true;
      return false;
    },
    setPeers(refs: string[]) {
      if (closed) return;
      wanted = refs.filter((r) => r !== myRef);
      for (const ref of wanted) connect(ref);
      const present = [...peers.keys()];
      for (const ref of present) if (!wanted.includes(ref)) drop(ref);
    },
    signal(fromRef: string, data: Record<string, unknown>) {
      if (closed || typeof fromRef !== 'string' || fromRef === myRef) return;
      // an offer can arrive before presence does; the callee builds on demand
      if (!peers.has(fromRef) && !iCall(fromRef)) connect(fromRef);
      const peer = peers.get(fromRef);
      if (!peer) return;
      const sdp = isSdp(data.sdp) ? data.sdp : null;
      const cand = isCand(data.cand) ? data.cand : null;
      if (sdp) {
        void peer.pc
          .setRemoteDescription(sdp)
          .then(async () => {
            peer.remoteSet = true;
            for (const c of peer.pending.splice(0)) {
              await peer.pc.addIceCandidate(c).catch(ignore);
            }
            if (sdp.type === 'offer') {
              const answer = await peer.pc.createAnswer();
              await peer.pc.setLocalDescription(answer);
              say(fromRef, { sdp: peer.pc.localDescription?.toJSON() });
            }
          })
          .catch(() => { scheduleRetry(fromRef, peer); });
      } else if (cand) {
        if (peer.remoteSet) void peer.pc.addIceCandidate(cand).catch(ignore);
        else peer.pending.push(cand);
      }
    },
    close() {
      closed = true;
      for (const t of retryTimers) clearTimeout(t);
      retryTimers.clear();
      const present = [...peers.keys()];
      for (const ref of present) drop(ref);
      onMsg = null;
    },
  };
}
