/**
 * The room state machine, the web page's vs* logic as a hook. A room is a
 * realtime channel: presence is the roster (name, flag, outfit, ready),
 * 'ready' broadcasts are the fast path a tick needs, and 'lobby' carries
 * kickoffs, normally minted by the server through room_start and delivered
 * by its own realtime.send. Every peer simulates the whole round through
 * the shared session; seats are claimed at kickoff and every peer reports
 * its own copy of the log at full time. All of it is a bonus tier: a room
 * that reaches none of it plays the identical round, just unrated.
 * @module
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

import type { RealtimeChannel } from '@supabase/realtime-js';

import { ENGINE_VERSION, SPEEDS, createGame } from '@pitch-snake/engine';
import {
  channelTransport,
  createSession,
  dualTransport,
  type NetSession,
  type NetTransport,
} from '@pitch-snake/net';

import type { GameLoop } from '@/game/use-game-loop';
import { prepareVersusSprites } from '@/game/renderer';
import { openRoomSocket } from '@/lib/room-wire';
import {
  VS_MAX,
  VS_MIN,
  cleanName,
  closeRealtime,
  makeLocalCode,
  realtimeClient,
  reportRoomRound,
  roomCreate,
  roomQuickmatch,
  roomStart,
  roomTouch,
  takeSeat,
  fetchRoundRatings,
} from '@/lib/rooms';

/** One person at the table, as presence describes them. */
export interface Presence {
  ref: string;
  name: string;
  ready: boolean;
  host: boolean;
  ts: number;
  skin: string | null;
  hat: string | null;
}

/** One full-time standings row. */
export interface StandingRow {
  place: number;
  name: string;
  score: number;
  me: boolean;
  wins: number;
  /** the seat this row is, so a sealed rating can find it again */
  seat: number;
  /** the ladder, once the round seals: null until then, and for ever if the
   *  round is not a rated one (a code room, or nobody corroborated it) */
  rating: number | null;
  delta: number | null;
  provisional: boolean;
}

