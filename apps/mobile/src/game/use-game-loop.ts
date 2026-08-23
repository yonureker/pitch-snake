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

import { createGame, GRID, SPEEDS, type Game, type GameEvent } from '@pitch-snake/engine';

import { loadPersonalBest, savePersonalBest } from '@/lib/personal-best';

import { GameColors } from './theme';
import { buildPicture, clearParticles, spawnBurst, stepParticles } from './renderer';

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
  /** 3, 2, 1 or START! while counting down, empty otherwise. */
  countText: string;
  /** '', 'WALLS FORMING' or 'WALLS LIVE'. */
  wallBanner: string;
  /** Why the last round ended, for the FULL TIME line. */
  deadReason: string;
  /** Selected speed in ms per cell (applies to the next round). */
  tickMs: number;
  setTickMs: (ms: number) => void;
  /** Start a round from ready/dead, or resume from pause. */
  start: () => void;
  /** DEV-only: end the current round immediately (drives the FULL TIME UI). */
  debugDie: () => void;
  pause: () => void;
  /** Direction input from any source; gated on phase like the web page. */
  steer: (x: number, y: number) => void;
}

const COUNT_BEAT = 650;
const COUNT_GO = 450;
const COUNT_TOTAL = COUNT_BEAT * 3 + COUNT_GO;
const MAX_DT = 100;

function freshSeed(): number {
  const a = new Uint32Array(1);
  Crypto.getRandomValues(a);
  return a[0] ?? 1;
}

interface LoopBox {
  /** Pictures from the last two frames; [0] may still be replaying natively. */
  retired: (SkPicture | null)[];
  phase: RoundPhase;
  tickMs: number;
  countClock: number;
  pulseMs: number;
  atlas: SkImage | null;
  boardPx: number;
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
  const boxRef = useRef<LoopBox>({
    retired: [null, null],
    phase: 'ready',
    tickMs: SPEEDS.normal,
    countClock: 0,
    pulseMs: 0,
    atlas: null,
    boardPx: 1,
    lastScore: -1,
    lastBanner: '',
    lastCount: '',
  });
  const picture = useSharedValue<SkPicture>(makeEmptyPicture());

  const [phase, setPhase] = useState<RoundPhase>('ready');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [countText, setCountText] = useState('');
  const [wallBanner, setWallBanner] = useState('');
  const [deadReason, setDeadReason] = useState('');
  const [tickMs, setTickMsState] = useState<number>(SPEEDS.normal);

  // mirror render props into the loop's box after render, never during it
  useEffect(() => {
    boxRef.current.atlas = atlas;
    boxRef.current.boardPx = boardPx;
  }, [atlas, boardPx]);

  // the stored personal best arrives once, async, and only ever raises
  useEffect(() => {
    void loadPersonalBest().then((stored) => {
      setBest((current) => (stored > current ? stored : current));
    });
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    game.current ??= createGame({ seed: freshSeed(), tickMs: SPEEDS.normal });
    const handleEvents = (events: GameEvent[], cellPx: number): void => {
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
          case 'die': {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setDeadReason(e.reason);
            box.phase = 'dead';
            setPhase('dead');
            const finalScore = game.current?.score ?? 0;
            setBest((current) => {
              if (finalScore > current) {
                void savePersonalBest(finalScore);
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
    let last = 0;
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      if (last === 0) last = now;
      let dt = now - last;
      last = now;
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
        handleEvents(g.drainEvents(), cellPx);
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
      }
      stepParticles(dt);
      const previous = picture.value;
      picture.value = buildPicture(g, {
        boardPx: box.boardPx,
        atlas: box.atlas,
        pulseMs: box.pulseMs,
        playing: box.phase === 'playing',
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
      game.current = createGame({ seed: freshSeed(), tickMs: box.tickMs });
      game.current.drainEvents();
      clearParticles();
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
    game.current?.setDir(x, y);
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

  return {
    game,
    picture,
    phase,
    score,
    best,
    countText,
    wallBanner,
    deadReason,
    tickMs,
    setTickMs,
    start,
    pause,
    steer,
    debugDie,
  };
}
