// Hand-written surface types for the pure JS engine (kept buildless so the
// web page can import it raw). Extend as the mobile app consumes more.
export declare const ENGINE_VERSION: number;
export declare const GRID: number;
export declare const START_LEN: number;
export declare const SIM_DT: number;
export declare const SPEEDS: { slow: number; normal: number; fast: number };
export declare const FOOD_TTL: number;
export declare const BONUS_EVERY: number;
export declare const REGULAR_KINDS: number;
export declare const BONUS_KINDS: number;
export declare const WARN_MS: number;
export declare const SOLID_MS: number;
export declare const TNT_SCORES: number[];
export declare const GHOST_SCORES: number[];
export declare const GHOST_MS: number;
export declare const PORTAL_FIRST: number;
export declare const PORTAL_EVERY: number;
export declare const PORTAL_BONUS: number;
export declare const PORTAL_LIFE_MIN: number;
export declare const PORTAL_LIFE_MAX: number;
export declare const PORTAL_OPEN_MS: number;
export declare const PORTAL_WARN_MS: number;
export declare const PORTAL_MIN_GAP: number;
export declare const MIN_SPAWN_DIST: number;
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
}
export interface Portal { ax: number; ay: number; bx: number; by: number; used: boolean }
export interface Food extends Cell { bonus: boolean; kind: number }
export type GameEvent =
  | { t: 'food' }
  | { t: 'eat'; bonus: boolean; x: number; y: number }
  | { t: 'hop'; fromA: boolean; fx: number; fy: number; tx: number; ty: number }
  | { t: 'tnt'; x: number; y: number; lost: Cell[] }
  | { t: 'wall'; phase: 'off' | 'warning' | 'solid' }
  | { t: 'portal'; open: boolean }
  | { t: 'die'; reason: string };
export interface RoundLog {
  v: number; seed: number; tickMs: number; wallsEnabled: boolean;
  inputs: [number, number, number][]; end: number; finalScore: number;
}

export interface Game {
  seed: number; tickMs: number; wallsEnabled: boolean;
  alive: boolean; deadReason: string | null;
  quanta: number; clockMs: number; progMs: number; accMs: number;
  snake: Cell[]; snakeSet: Set<number>; tailFrom: Cell | null;
  dir: Cell; dirQueue: Cell[];
  headFrom: Cell; headMajX: number; headMajY: number;
  score: number; pendingGrowth: number;
  food: Food; foodAge: number; regularEaten: number;
  wallState: 'off' | 'warning' | 'solid'; wallPhaseEnd: number;
  wallCells: Cell[]; wallLookup: Set<number>;
  bombs: Cell[]; bombsUnlocked: number; bombPhase: 'gap' | 'active';
  bombNextAt: number; bombExpireAt: number;
  ghosts: Ghost[];
  portal: Portal | null; warpedIn: boolean;
  portalsUnlocked: number; portalsOpened: number; portalRetryAt: number;
  portalExpireAt: number; portalOpenedAt: number;
  events: GameEvent[]; log: RoundLog;
  setDir(x: number, y: number): void;
  clearQueue(): void;
  advance(dtMs: number): void;
  advanceQuanta(n: number): void;
  renderProg(): number;
  renderNow(): number;
  drainEvents(): GameEvent[];
  ghostAt(g: Ghost): Cell;
  portalEndAt(x: number, y: number): 0 | 1 | 2;
  cellOccupied(x: number, y: number): boolean;
  portalBusy(): boolean;
}

export declare function createGame(cfg?: { seed?: number; tickMs?: number; wallsEnabled?: boolean }): Game;
export declare function replay(log: RoundLog): Game;
