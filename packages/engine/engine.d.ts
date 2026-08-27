// Hand-written surface types for the pure JS engine (kept buildless so the
// web page can import it raw). Extend as the mobile app consumes more.
export declare const ENGINE_VERSION: number;
/** Round presets: a mode is a config. Spread MODES[name] into createGame. */
export declare const MODES: { classic: GameConfig; speedrun: GameConfig; survival: GameConfig };
export declare const GRID: number;
export declare const START_LEN: number;
export declare const SIM_DT: number;
/** One board holds at most this many snakes. */
export declare const MAX_PLAYERS: number;
export declare const SPEEDS: { slow: number; normal: number; fast: number };
export declare const FOOD_TTL: number;
export declare const BONUS_EVERY: number;
export declare const REGULAR_KINDS: number;
export declare const BONUS_KINDS: number;
export declare const WARN_MS: number;
export declare const REDIRECT_MS: number;
export declare const SOLID_MS: number;
export declare const TNT_SCORES: number[];
export declare const GHOST_SCORES: number[];
export declare const GHOST_MS: number;
export declare const BOLT_EVERY: number;
export declare const BOLT_LIFE_MS: number;
export declare const BOLT_SLOW_MS: number;
export declare const GHOST_SLOW_MS: number;
export declare const PORTAL_FIRST: number;
export declare const PORTAL_EVERY: number;
export declare const PORTAL_BONUS: number;
export declare const PORTAL_LIFE_MIN: number;
export declare const PORTAL_LIFE_MAX: number;
export declare const PORTAL_OPEN_MS: number;
export declare const PORTAL_WARN_MS: number;
export declare const PORTAL_MIN_GAP: number;
export declare const MIN_SPAWN_DIST: number;
export declare const SURVIVAL_CLEAR: number;
/** How long a survival board stays clear before its first full TNT wave. */
export declare const SURVIVAL_TNT_FIRST: number;
export declare function portalMark(n: number): number;
export declare function K(x: number, y: number): number;
export declare function wrap(v: number): number;
export declare function wrapDist(ax: number, ay: number, bx: number, by: number): number;
export declare function ghostProgress(g: Ghost, nowMs: number): number;
export declare function ghostRenderPos(g: Ghost, nowMs: number, out?: { cx: number; cy: number }): { cx: number; cy: number };

export interface Cell { x: number; y: number }
export interface Ghost extends Cell {
  px: number;
  py: number;
  dir: Cell;
  warped: boolean;
  /** Personality by spawn order: 0 chaser, 1 ambusher, 2 flanker, 3 cutoff, 4 warden. */
  role?: number;
  majX?: number; majY?: number;
  moveAt: number;
  /** Span of the step it is currently taking: GHOST_MS, or GHOST_SLOW_MS
   *  while a bolt is in effect. Interpolate the glide against this. */
  stepMs?: number;
}
export interface Portal { ax: number; ay: number; bx: number; by: number; used: boolean }
export interface Food extends Cell { bonus: boolean; kind: number }
/** The thunderbolt waiting on the pitch; taking it drags the ghosts. */
export interface Bolt extends Cell { bornAt: number }

/**
 * One snake on the board. A one-snake game exposes players[0] under the
 * classic singular names on Game as well; new code should read players[i].
 */
export interface Player {
  /** Index in the players array; also the input log's player column. */
  idx: number;
  snake: Cell[]; snakeSet: Set<number>; tailFrom: Cell | null;
  headFrom: Cell; headMajX: number; headMajY: number;
  dir: Cell; dirQueue: Cell[];
  score: number; pendingGrowth: number;
  warpedIn: boolean;
  /** A fatal move hanging in its doom window (rule 25); kept after a doom
   *  death so renderers can draw the head where it reached. */
  doom: Doom | null;
  /** A save pressed during that window, taken by the next quantum. */
  doomSave: Cell | null;
  alive: boolean; deadReason: string | null;
  /** Quantum this snake went down on; 0 while alive. */
  diedAt: number;
}

export interface Doom {
  tx: number; ty: number; until: number; reason: string;
}

export type GameEvent = (
  | { t: 'food' }
  | { t: 'eat'; player: number; bonus: boolean; x: number; y: number }
  | { t: 'hop'; player: number; fromA: boolean; fx: number; fy: number; tx: number; ty: number }
  | { t: 'tnt'; player: number; x: number; y: number; lost: Cell[] }
  | { t: 'wall'; phase: 'off' | 'warning' | 'solid' }
  | { t: 'portal'; open: boolean }
  | { t: 'ghost'; n: number }
  /** A bolt arriving on the pitch (gone: false) or expiring unclaimed (gone: true). */
  | { t: 'bolt'; gone: boolean; x: number; y: number }
  /** A bolt taken: the pack drags until untilMs on the sim clock. */
  | { t: 'zap'; player: number; x: number; y: number; untilMs: number }
  | { t: 'save'; player: number; x: number; y: number }
  /** `segments` is present only when the round continues without this snake
   *  (its body left the board); a round-ending death keeps the body. */
  | { t: 'die'; player: number; reason: string; segments?: Cell[] }
  /** The sim quantum the event happened on: a rollback resim re-emits events
   *  for quanta a renderer may already have shown. */
) & { q: number };