interface RoomBox {
  code: string;
  host: boolean;
  ref: string;
  name: string;
  channel: RealtimeChannel | null;
  transport: NetTransport | null;
  /** This room's own relay, near the room rather than near the project. */
  socket: NetTransport | null;
  /** Entered through QUICK MATCH, so there is no host worth waiting for. */
  quick: boolean;
  /** When the lobby countdown fires, or 0 when it is not armed. */
  startAt: number;
  /** The last count painted, so the line is written once a second. */
  startShown: number | null;
  session: NetSession | null;
  up: boolean;
  startN: number;
  roster: { ref: string; name: string }[] | null;
  myIdx: number;
  over: boolean;
  ready: boolean;
  rseq: number;
  readyBy: Map<string, { ready: boolean; rseq: number }>;
  knownRefs: Set<string>;
  present: Presence[];
  wins: Record<string, number>;
  joinedTs: number;
  lastTrackAt: number;
  trackDirty: boolean;
  touchTimer: ReturnType<typeof setInterval> | null;
  starting: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const wornId = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 32 && v !== '' ? v : null;

const TRACK_GAP_MS = 6100;
/** How often the room's one ticker runs; the countdown is its finest job. */
const TICK_MS = 250;
/** How often the acting host warms the row so quick match can see the room. */
const TOUCH_EVERY_MS = 10000;
/** How long a quick room waits, once everyone is ready, before it whistles. */
const LOBBY_COUNT_MS = 3000;

/** What the screen reads and calls; null room means the entry form. */
export interface UseRoom {
  /** 'idle' (no room), 'connecting', or 'lobby' (in a room, maybe mid-round). */
  status: 'idle' | 'connecting' | 'lobby';
  code: string;
  note: string;
  present: Presence[];
  myRef: string;
  myReady: boolean;
  isHost: boolean;
  readyStats: { seats: number; ready: number; all: boolean };
  /** Seconds left before a quick room starts itself, or null when not counting. */
  startsIn: number | null;
  over: boolean;
  standings: StandingRow[];
  quick: (name: string) => void;
  create: (name: string) => void;
  join: (name: string, code: string) => void;
  toggleReady: () => void;
  /** The acting host's whistle; a no-op for everyone else. */
  start: () => void;
  leave: () => void;
}

/** Drive one room through the shared loop; boardPx sizes the outfit bakes. */
export function useRoom(
  loop: GameLoop,
  worn: { skin: string | null; hat: string | null },
  boardPx: number,
): UseRoom {
  const box = useRef<RoomBox | null>(null);
  const [status, setStatus] = useState<UseRoom['status']>('idle');
  const [note, setNote] = useState('');
  /** Seconds left on a quick room's lobby countdown, or null when not counting. */
  const [startsIn, setStartsIn] = useState<number | null>(null);
  const [present, setPresent] = useState<Presence[]>([]);
  const [myReady, setMyReady] = useState(false);
  const [over, setOver] = useState(false);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [codeShown, setCodeShown] = useState('');
  const [myRef, setMyRef] = useState('');
  const wornRef = useRef(worn);
  useEffect(() => {
    wornRef.current = worn;
  }, [worn]);
  const loopRef = useRef(loop);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  // one cleanup for unmount; leave() is the deliberate version of the same
  useEffect(() => {
    return () => {
      const r = box.current;
      if (r === null) return;
      if (r.touchTimer !== null) clearInterval(r.touchTimer);
      // the room socket retries for as long as it is open, so both ways out of
      // a room have to say so, or a closed screen keeps a wire alive
      r.socket?.close();
      try {
        void r.channel?.unsubscribe();
      } catch {
        // the socket may already be gone
      }
      closeRealtime();
      box.current = null;
    };
  }, []);

  // TEN KEYS IS THE CEILING. Supabase caps a presence object at 10 keys on
  // every plan; this payload is at seven, and the page's twin is at nine
  // because it also sends the country and the kit. Past ten a track fails
  // silently and that seat loses its name, its readiness and its outfit on
  // every other screen.
  const track = (r: RoomBox): void => {
    r.lastTrackAt = Date.now();
    r.trackDirty = false;
    void r.channel?.track({
      name: r.name,
      ts: r.joinedTs,
      host: r.host,
      ready: r.ready,
      rseq: r.rseq,
      skin: wornRef.current.skin,
      hat: wornRef.current.hat,
    });
  };
  const trackSoon = (r: RoomBox): void => {
    if (Date.now() - r.lastTrackAt >= TRACK_GAP_MS) track(r);
    else r.trackDirty = true;
  };

  const rosterSync = (r: RoomBox): void => {
    const stateMap: unknown = r.channel?.presenceState() ?? {};
    const list: Presence[] = [];
    let fresh = false;
    if (!isRecord(stateMap)) return;
    for (const [key, entries] of Object.entries(stateMap)) {
      const m = Array.isArray(entries) ? (entries[0] as unknown) : null;
      if (!isRecord(m)) continue;
      const held = r.readyBy.get(key);
      const ready = held !== undefined && held.rseq > Number(m.rseq ?? 0) ? held.ready : m.ready === true;
      list.push({
        ref: key,
        name: typeof m.name === 'string' && m.name !== '' ? m.name : 'YOU',
        ready,
        host: m.host === true,
        ts: typeof m.ts === 'number' ? m.ts : 0,
        skin: wornId(m.skin),
        hat: wornId(m.hat),
      });
      if (key !== r.ref && !r.knownRefs.has(key)) {
        r.knownRefs.add(key);
        fresh = true;
      }
    }
    // a newcomer reads readiness out of presence, which can be a pacing
    // window stale: everyone already here says their piece again
    if (fresh) say(r, r.ready);
    list.sort((a, b) => Number(b.host) - Number(a.host) || a.ts - b.ts || (a.ref < b.ref ? -1 : 1));
    r.present = list;
    // a mid-round vanisher's snake goes on rails, deterministically everywhere
    if (r.session !== null && r.roster !== null) {
      for (let i = 0; i < r.roster.length; i++) {
        const seat = r.roster[i];
        if (seat !== undefined && i !== r.myIdx && !list.some((p) => p.ref === seat.ref)) {
          r.session.dropPeer(i);
        }
      }
    }
    setPresent(list);
  };

  const say = (r: RoomBox, ready: boolean): void => {
    if (!r.up) return;
    void r.channel?.send({
      type: 'broadcast',
      event: 'ready',
      payload: { ref: r.ref, ready, rseq: r.rseq },
    });
  };

  const readyMsg = (r: RoomBox, m: unknown): void => {
    if (!isRecord(m) || typeof m.ref !== 'string' || m.ref === r.ref) return;
    if (typeof m.ready !== 'boolean' || typeof m.rseq !== 'number') return;
    const theirRef = m.ref;
    const theirReady = m.ready;
    const theirSeq = m.rseq;
    const held = r.readyBy.get(theirRef);
    if (held !== undefined && held.rseq >= theirSeq) return;
    r.readyBy.set(theirRef, { ready: theirReady, rseq: theirSeq });
    r.present = r.present.map((p) => (p.ref === theirRef ? { ...p, ready: theirReady } : p));
    setPresent(r.present);
  };

  const onRoundEnd = (r: RoomBox): void => {
    const g = loopRef.current.game.current;
    if (g === null || r.roster === null) return;
    r.over = true;
    // exactly the order the validator computes: score desc, survived longer,
    // then the earlier seat; equal score on the same quantum is a draw
    const rows = g.players
      .map((p, i) => ({ seat: i, score: p.score, diedAt: p.diedAt }))
      .sort((a, b) => b.score - a.score || b.diedAt - a.diedAt || a.seat - b.seat);
    const out: StandingRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      const prev = i > 0 ? rows[i - 1] : undefined;
      const tied = prev?.score === row.score && prev.diedAt === row.diedAt;
      const place = tied ? (out[i - 1]?.place ?? i + 1) : i + 1;
      const name = r.roster[row.seat]?.name ?? '?';
      out.push({
        place,
        name,
        score: row.score,
        me: row.seat === r.myIdx,
        wins: 0,
        seat: row.seat,
        rating: null,
        delta: null,
        provisional: false,
      });
    }
    // the round goes on the series before anything renders; every client
    // credits the same winner, so the tallies agree without a word
    const winner = out[0];
    if (winner !== undefined) {
      r.wins[winner.name] = (r.wins[winner.name] ?? 0) + 1;
      void AsyncStorage.setItem(`snakeVsWins.${r.code}`, JSON.stringify(r.wins)).catch(() => undefined);
    }
    for (const row of out) row.wins = r.wins[row.name] ?? 0;
    setStandings(out);
    setOver(true);
    reportRoomRound(r.code, r.startN, g.log);
    void pollRatings(r, r.code, r.startN);
    loopRef.current.endVersus();
  };

