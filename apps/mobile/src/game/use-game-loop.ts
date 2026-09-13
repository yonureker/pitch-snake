/**
 * The round state machine and the frame loop.
 *
 * Owns the engine instance (one per round, freshly seeded so every round is
 * replay-verifiable), advances it by clamped real time, turns engine events
 * into particles and haptics, and republishes the recorded SkPicture through
 * a Reanimated shared value so the Canvas redraws without React rendering.
 * React state changes only when something a human reads changes: score, round
 * phase, countdown beat, wall banner.
 * @module
 */
import { Skia, type SkImage, type SkPicture } from '@shopify/react-native-skia';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import {
  createGame,
  GRID,
  MODES,
  SPEEDS,
  type Game,
  type GameEvent,
  type RoundLog,
} from '@pitch-snake/engine';
import type { NetSession } from '@pitch-snake/net';

import { type Kit, KIT_NONE } from '@/lib/kit';
import type { RuleMode } from '@/lib/modes';

import { loadPersonalBest, savePersonalBest } from '@/lib/personal-best';
import { issueSeed, type SeedTicket } from '@/lib/validate';

import { GameColors } from './theme';
import {
  bakeWallLayer,
  buildPicture,
  clearParticles,
  clearWallLayer,
  spawnBurst,
  spawnFloat,
  stepParticles,
} from './renderer';
import { resetVsSmoothing } from './vs-smoothing';

/** The page-side round phases, mirroring the web version. */
export type RoundPhase = 'ready' | 'countdown' | 'playing' | 'paused' | 'dead';

/** One seat in the live strip: who, how many, and whether they are still up. */
export interface SeatRow {
  /** the engine seat index, which is also the seat's colour */
  idx: number;
  name: string;
  score: number;
  alive: boolean;
  /** this device's own seat, which wears the gold and the underline */
  me: boolean;
  /** leading on score, so the crown rides here */
  leader: boolean;
}

/** What the screen reads and calls. */
export interface GameLoop {
  /** The live engine instance; null until the loop's mount effect creates it. */
  game: React.RefObject<Game | null>;
  /** Recorded field picture, republished every frame. */
  picture: SharedValue<SkPicture>;
  phase: RoundPhase;
  score: number;
  best: number;
  /** Dress the snake (skin id, hat id); null wears classic. Menu-time only.
   *  Leaves the kit alone: that is chosen, not bought, and has its own door. */
  setWorn: (skin: string | null, hat: string | null) => void;
  /** Put the shirt on: two colours and a number, all optional. Menu-time only. */
  setKit: (kit: Kit) => void;
  /** Hand over a room round: shared game, its session, my seat, kickoff lag. */
  startVersus: (
    g: Game,
    session: NetSession,
    myIdx: number,
    preElapsedMs: number,
    vsRc: { myIdx: number; names: string[]; fits: { skin: string | null; hat: string | null }[] },
  ) => void;
  /** The session says the round ended (or desynced): show FULL TIME. */
  endVersus: () => void;
  /** Concede the round: the seat stops steering and the snake runs out. */
  forfeit: () => void;
  /** Is FORFEIT offered right now (dead, and ahead of everyone alive)? */
  canForfeit: boolean;
  /** Whether this seat has conceded the round it is in. */
  forfeited: boolean;
  /** In a room: whether MY snake is still running. Solo rounds read true. */
  mySeatAlive: boolean;
  /**
   * The live seat strip, the page's mp-hud in data form: every seat in the
   * room ordered by score (ties by seat), leader first. Empty in a solo
   * round. Rebuilt only when a human-visible number changes, never per frame.
   */
  seats: SeatRow[];
  /**
   * The one status line beside the strip, most urgent first, '' for none.
   * The page's rule verbatim: a stalled wire is actionable, a clinch chase
   * decides the round, and SPECTATING is the least of the three because a
   * struck-through seat already says you are out.
   */
  seatNote: string;
  /** Out of the room, back to a solo ready screen. */
  leaveVersus: () => void;
  /** 3, 2, 1 or START! while counting down, empty otherwise. */
  countText: string;
  /** Why the last round ended, for the FULL TIME line. */
  deadReason: string;
  /** The ruleset the next round runs under; refused mid-round. */
  mode: RuleMode;
  setMode: (m: RuleMode) => void;
  /** M:SS remaining in a timed round, '' in an endless one. */
  clockText: string;
  /** 5..1 over the pitch in a timed round's closing seconds, '' otherwise. */
  lastCallText: string;
  /** Start a round from ready/dead, or resume from pause. */
  start: () => void;
  /** DEV-only: end the current round immediately (drives the FULL TIME UI). */
  debugDie: () => void;
  /** DEV-only frame meter: "fps avg / worst-frame ms", refreshed each second. */
  perfText: string;
  pause: () => void;
  /** Direction input from any source; gated on phase like the web page. */
  steer: (x: number, y: number) => void;
  /** Whether the round in play was seeded by a server ticket (validated
   *  scoring): only such a round may enter a board. */
  canSubmit: boolean;
  /** The finished round's evidence for the validator; null without a ticket.
   *  Event-handler use only: it reads the live refs. */
  roundForSubmit: () => { seedId: number; log: RoundLog } | null;
  /**
   * The direction the snake will actually be moving when the next input
   * lands: the tail of the turn queue if turns are pending, else the current
   * heading. This is the same reference setDir filters against, so the pad
   * can tell a live turn from a dead repeat or reversal. Null when no round
   * is accepting input.
   */
  effectiveHeading: () => { x: number; y: number } | null;
}