export interface RoundLog {
  v: number; seed: number; tickMs: number; wallsEnabled: boolean;
  durationMs?: number; startGhosts?: number; startBombs?: number; bombFirstMs?: number;
  /** Snakes on the board; absent in v4 (single-snake era) logs. */
  players?: number;
  /** [quantum, x, y] triples; a fourth column names the player when players > 1. */
  inputs: ([number, number, number] | [number, number, number, number])[];
  end: number; finalScore: number;
  /** Stamped on multi-snake rounds only. */
  finalScores?: number[]; diedAt?: number[];
}

/** Opaque full-simulation snapshot for rollback; feed it back to restore(). */
export interface GameSnapshot { readonly quanta: number }

export interface Game {
  seed: number; tickMs: number; wallsEnabled: boolean; bombFirstMs: number;
  /** Round liveness: any snake still up. Writing it revives player 0 (test hook). */
  alive: boolean;
  /** Player 0's cause of death, under the classic name. */
  deadReason: string | null;
  /** 0 = endless; a timed round ends with deadReason 'time' at exactly this clock. */
  durationMs: number;
  quanta: number; clockMs: number; progMs: number; accMs: number;
  /** Every snake on the board; a solo round has exactly one. */
  players: Player[];
  // The classic singular surface: live aliases of players[0], reads and writes.
  snake: Cell[]; snakeSet: Set<number>; tailFrom: Cell | null;
  dir: Cell; dirQueue: Cell[];
  headFrom: Cell; headMajX: number; headMajY: number;
  score: number; pendingGrowth: number;
  doom: Doom | null;
  food: Food; foodAge: number;
  /** Regular items eaten since the last ringed bonus; resets on one, or on missing one. */
  bonusStreak: number;
  /** Items eaten by anyone this round; every BOLT_EVERY of them drops a bolt. */
  itemsEaten: number;
  /** The bolt waiting to be taken, if one is out. */
  bolt: Bolt | null;
  boltsSpawned: number;
  /** Sim clock the ghosts stop dragging at; 0 when nobody has taken a bolt. */
  slowUntil: number;
  wallState: 'off' | 'warning' | 'solid'; wallPhaseEnd: number;
  wallCells: Cell[]; wallLookup: Set<number>;
  bombs: Cell[]; bombsUnlocked: number; bombPhase: 'gap' | 'active';
  bombNextAt: number; bombExpireAt: number;
  ghosts: Ghost[];
  portal: Portal | null; warpedIn: boolean;
  portalsUnlocked: number;
  /** Teleport marks consumed; a pair closed unused hands its mark back. */
  portalMarksSpent: number;
  portalRetryAt: number;
  portalExpireAt: number; portalOpenedAt: number;
  events: GameEvent[]; log: RoundLog;
  /** Steer a snake; the shells that know one snake omit the player index. */
  setDir(x: number, y: number, player?: number): void;
  clearQueue(): void;
  advance(dtMs: number): void;
  advanceQuanta(n: number): void;
  /** Copy the full sim state (rollback netcode); allocation is fine here. */
  snapshot(): GameSnapshot;
  /** Reinstate a snapshot taken from THIS game; the log rewinds with it. */
  restore(s: GameSnapshot): void;
  renderProg(): number;
  renderNow(): number;
  drainEvents(): GameEvent[];
  ghostAt(g: Ghost): Cell;
  portalEndAt(x: number, y: number): 0 | 1 | 2;
  cellOccupied(x: number, y: number): boolean;
  portalBusy(): boolean;
}

export interface GameConfig {
  seed?: number; tickMs?: number; wallsEnabled?: boolean; durationMs?: number;
  startGhosts?: number; startBombs?: number;
  /**
   * Delay before the first TNT wave, in ms (default 0, meaning the seeded
   * wave stands on the board from the whistle). Must be a multiple of SIM_DT.
   */
  bombFirstMs?: number;
  /** Snakes on one shared board, 1..MAX_PLAYERS (default 1). */
  players?: number;
}
export declare function createGame(cfg?: GameConfig): Game;
export declare function replay(log: RoundLog): Game;