  // The ladder lands a moment after the whistle: sealing waits, because the
  // server cannot know a submission is the last one. So this polls, takes the
  // first non-empty answer, and paints it BESIDE the series trophy rather
  // than over it, exactly as the page does. A round that is never rated (a
  // code room, or one nobody corroborated) simply never answers, and the
  // standings keep the trophy alone.
  const pollRatings = async (r: RoomBox, code: string, startN: number): Promise<void> => {
    for (let tries = 0; tries < 6; tries++) {
      await new Promise((res) => setTimeout(res, tries === 0 ? 800 : 1500));
      // the room moved on: a rematch, a new room, or the panel left
      if (box.current !== r || !r.over || r.startN !== startN) return;
      let rows;
      try {
        rows = await fetchRoundRatings(code, startN);
      } catch {
        return;
      }
      if (rows.length === 0) continue;
      // the round moved on during the await. `over` is not re-tested here:
      // the guard above narrowed it, and a rematch changes startN anyway
      if (box.current !== r || r.startN !== startN) return;
      const bySeat = new Map(rows.map((row) => [row.seat, row]));
      setStandings((prev) =>
        prev.map((row) => {
          const hit = bySeat.get(row.seat);
          return hit === undefined ? row : (
              { ...row, rating: hit.rating, delta: hit.delta, provisional: hit.provisional }
            );
        }),
      );
      return;
    }
  };