const COUNT_BEAT = 650;
const COUNT_GO = 450;
const COUNT_TOTAL = COUNT_BEAT * 3 + COUNT_GO;
const MAX_DT = 100;
// How many closing seconds of a timed round get counted onto the pitch
// itself (the web's LAST_CALL_FROM, ported). Five, because that is the point
// at which "how long is left" stops being information and starts being the
// thing you are playing; above it the clock line is plenty.
const LAST_CALL_FROM = 5;

// module scope: the compiler's purity rule refuses impure calls in component
// bodies; event handlers reach the clock through this instead
const nowMs = (): number => performance.now();

// M:SS from milliseconds remaining, ceiling seconds so 0:00 only shows at the whistle
function fmtClock(leftMs: number): string {
  const sec = Math.max(0, Math.ceil(leftMs / 1000));
  return `${String(Math.floor(sec / 60))}:${String(sec % 60).padStart(2, '0')}`;
}

function freshSeed(): number {
  const a = new Uint32Array(1);
  Crypto.getRandomValues(a);
  return a[0] ?? 1;
}

interface LoopBox {
  /** Pictures from the last two frames; [0] may still be replaying natively. */
  retired: (SkPicture | null)[];
  frameCount: number;
  frameWorst: number;
  frameWindowStart: number;
  phase: RoundPhase;
  mode: RuleMode;
  /** the last clock text pushed to state, so the DOM-ish update happens once a second */
  lastClock: string;
  /** performance.now() of the last sim advance (frame loop or input), 0 before the first frame. */
  lastFrameTs: number;
  countClock: number;
  pulseMs: number;
  atlas: SkImage | null;
  boardPx: number;
  /** What the snake wears; swapped at menu time by setWorn, read per frame. */
  worn: { skin: string | null; hat: string | null; kit: Kit };
  /** A room's round: the session drives the sim and myIdx is my seat. */
  session: NetSession | null;
  vsIdx: number;
  /** conceded this round: the seat sends nothing more (see forfeit) */
  forfeited: boolean;
  lastMineAlive: boolean;
  /** last pushed answer to "is FORFEIT offered", so state is written on change */
  lastCanForfeit: boolean;
  vsRc: { myIdx: number; names: string[]; fits: { skin: string | null; hat: string | null }[] } | null;
  lastScore: number;
  /** hash of what the seat strip shows, so it is rebuilt on change only */
  lastSeatHash: number;
  lastCount: string;
  /** the last closing-seconds number pushed to state ('' outside them) */
  lastCall: string;
  /**
   * The one press the countdown keeps (the web's pre-aim, ported). Presses
   * during the 3-2-1 used to flow into the engine's three-deep queue and
   * replay over the opening steps: taps from five seconds before the whistle
   * steering the round. Only the last press before kickoff means anything
   * (it is where you want to open), so the count holds exactly that one and
   * kickoff feeds it in.
   */
  preAim: { x: number; y: number } | null;
}

