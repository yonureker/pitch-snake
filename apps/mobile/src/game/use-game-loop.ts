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
  stepParticles,
} from './renderer';

/** The page-side round phases, mirroring the web version. */
export type RoundPhase = 'ready' | 'countdown' | 'playing' | 'paused' | 'dead';

/** What the screen reads and calls. */
export interface GameLoop {
  /** The live engine instance; null until the loop's mount effect creates it. */
  game: React.RefObject<Game | null>;
  /** Recorded field picture, republished every frame. */
  picture: SharedValue<SkPicture>;
  phase: RoundPhase;
  score: number;
  best: number;
  /** Dress the snake (skin id, hat id); null wears classic. Menu-time only. */
  setWorn: (skin: string | null, hat: string | null) => void;
  /** 3, 2, 1 or START! while counting down, empty otherwise. */
  countText: string;
  /** '', 'WALLS FORMING' or 'WALLS LIVE'. */
  wallBanner: string;
  /** Why the last round ended, for the FULL TIME line. */
  deadReason: string;
  /** Selected speed in ms per cell (applies to the next round). */
  tickMs: number;
  setTickMs: (ms: number) => void;
  /** The ruleset the next round runs under; refused mid-round. */
  mode: RuleMode;
  setMode: (m: RuleMode) => void;
  /** M:SS remaining in a timed round, '' in an endless one. */
  clockText: string;
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
  tickMs: number;
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
  worn: { skin: string | null; hat: string | null };
  lastScore: number;
  lastBanner: string;
  lastCount: string;
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
    tickMs: SPEEDS.normal,
    mode: 'classic',
    lastClock: '',
    countClock: 0,
    pulseMs: 0,
    lastFrameTs: 0,
    atlas: null,
    boardPx: 1,
    worn: { skin: null, hat: null },
    lastScore: -1,
    lastBanner: '',
    lastCount: '',
  });
  const picture = useSharedValue<SkPicture>(makeEmptyPicture());

  const [phase, setPhase] = useState<RoundPhase>('ready');
  // whether the round in play carries a ticket, as state so the entry form
  // can gate on it without reading refs mid-render
  const [canSubmit, setCanSubmit] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [countText, setCountText] = useState('');
  const [wallBanner, setWallBanner] = useState('');
  const [deadReason, setDeadReason] = useState('');
  const [tickMs, setTickMsState] = useState<number>(SPEEDS.normal);
  const [mode, setModeState] = useState<RuleMode>('classic');
  const [clockText, setClockText] = useState('');
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
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setDeadReason(e.reason);
            box.phase = 'dead';
            setPhase('dead');
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
        }
      }
      if (box.phase === 'playing') {
        g.advance(dt);
        handleEvents(g, g.drainEvents(), cellPx);
        if (g.score !== box.lastScore) {
          box.lastScore = g.score;
          setScore(g.score);
          setBest((b) => (g.score > b ? g.score : b));
        }
        const banner =
          g.wallState === 'warning' ? 'WALLS FORMING'
          : g.wallState === 'solid' ? 'WALLS LIVE'
          : '';
        if (banner !== box.lastBanner) {
          box.lastBanner = banner;
          setWallBanner(banner);
        }
        const clock = g.durationMs > 0 ? fmtClock(g.durationMs - g.clockMs) : '';
        if (clock !== box.lastClock) {
          box.lastClock = clock;
          setClockText(clock);
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
      game.current = createGame({ seed, tickMs: box.tickMs, ...MODES[box.mode] });
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
    box.lastBanner = '';
    setWallBanner('');
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
    const g = game.current;
    if (g === null) return;
    // Stamp the press at the moment it happened, not at the last frame tick:
    // advance the sim to now before recording the input, so a turn can catch
    // a cell boundary that falls between frames. advance() quantizes, so this
    // is deterministic; events raised here queue for the frame loop's drain,
    // and the loop's own dt shrinks by the same amount (shared lastFrameTs).
    if (box.phase === 'playing' && box.lastFrameTs > 0) {
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
    return g.dirQueue[g.dirQueue.length - 1] ?? g.dir;
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

  const setTickMs = (ms: number): void => {
    boxRef.current.tickMs = ms;
    setTickMsState(ms);
  };

  // the outfit: an equip or a wallet answer dresses the snake; the renderer
  // rebakes its sprites on the new key at the next frame (the web's applyWorn)
  const setWorn = (skin: string | null, hat: string | null): void => {
    boxRef.current.worn = { skin, hat };
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
    score,
    best,
    countText,
    wallBanner,
    deadReason,
    tickMs,
    setTickMs,
    mode,
    setMode,
    clockText,
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