  const begin = (r: RoomBox, m: Record<string, unknown>): void => {
    if (typeof m.ev === 'number' && m.ev !== ENGINE_VERSION) {
      setNote('This room runs a different build of the game. Update the app to match it.');
      return;
    }
    if (isRecord(m.wins)) {
      for (const [k, v] of Object.entries(m.wins)) {
        if (typeof v === 'number' && v > (r.wins[k] ?? 0)) r.wins[k] = v;
      }
    }
    const rosterRaw: unknown[] = Array.isArray(m.roster) ? m.roster : [];
    const roster = rosterRaw.filter(isRecord).map((e) => ({
      ref: typeof e.ref === 'string' ? e.ref : '',
      name: typeof e.name === 'string' && e.name !== '' ? e.name : '?',
    }));
    const idx = roster.findIndex((e) => e.ref === r.ref);
    if (idx < 0) {
      setNote('This round is full; you are in the next one.');
      return;
    }
    if (typeof m.seed !== 'number') return;
    r.roster = roster;
    r.myIdx = idx;
    r.over = false;
    setOver(false);
    setStandings([]);
    setNote('');
    // readiness is consent for ONE kickoff; the next round asks again
    r.ready = false;
    setMyReady(false);
    r.readyBy.clear();
    r.rseq++;
    say(r, false);
    trackSoon(r);
    takeSeat(r.code, r.startN, idx, roster[idx]?.name ?? 'YOU');
    const g = createGame({
      seed: m.seed >>> 0,
      tickMs: SPEEDS.normal,
      wallsEnabled: true,
      players: roster.length,
    });
    if (r.transport === null || r.socket === null) return;
    // BOTH WIRES, every round, with nothing agreed anywhere: the fast one is
    // this room's own relay and the slow one is Broadcast. dualTransport keeps
    // paying for the slow wire until every seat has been HEARD on the fast one,
    // and the session dedupes by sequence number, so a room can never
    // half-migrate onto a wire only some of its players can reach. Rebuilt per
    // round, because a new roster has proved nothing yet.
    const wire = dualTransport(r.socket, r.transport, { seats: roster.length, myIdx: idx });
    const session = createSession({
      game: g,
      myIdx: idx,
      transport: wire,
      round: r.startN,
      onEnd: () => {
        onRoundEnd(r);
      },
      onDesync: () => {
        setNote('The room desynced. Leave and rejoin to play on.');
        onRoundEnd(r);
      },
    });
    r.session = session;
    // dress the seats from presence; a peer with no presence yet plays classic
    const fits = roster.map((seat) => {
      const p = r.present.find((x) => x.ref === seat.ref);
      return { skin: p?.skin ?? null, hat: p?.hat ?? null };
    });
    prepareVersusSprites(boardPxRef.current, fits);
    const at = typeof m.at === 'number' ? m.at : Date.now();
    loopRef.current.startVersus(g, session, idx, Date.now() - at, {
      myIdx: idx,
      names: roster.map((e) => e.name),
      fits,
    });
  };

  // the renderer bakes rival outfits against the real board size
  const boardPxRef = useRef(boardPx);
  useEffect(() => {
    boardPxRef.current = boardPx;
  }, [boardPx]);

  /**
   * Is a quick room's lobby countdown finished, and should the round begin?
   *
   * Three seconds, and not zero: starting the instant the last player taps
   * READY throws that player into a round with a thumb still on the button,
   * and strands anyone whose JOIN lands in the same moment. Anyone unreadying,
   * leaving or joining cancels it, and a joiner needs no special case because
   * they arrive not-ready.
   *
   * It answers a question and touches no state, which is not tidiness: this
   * file is compiled by the React Compiler, and BOTH of these made its purity
   * pass give up and report every `Date.now()` in the hook as a call during
   * render. A forward reference to `start()` was one; taking the state setter
   * as an argument was the other. So it reads the room, returns a number, and
   * the ticker does the acting.
   *
   * @param r - the room to consider.
   * @returns seconds left on the count, 0 when the round should start now, or
   *   null when no count is running.
   */
  const autoStartLeft = (r: RoomBox): number | null => {
    if (!r.quick || r.session !== null || r.over || r.starting) {
      r.startAt = 0;
      return null;
    }
    const seatList = r.present.slice(0, VS_MAX);
    const readyNow = seatList.filter((p) => (p.ref === r.ref ? r.ready : p.ready)).length;
    if (seatList.length < VS_MIN || readyNow !== seatList.length) {
      r.startAt = 0;
      return null;
    }
    const now = Date.now();
    if (r.startAt === 0) r.startAt = now + LOBBY_COUNT_MS;
    if (now >= r.startAt) {
      r.startAt = 0;
      return 0;
    }
    return Math.ceil((r.startAt - now) / 1000);
  };