function makeEmptyPicture(): SkPicture {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return recorder.finishRecordingAsPicture();
}

/**
 * Drive the game. `boardPx` is the square field edge in dp; `atlas` the emoji
 * spritesheet once loaded.
 */
export function useGameLoop(boardPx: number, atlas: SkImage | null): GameLoop {
  // refs, never state: the loop mutates these every frame and the compiler's
  // immutability rule is right that state must not be written in place. They
  // are written only from effects and handlers, never during render.
  const game = useRef<Game | null>(null);
  // validated scoring: the next round's server ticket, and the one the round
  // on the table was seeded with (null = that round cannot enter a board)
  const pocket = useRef<SeedTicket | null>(null);
  const roundTicket = useRef<number | null>(null);
  const boxRef = useRef<LoopBox>({
    retired: [null, null],
    frameCount: 0,
    frameWorst: 0,
    frameWindowStart: 0,
    phase: 'ready',
    mode: 'classic',
    lastClock: '',
    countClock: 0,
    pulseMs: 0,
    lastFrameTs: 0,
    atlas: null,
    boardPx: 1,
    worn: { skin: null, hat: null, kit: KIT_NONE },
    session: null,
    forfeited: false,
    lastMineAlive: true,
    lastCanForfeit: false,
    vsIdx: -1,
    vsRc: null,
    lastScore: -1,
    lastSeatHash: 0,
    lastCount: '',
    lastCall: '',
    preAim: null,
  });
  const picture = useSharedValue<SkPicture>(makeEmptyPicture());

  const [phase, setPhase] = useState<RoundPhase>('ready');
  // mirrored into state because the render reads it; the ref is the truth the
  // frame loop consults (refs are not readable during render)
  const [forfeited, setForfeited] = useState(false);
  const [mySeatAlive, setMySeatAlive] = useState(true);
  const [canForfeit, setCanForfeit] = useState(false);
  // whether the round in play carries a ticket, as state so the entry form
  // can gate on it without reading refs mid-render
  const [canSubmit, setCanSubmit] = useState(false);
  const [score, setScore] = useState(0);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [seatNote, setSeatNote] = useState('');
  const [best, setBest] = useState(0);
  const [countText, setCountText] = useState('');
  const [deadReason, setDeadReason] = useState('');
  const [mode, setModeState] = useState<RuleMode>('classic');
  const [clockText, setClockText] = useState('');
  const [lastCallText, setLastCallText] = useState('');
  const [perfText, setPerfText] = useState('');

  // mirror render props into the loop's box after render, never during it
  useEffect(() => {
    boxRef.current.atlas = atlas;
    boxRef.current.boardPx = boardPx;
  }, [atlas, boardPx]);

  // the stored personal best arrives once, async, and only ever raises
  useEffect(() => {
    void loadPersonalBest('classic').then((stored) => {
      setBest((current) => (stored > current ? stored : current));
    });
  }, []);

  // These two are declared BEFORE the frame loop that calls them, rather than
  // beside the room's other helpers where they would read more naturally. The
  // React Compiler's immutability rule refuses a reference to a value declared
  // later in the component, because the earlier reader cannot see that value
  // change over time. canForfeitNow had been sitting on that error unnoticed
  // since it was written, because the mobile lint dies on an unrelated EPERM
  // before it ever reports.
  // Concede the CLAIM, keeping the seat and the corpse. Offered in one narrow
  // window (dead and still ahead of everyone alive), because that is the only
  // moment the room is playing on for a score nobody is defending. The
  // withdrawal rides the shared timeline, so every peer applies it at the
  // same quantum and the round can end on the spot.
  /** Dead, not already withdrawn, and ahead of every seat still alive. */
  const canForfeitNow = (): boolean => {
    const box = boxRef.current;
    const g = game.current;
    if (g === null || box.vsIdx < 0 || box.phase !== 'playing') return false;
    const mine = g.players[box.vsIdx];
    if (!mine || mine.alive || mine.withdrawn) return false;
    for (let i = 0; i < g.players.length; i++) {
      const p = g.players[i]; // noUncheckedIndexedAccess: possibly undefined
      if (p !== undefined && i !== box.vsIdx && p.alive && p.score >= mine.score) return false;
    }
    return true;
  };

  /**
   * Rebuild the live seat strip, but only when it would actually look
   * different. This is the page's mpHudHash trick ported whole: the strip is
   * read every frame and changes a few times a second, so a fresh array per
   * frame would push React state sixty times a second to say the same thing.
   * The hash folds each seat's score and whether it is still up, which is
   * everything the strip draws, so an unchanged hash means an unchanged strip.
   */
  const syncSeats = (g: Game): void => {
    const box = boxRef.current;
    let h = (box.session?.stalled === true ? 2 : 0) | (box.forfeited ? 4 : 0) | 8;
    let up = 0;
    let lastIdx = -1;
    for (let i = 0; i < g.players.length; i++) {
      const p = g.players[i];
      if (p === undefined) continue;
      h = (Math.imul(h, 131) + p.score * 2 + (p.alive ? 1 : 0)) | 0;
      if (p.alive) {
        up++;
        lastIdx = i;
      }
    }
    if (h === box.lastSeatHash) return;
    box.lastSeatHash = h;

    const names = box.vsRc?.names ?? [];
    const order: number[] = [];
    for (let i = 0; i < g.players.length; i++) order.push(i);
    order.sort((a, b) => (g.players[b]?.score ?? 0) - (g.players[a]?.score ?? 0) || a - b);
    const rows: SeatRow[] = [];
    for (let k = 0; k < order.length; k++) {
      const i = order[k] ?? 0;
      const p = g.players[i];
      if (p === undefined) continue;
      rows.push({
        idx: i,
        name: names[i] ?? '?',
        score: p.score,
        alive: p.alive,
        me: i === box.vsIdx,
        leader: k === 0,
      });
    }
    setSeats(rows);

    // the clinch chase: with one seat left, how many points until the round
    // ends on the spot. Only meaningful while somebody is actually alone.
    let chase = 0;
    if (up === 1 && lastIdx >= 0) {
      let bestOther = -Infinity;
      for (let i = 0; i < g.players.length; i++) {
        const p = g.players[i];
        if (p !== undefined && i !== lastIdx && p.score > bestOther) bestOther = p.score;
      }
      const lead = g.players[lastIdx]?.score ?? 0;
      if (lead <= bestOther) chase = bestOther + 1 - lead;
    }
    const mine = box.vsIdx >= 0 ? g.players[box.vsIdx] : undefined;
    let othersAlive = false;
    for (let i = 0; i < g.players.length; i++) {
      const p = g.players[i];
      if (p !== undefined && i !== box.vsIdx && p.alive) {
        othersAlive = true;
        break;
      }
    }
    // ONE status at a time, most urgent first; see the field's doc comment
    const note =
      box.session?.stalled === true ? 'WAITING…'
      : box.forfeited ? 'FORFEITED'
      : chase > 0 ?
        lastIdx === box.vsIdx ?
          `${chase} TO CLINCH`
        : `${names[lastIdx] ?? '?'} NEEDS ${chase}`
      : mine !== undefined && !mine.alive && othersAlive ? 'SPECTATING'
      : '';
    setSeatNote(note);
  };

  useEffect(() => {
    const box = boxRef.current;
    game.current ??= createGame({ seed: freshSeed(), tickMs: SPEEDS.normal });
    const handleEvents = (g: Game, events: GameEvent[], cellPx: number): void => {
      for (const e of events) {
        switch (e.t) {
          case 'eat': {
            void Haptics.impactAsync(
              e.bonus ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
            );
            const color = e.bonus ? GameColors.goldBright : GameColors.food;
            spawnBurst(e.x, e.y, cellPx, e.bonus ? 30 : 16, 0.5, cellPx / 14, (cellPx / 14) * 2, () => color);
            if (box.mode !== 'survival' && (box.vsIdx < 0 || e.player === box.vsIdx))
              spawnFloat(e.x, e.y, cellPx, e.bonus ? '+5' : '+1', true);
            break;
          }
          case 'hop': {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const leave = e.fromA ? GameColors.portalA : GameColors.portalB;
            const arrive = e.fromA ? GameColors.portalB : GameColors.portalA;
            spawnBurst(e.fx, e.fy, cellPx, 14, 0.7, (cellPx / 14) * 0.8, (cellPx / 14) * 2.6, () => leave);
            spawnBurst(e.tx, e.ty, cellPx, 26, 0.7, cellPx / 14, (cellPx / 14) * 3.2, (i) =>
              i % 3 === 0 ? GameColors.goldBright : arrive,
            );
            if (box.mode !== 'survival' && (box.vsIdx < 0 || e.player === box.vsIdx))
              spawnFloat(e.tx, e.ty, cellPx, '+5', true);
            break;
          }
          case 'tnt': {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            for (const t of e.lost) {
              spawnBurst(t.x, t.y, cellPx, 6, 0.9, (cellPx / 14) * 0.5, (cellPx / 14) * 1.7, () => '#f4ecd8');
            }
            spawnBurst(e.x, e.y, cellPx, 26, 0.6, cellPx / 13, (cellPx / 13) * 3.4, (i) =>
              i % 3 === 0 ? GameColors.wall : '#3a3630',
            );
            if (box.mode !== 'survival' && (box.vsIdx < 0 || e.player === box.vsIdx))
              spawnFloat(e.x, e.y, cellPx, '-5', false);
            break;
          }
          case 'wall': {
            if (e.phase === 'warning') bakeWallLayer(g, box.boardPx, false);
            else if (e.phase === 'solid') bakeWallLayer(g, box.boardPx, true);
            break;
          }
          case 'zap': {
            // the bolt landed: the pack drags for five seconds
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            break;
          }
          case 'save': {
            // the doom window paid off: a light tap for the great escape
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            break;
          }
          case 'die': {
            // In a room only MY death buzzes, and the round plays on around
            // the fallen: phase 'dead' arrives from the session's onEnd.
            if (box.vsIdx >= 0) {
              if (e.player === box.vsIdx) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              }
              break;
            }
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setDeadReason(e.reason);
            box.phase = 'dead';
            setPhase('dead');
            box.lastCall = '';
            setLastCallText('');
            const finalScore = game.current?.score ?? 0;
            setBest((current) => {
              if (finalScore > current) {
                void savePersonalBest(box.mode, finalScore);
                return finalScore;
              }
              return current;
            });
            break;
          }
          default:
            break;
        }
      }
    };

    let raf = 0;
    box.lastFrameTs = 0;
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      if (box.lastFrameTs === 0) box.lastFrameTs = now;
      let dt = now - box.lastFrameTs;
      box.lastFrameTs = now;
      if (dt > MAX_DT) dt = MAX_DT;
      else if (dt < 0) dt = 0;
      box.pulseMs += dt;

      const g = game.current;
      if (g === null) return;
      const cellPx = box.boardPx / GRID;

      if (box.phase === 'countdown') {
        box.countClock += dt;
        const beat = Math.min(3, (box.countClock / COUNT_BEAT) | 0);
        const text = beat === 3 ? 'START!' : String(3 - beat);
        if (text !== box.lastCount) {
          box.lastCount = text;
          setCountText(text);
        }
        if (box.countClock >= COUNT_TOTAL) {
          box.lastCount = '';
          setCountText('');
          box.phase = 'playing';
          setPhase('playing');
          // the one press the countdown held opens the round on its first step
          if (box.preAim !== null) {
            const aim = box.preAim;
            box.preAim = null;
            if (box.session !== null) {
              if (!box.forfeited) box.session.localDir(aim.x, aim.y, now);
            } else g.setDir(aim.x, aim.y);
          }
        }
      }
      if (box.phase === 'playing') {
        // a room's session owns pacing against the peers; solo advances by dt
        if (box.session !== null) box.session.frame(now);
        else g.advance(dt);
        handleEvents(g, g.drainEvents(), cellPx);
        const myScore = box.vsIdx >= 0 ? (g.players[box.vsIdx]?.score ?? 0) : g.score;
        // FORFEIT retires the moment my own seat goes down, so the actions
        // follow the round rather than waiting for a phase change
        if (box.vsIdx >= 0) {
          const alive = g.players[box.vsIdx]?.alive ?? false;
          if (alive !== box.lastMineAlive) {
            box.lastMineAlive = alive;
            setMySeatAlive(alive);
          }
          // the forfeit window opens and shuts as the room plays: dead, and
          // still ahead of everyone alive. Derived per frame, pushed to state
          // only when the answer changes (performance rule 8's spirit).
          const can = canForfeitNow();
          if (can !== box.lastCanForfeit) {
            box.lastCanForfeit = can;
            setCanForfeit(can);
          }
          syncSeats(g);
        }
        if (myScore !== box.lastScore) {
          box.lastScore = myScore;
          setScore(myScore);
          // BEST is a solo statistic; a room's score rides its own board
          if (box.vsIdx < 0) setBest((b) => (myScore > b ? myScore : b));
        }
        const clock = g.durationMs > 0 ? fmtClock(g.durationMs - g.clockMs) : '';
        if (clock !== box.lastClock) {
          box.lastClock = clock;
          setClockText(clock);
        }
        const leftMs = g.durationMs > 0 ? g.durationMs - g.clockMs : 0;
        const call = leftMs > 0 && leftMs <= LAST_CALL_FROM * 1000 ? String(Math.ceil(leftMs / 1000)) : '';
        if (call !== box.lastCall) {
          box.lastCall = call;
          setLastCallText(call);
        }
      }
      stepParticles(dt);
      if (__DEV__) {
        box.frameCount++;
        if (dt > box.frameWorst) box.frameWorst = dt;
        if (now - box.frameWindowStart >= 1000) {
          if (box.frameWindowStart > 0) {
            const fps = Math.round((box.frameCount * 1000) / (now - box.frameWindowStart));
            setPerfText(`${String(fps)} fps · worst ${box.frameWorst.toFixed(1)}ms`);
          }
          box.frameWindowStart = now;
          box.frameCount = 0;
          box.frameWorst = 0;
        }
      }
      const previous = picture.value;
      picture.value = buildPicture(g, {
        boardPx: box.boardPx,
        atlas: box.atlas,
        pulseMs: box.pulseMs,
        playing: box.phase === 'playing',
        worn: box.worn,
        // the rollback count rides along so the paint can absorb a corrected
        // past rather than teleport through it; see game/vs-smoothing.ts
        vs: box.vsRc === null ? undefined : { ...box.vsRc, rollbacks: box.session?.stats.rollbacks ?? 0 },
      });
      // Dispose pictures deterministically, two frames late: the newest
      // retired one may still be mid-replay on the render thread, and leaving
      // them to the GC is exactly what flickers - a finalizer can release the
      // native picture while the canvas is drawing it.
      const stale = box.retired[1];
      if (stale !== null && stale !== undefined) stale.dispose();
      box.retired[1] = box.retired[0] ?? null;
      box.retired[0] = previous;
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [picture]);

  const start = (): void => {
    const box = boxRef.current;
    if (box.phase === 'dead' || box.phase === 'ready') {
      // A real round spends a pocketed server ticket: its seed makes the
      // finished log submittable (validated scoring). Without one the round
      // plays identically and just cannot enter a board. The pocket refills
      // right away so the round after this one is covered.
      let seed = freshSeed();
      roundTicket.current = null;
      const ticket = pocket.current;
      pocket.current = null;
      if (ticket !== null && Date.now() - ticket.at < 90 * 60 * 1000) {
        seed = ticket.seed;
        roundTicket.current = ticket.id;
      }
      void issueSeed().then((next) => {
        pocket.current ??= next;
      });
      setCanSubmit(roundTicket.current !== null);
      // one pace for everyone (the SPEED setting retired 2026-09-10, with
      // the web's): every solo score competes at the same tick, as rooms
      // always have. SPEEDS keeps its values in the engine for old logs.
      game.current = createGame({ seed, tickMs: SPEEDS.normal, ...MODES[box.mode] });
      game.current.drainEvents();
      box.lastClock = game.current.durationMs > 0 ? fmtClock(game.current.durationMs) : '';
      setClockText(box.lastClock);
      clearParticles();
      clearWallLayer();
      box.lastScore = -1;
      setScore(0);
    } else {
      game.current?.clearQueue();
    }
    box.countClock = 0;
    box.lastCount = '3';
    setCountText('3');
    box.lastCall = '';
    setLastCallText('');
    box.preAim = null; // a press from the menus is not an aim
    box.phase = 'countdown';
    setPhase('countdown');
  };

  const pause = (): void => {
    const box = boxRef.current;
    if (box.phase === 'playing') {
      box.phase = 'paused';
      setPhase('paused');
    }
  };

  const steer = (x: number, y: number): void => {
    const box = boxRef.current;
    if (box.phase !== 'playing' && box.phase !== 'countdown') return;
    if (box.phase === 'countdown') {
      box.preAim = { x, y };
      return;
    }
    const g = game.current;
    if (g === null) return;
    if (box.session !== null) {
      // a conceded seat sends nothing more, which is exactly what a dropped
      // peer does: the snake runs on its last heading and crashes on its own,
      // every peer sees the identical round, and the rating is whatever the
      // placing was worth (see supabase/RATING_RULES.md)
      if (box.forfeited) return;
      // the session stamps the true press time, broadcasts it, and feeds
      // the shared timeline (the web's dirInput, netcode edition)
      box.session.localDir(x, y, nowMs());
      return;
    }
    // Stamp the press at the moment it happened, not at the last frame tick:
    // advance the sim to now before recording the input, so a turn can catch
    // a cell boundary that falls between frames. advance() quantizes, so this
    // is deterministic; events raised here queue for the frame loop's drain,
    // and the loop's own dt shrinks by the same amount (shared lastFrameTs).
    // past the countdown hold above, the phase here is always 'playing'
    if (box.lastFrameTs > 0) {
      const now = nowMs();
      let dt = now - box.lastFrameTs;
      if (dt > MAX_DT) dt = MAX_DT;
      if (dt > 0) {
        g.advance(dt);
        box.lastFrameTs = now;
      }
    }
    g.setDir(x, y);
  };

  const effectiveHeading = (): { x: number; y: number } | null => {
    const box = boxRef.current;
    if (box.phase !== 'playing' && box.phase !== 'countdown') return null;
    const g = game.current;
    if (g === null) return null;
    const pl = box.vsIdx >= 0 ? (g.players[box.vsIdx] ?? g) : g;
    return pl.dirQueue[pl.dirQueue.length - 1] ?? pl.dir;
  };

  const debugDie = (): void => {
    const g = game.current;
    if (g === null || boxRef.current.phase !== 'playing') return;
    // steer the head into its own body deterministically: the engine decides
    // the death, so even the debug path exercises the real die flow
    g.snake.length = 0;
    g.snakeSet.clear();
    for (const [x, y] of [
      [5, 5],
      [4, 5],
      [5, 6],
      [5, 7],
    ] as const) {
      g.snake.push({ x, y });
      g.snakeSet.add(x * GRID + y);
    }
    g.dir = { x: 0, y: 1 };
    g.dirQueue.length = 0;
  };

  // the outfit: an equip or a wallet answer dresses the snake; the renderer
  // rebakes its sprites on the new key at the next frame (the web's applyWorn)
  const setWorn = (skin: string | null, hat: string | null): void => {
    // Merge, never replace: the kit rides in the same object and comes from
    // the PROFILE rather than the wallet, so a wallet answer landing after a
    // kit would otherwise undress the shirt. The web's applyWorn carries the
    // identical guard for the identical reason.
    boxRef.current.worn = { ...boxRef.current.worn, skin, hat };
  };

  // the kit's own door, since it is chosen rather than bought and arrives on
  // its own beat (the profile query, not the wallet)
  const setKit = (kit: Kit): void => {
    boxRef.current.worn = { ...boxRef.current.worn, kit };
  };

  // ---- a room's round (the session drives, this loop renders) ----
  // The kickoff hands over a shared game and its net session; the countdown
  // pre-elapses by how late the kickoff reached this device, so every screen
  // whistles at the same absolute moment (the web's skew clamp).
  const startVersus = (
    g: Game,
    session: NetSession,
    myIdx: number,
    preElapsedMs: number,
    vsRc: { myIdx: number; names: string[]; fits: { skin: string | null; hat: string | null }[] },
  ): void => {
    const box = boxRef.current;
    game.current = g;
    g.drainEvents();
    // a fresh round shares nothing with the last one, and a leftover paint
    // offset would draw its first frame crooked
    resetVsSmoothing();
    box.session = session;
    box.vsIdx = myIdx;
    box.forfeited = false; // a new round is a new chance to play it
    setForfeited(false);
    box.lastMineAlive = true;
    setMySeatAlive(true);
    box.vsRc = vsRc;
    roundTicket.current = null;
    setCanSubmit(false);
    clearParticles();
    clearWallLayer();
    box.lastScore = -1;
    setScore(0);
    setDeadReason('');
    box.lastClock = '';
    setClockText('');
    box.lastCall = '';
    setLastCallText('');
    box.preAim = null; // a press from the lobby is not an aim
    box.countClock = Math.min(1200, Math.max(0, preElapsedMs));
    box.lastCount = '';
    box.phase = 'countdown';
    setPhase('countdown');
  };

  const forfeit = (): void => {
    const box = boxRef.current;
    if (box.session === null || !canForfeitNow()) return;
    box.session.localExit(false, nowMs());
    box.forfeited = true;
    setForfeited(true);
  };

  const endVersus = (): void => {
    const box = boxRef.current;
    if (box.vsIdx < 0) return;
    box.phase = 'dead';
    setPhase('dead');
    box.lastCall = '';
    setLastCallText('');
  };

  // walking out of the room: back to a solo ready screen with a preview game
  const leaveVersus = (): void => {
    const box = boxRef.current;
    // walking out concedes, and the room is told on the shared timeline
    // before the session is let go: the seat withdraws and its body leaves
    // the board at once, so nobody steers around a snake whose player has gone
    if (box.session !== null && box.vsIdx >= 0 && box.phase === 'playing') {
      try {
        box.session.localExit(true, nowMs());
      } catch {
        // a room that cannot be told is a room being left anyway
      }
    }
    box.session = null;
    box.vsIdx = -1;
    box.vsRc = null;
    // the strip belongs to the room, so it goes out with it: leaving to a
    // solo screen with five seats still listed is a scoreboard for a game
    // nobody is playing
    box.lastSeatHash = 0;
    setSeats([]);
    setSeatNote('');
    game.current = createGame({ seed: freshSeed(), tickMs: SPEEDS.normal });
    game.current.drainEvents();
    clearParticles();
    clearWallLayer();
    box.lastScore = -1;
    setScore(0);
    box.phase = 'ready';
    setPhase('ready');
  };

  // The ruleset for the NEXT round; refused mid-round so a running game can
  // never change shape under the player. BEST swaps with it: zero first so a
  // stale value never shows, then the stored best raises it when it arrives
  // (and only if the mode is still the one it was loaded for).
  const setMode = (m: RuleMode): void => {
    const box = boxRef.current;
    if (box.phase !== 'ready' && box.phase !== 'dead') return;
    if (box.mode === m) return;
    box.mode = m;
    setModeState(m);
    setBest(0);
    void loadPersonalBest(m).then((stored) => {
      if (boxRef.current.mode === m) setBest((current) => (stored > current ? stored : current));
    });
  };

  // the pocket fills at mount so the very first round can carry a ticket
  useEffect(() => {
    void issueSeed().then((first) => {
      pocket.current ??= first;
    });
  }, []);

  // the finished round's evidence for the validator; null without a ticket.
  // An event-handler read (never render): it touches the live refs.
  const roundForSubmit = (): { seedId: number; log: RoundLog } | null => {
    const finished = game.current;
    if (!finished || roundTicket.current === null) return null;
    return { seedId: roundTicket.current, log: finished.log };
  };

  return {
    game,
    picture,
    phase,
    setWorn,
    setKit,
    startVersus,
    endVersus,
    forfeit,
    canForfeit,
    forfeited,
    mySeatAlive,
    seats,
    seatNote,
    leaveVersus,
    score,
    best,
    countText,
    deadReason,
    mode,
    setMode,
    clockText,
    lastCallText,
    start,
    pause,
    steer,
    effectiveHeading,
    debugDie,
    perfText,
    canSubmit,
    roundForSubmit,
  };
}