  /**
   * Whistle: the room asks the server to mint a seed and start the round.
   *
   * It sits ABOVE `enter` because the room ticker created there calls it, and
   * a forward reference in this file is not a style question: the React
   * Compiler follows it, gives up on its purity analysis, and then reports
   * every `Date.now()` in the whole hook as a call during render.
   */
  const start = (): void => {
    const r = box.current;
    if (r === null || r.starting) return;
    const seatList = r.present.slice(0, VS_MAX);
    // A quick room has no host worth waiting for: one stranger holding the
    // whistle is a single point of failure, so any member may call the kickoff
    // and the server's row lock decides which one. A CODE room keeps its host,
    // who may be holding the room for a friend who has not arrived.
    if (!r.quick && seatList[0]?.ref !== r.ref) return;
    // Every seat says ready first, on both clients. The web page has always
    // gated here; this one only gated in its UI, which is a gate a second
    // caller walks straight past.
    const readyNow = seatList.filter((p) => (p.ref === r.ref ? r.ready : p.ready)).length;
    if (seatList.length < VS_MIN || readyNow !== seatList.length) return;
    const roster = seatList.map((p) => ({ ref: p.ref, name: p.name }));
    if (roster.length < VS_MIN) return;
    r.starting = true;
    void roomStart(r.code, roster, ENGINE_VERSION).then((served) => {
      if (box.current !== r) return;
      r.starting = false;
      if (served || r.session !== null) return;
      // no rooms tier: this device whistles itself. The seed only has to be
      // SHARED, not unpredictable, so the clock serves and no random is
      // needed (app code bans Math.random near gameplay for good reason).
      const m = {
        t: 'start',
        n: r.startN + 1,
        ev: ENGINE_VERSION,
        seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
        roster,
        wins: r.wins,
        at: Date.now(),
      };
      void r.channel?.send({ type: 'broadcast', event: 'lobby', payload: m });
      r.startN = m.n;
      begin(r, m);
    });
  };

  const enter = async (code: string, host: boolean, name: string, quick: boolean): Promise<void> => {
    const client = realtimeClient();
    if (client === null) {
      setNote('Rooms need the online service.');
      return;
    }
    setStatus('connecting');
    setNote(host ? 'Opening the room…' : 'Joining…');
    let wins: Record<string, number> = {};
    try {
      const rawWins = await AsyncStorage.getItem(`snakeVsWins.${code}`);
      const v: unknown = rawWins === null ? null : JSON.parse(rawWins);
      if (isRecord(v)) {
        for (const [k, n] of Object.entries(v)) if (typeof n === 'number') wins[k] = n;
      }
    } catch {
      wins = {};
    }
    const ref = `${Date.now().toString(16)}${Math.floor(performance.now() * 1000)
      .toString(16)
      .slice(-6)}`;
    const channel = client.channel(`ps-${code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: ref } },
    });
    const r: RoomBox = {
      code,
      host,
      ref,
      name,
      channel,
      quick,
      startAt: 0,
      startShown: null,
      transport: channelTransport(channel),
      // Opened at JOIN so it is warm by kickoff. A room that cannot reach it
      // plays on Broadcast: see dualTransport below, which needs no agreement.
      socket: openRoomSocket(code),
      session: null,
      up: false,
      startN: 0,
      roster: null,
      myIdx: -1,
      over: false,
      ready: false,
      rseq: 0,
      readyBy: new Map(),
      knownRefs: new Set(),
      present: [],
      wins,
      joinedTs: Date.now(),
      lastTrackAt: 0,
      trackDirty: false,
      touchTimer: null,
      starting: false,
    };
    box.current = r;
    setCodeShown(code);
    setMyRef(ref);
    setMyReady(false);
    setOver(false);
    setStandings([]);
    channel.on('presence', { event: 'sync' }, () => {
      if (box.current === r) rosterSync(r);
    });
    channel.on('broadcast', { event: 'lobby' }, (msg: { payload?: unknown }) => {
      if (box.current !== r) return;
      const m = msg.payload;
      if (!isRecord(m) || m.t !== 'start' || typeof m.n !== 'number') return;
      if (m.n <= r.startN) return;
      r.startN = m.n;
      begin(r, m);
    });
    channel.on('broadcast', { event: 'ready' }, (msg: { payload?: unknown }) => {
      if (box.current === r) readyMsg(r, msg.payload);
    });
    let settled = false;
    const guard = setTimeout(() => {
      if (settled) return;
      settled = true;
      setNote('Could not reach the room service. Try again.');
      try {
        void channel.unsubscribe();
      } catch {
        // nothing to close
      }
      if (box.current === r) {
        box.current = null;
        setStatus('idle');
        setMyRef('');
      }
    }, 8000);
    channel.subscribe((s: string) => {
      if (box.current !== r) return;
      if (s === 'SUBSCRIBED') {
        if (!settled) {
          settled = true;
          clearTimeout(guard);
        }
        r.up = true;
        r.transport?.setOpen(true);
        // a mid-round reconnect pushes recent turns out unasked
        r.session?.flush();
        track(r);
        setStatus('lobby');
        setNote('');
      } else {
        r.up = false;
        r.transport?.setOpen(false);
      }
    });
    // The ticker: paced presence flushes, the lobby countdown, and the host
    // keeping the row warm so quick match can seat strangers into a room that
    // is really there. One timer at a quarter second doing three jobs at their
    // own cadences, rather than three timers to start, clear and leak.
    let sinceTouch = 0;
    r.touchTimer = setInterval(() => {
      if (box.current !== r || !r.up) return;
      if (r.trackDirty && Date.now() - r.lastTrackAt >= TRACK_GAP_MS) track(r);
      // the count, painted only when the second changes, then the whistle
      const left = autoStartLeft(r);
      if (left !== r.startShown) {
        r.startShown = left;
        setStartsIn(left === 0 ? null : left);
      }
      if (left === 0) start();
      sinceTouch += TICK_MS;
      if (sinceTouch < TOUCH_EVERY_MS) return;
      sinceTouch = 0;
      if (r.host && r.session === null) {
        roomTouch(r.code, Math.min(r.present.length || 1, VS_MAX));
      }
    }, TICK_MS);
  };

  const quick = (rawName: string): void => {
    if (box.current !== null) return;
    const name = cleanName(rawName);
    void roomQuickmatch().then((r) => {
      if (r === null) {
        setNote('Quick match needs the rooms service. CREATE a room and share its code instead.');
        return;
      }
      void enter(r.code, r.created, name, true);
    });
  };

  const create = (rawName: string): void => {
    if (box.current !== null) return;
    const name = cleanName(rawName);
    void roomCreate().then((code) => {
      void enter(code ?? makeLocalCode(), true, name, false);
    });
  };

  const join = (rawName: string, code: string): void => {
    if (box.current !== null || code.length !== 5) return;
    void enter(code, false, cleanName(rawName), false);
  };

  const toggleReady = (): void => {
    const r = box.current;
    if (r === null || !r.up || (r.session !== null && !r.over)) return;
    r.ready = !r.ready;
    r.rseq++;
    setMyReady(r.ready);
    say(r, r.ready);
    trackSoon(r);
  };

  /**
   * A quick room counts itself down and then whistles.
   *
   * Three seconds, and not zero: starting the instant the last player taps
   * READY throws that player into a round with their thumb still on the
   * button, and strands anyone whose JOIN lands in the same moment. The count
   * is cancelled by anyone unreadying, leaving or joining, and a joiner needs
   * no special case because they arrive not-ready.
   *
   * @param r - the room to consider.
   */

  const leave = (): void => {
    const r = box.current;
    if (r === null) return;
    if (r.touchTimer !== null) clearInterval(r.touchTimer);
    r.socket?.close();
    try {
      void r.channel?.unsubscribe();
    } catch {
      // already down
    }
    closeRealtime();
    box.current = null;
    setStatus('idle');
    setMyRef('');
    setPresent([]);
    setMyReady(false);
    setOver(false);
    setStandings([]);
    setNote('');
    loopRef.current.leaveVersus();
  };

  // render reads STATE only (the compiler forbids refs here): the seat
  // list, the ready tally and the acting-host verdict derive from mirrors
  const seatList = present.slice(0, VS_MAX);
  let readyCount = 0;
  for (const p of seatList) {
    if (p.ref === myRef ? myReady : p.ready) readyCount++;
  }
  const readyStats = {
    seats: seatList.length,
    ready: readyCount,
    all: seatList.length >= VS_MIN && readyCount === seatList.length,
  };

  return {
    status,
    code: codeShown,
    note,
    present,
    myRef,
    myReady,
    isHost: myRef !== '' && seatList[0]?.ref === myRef,
    readyStats,
    startsIn,
    over,
    standings,
    quick,
    create,
    join,
    toggleReady,
    start,
    leave,
  };
}
