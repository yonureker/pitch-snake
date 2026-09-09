/**
 * Rollback smoothing: absorbing a corrected past into the paint, not the sim.
 *
 * OWNS one offset per drawn segment and nothing else. It is told the players,
 * how many rollbacks the session has done and how long the frame was, and it
 * answers where each segment should be PAINTED. The simulation never sees any
 * of it.
 *
 * WHY. A rival's turn reaches us about a wire trip late, so the session rewinds
 * and re-simulates with it: correct, and invisible on a fast link. Over a long
 * one the corrected position can be a cell or two from where that snake was
 * just drawn, and the honest thing to paint is a teleport, roughly once a
 * second. This absorbs the jump as a per-segment offset and decays it away over
 * about 90ms, so the correction arrives as a wave running down the body instead
 * of the whole snake lurching sideways.
 *
 * WHY PER SEGMENT rather than one offset for the snake: a correction is largest
 * at the head and zero at the settled tail, and moving the whole body by the
 * head's error made the tail shake. This is the web page's approach, ported;
 * the two clients smooth the same way so a room looks the same on every screen.
 *
 * WHY IT IS SAFE TO LIE. Rival snakes pass through each other in the engine
 * (engine.test.js, "multi-snake: snakes pass through each other"), so a body
 * painted a fraction of a cell from its true position cannot change any
 * outcome. It is paint, and only paint.
 *
 * MUST NEVER allocate: this runs once per frame over every segment of every
 * snake (performance rule 4). Everything below is a preallocated typed array.
 *
 * @module vs-smoothing
 */
import { GRID, type Game, type Player } from '@pitch-snake/engine';

/** How many segments deep the smoothing reaches. */
const VS_SEG = 64;
/** The most seats a room holds. */
const VS_SEATS = 5;
/** How fast an absorbed correction fades, as a time constant in ms. */
const DECAY_MS = 90;
/** A correction bigger than this (in cells, squared) is a teleport, and snaps. */
const MAX_ABSORB_SQ = 6.25;
/** Below this the offset is spent, and is zeroed so it cannot creep. */
const SETTLED_SQ = 0.0001;

const offX = new Float64Array(VS_SEATS * VS_SEG);
const offY = new Float64Array(VS_SEATS * VS_SEG);
const lastX = new Float64Array(VS_SEATS * VS_SEG);
const lastY = new Float64Array(VS_SEATS * VS_SEG);
/** How many segments each seat carried last frame; a longer snake has no history. */
const segN = new Int32Array(VS_SEATS);
let seenRollbacks = 0;
let lastPulseMs = -1;

/** The shortest way between two cells across the tunnel wrap. */
function wrapDelta(v: number): number {
  return (((v % GRID) + GRID * 1.5) % GRID) - GRID / 2;
}

/**
 * Forget everything. Called at kickoff, because a fresh round shares nothing
 * with the last one and a stale offset would paint the first frame crooked.
 */
export function resetVsSmoothing(): void {
  offX.fill(0);
  offY.fill(0);
  segN.fill(0);
  seenRollbacks = 0;
  lastPulseMs = -1;
}

/**
 * How many of a seat's segments have a smoothed position this frame.
 *
 * @param seat - the player index.
 * @returns the count; segments at or past it should be drawn unsmoothed.
 */
export function smoothDepth(seat: number): number {
  return seat < 0 || seat >= VS_SEATS ? 0 : (segN[seat] ?? 0);
}

/**
 * Where a segment should be painted, along the tunnel's x.
 *
 * @param seat - the player index.
 * @param i - the segment, head first.
 * @returns the x this segment should be painted at, in cells.
 */
export function smoothX(seat: number, i: number): number {
  return lastX[seat * VS_SEG + i] ?? 0;
}

/**
 * Where a segment should be painted, along the tunnel's y.
 *
 * @param seat - the player index.
 * @param i - the segment, head first.
 * @returns the y this segment should be painted at, in cells.
 */
export function smoothY(seat: number, i: number): number {
  return lastY[seat * VS_SEG + i] ?? 0;
}

/**
 * Fold this frame's correction, if there was one, into the paint offsets.
 *
 * Call once per frame, before anything is drawn, and only in a room. A
 * rollback is detected by the session's own counter changing rather than by
 * comparing positions, so an ordinary step is never mistaken for a correction.
 *
 * @param game - the round, read for its players and their per-snake progress.
 * @param rollbacks - the session's rollback count; any change means the past
 *   was rewritten since the last frame.
 * @param pulseMs - the renderer's continuous clock, used only for the frame
 *   length. The first frame after a reset simply establishes the baseline.
 * @param playing - false once the round has stopped, when every glide is done.
 * @param posOf - the renderer's own segment glide. Pass the function itself
 *   rather than a closure over it: this is a draw path, and a closure built
 *   per frame is an allocation per frame. It may return a reused scratch
 *   object, which is why the result is read immediately.
 */
export function updateVsSmoothing(
  game: Game,
  rollbacks: number,
  pulseMs: number,
  playing: boolean,
  posOf: (pl: Player, i: number, p: number) => { cx: number; cy: number },
): void {
  const players = game.players;
  const corrected = rollbacks !== seenRollbacks;
  seenRollbacks = rollbacks;
  const dt = lastPulseMs < 0 ? 16 : Math.max(0, Math.min(100, pulseMs - lastPulseMs));
  lastPulseMs = pulseMs;
  const decay = Math.exp(-dt / DECAY_MS);

  for (let seat = 0; seat < players.length && seat < VS_SEATS; seat++) {
    const pl = players[seat];
    if (pl === undefined) continue;
    const base = seat * VS_SEG;
    const n = Math.min(pl.snake.length, VS_SEG);
    // per snake, once: a rival dragged by a bolt is on a longer step than you
    const prog = playing ? game.renderProg(seat) : 1;
    for (let i = 0; i < n; i++) {
      const k = base + i;
      const rp = posOf(pl, i, prog);
      if (i >= (segN[seat] ?? 0)) {
        // a segment with no history: it has just grown, so there is nothing
        // to glide from and its true position is the honest one
        offX[k] = 0;
        offY[k] = 0;
      } else if (corrected) {
        const dx = wrapDelta((lastX[k] ?? 0) - rp.cx);
        const dy = wrapDelta((lastY[k] ?? 0) - rp.cy);
        const absorb = dx * dx + dy * dy <= MAX_ABSORB_SQ;
        offX[k] = absorb ? dx : 0;
        offY[k] = absorb ? dy : 0;
      } else {
        offX[k] = (offX[k] ?? 0) * decay;
        offY[k] = (offY[k] ?? 0) * decay;
        if ((offX[k] ?? 0) ** 2 + (offY[k] ?? 0) ** 2 < SETTLED_SQ) {
          offX[k] = 0;
          offY[k] = 0;
        }
      }
      lastX[k] = rp.cx + (offX[k] ?? 0);
      lastY[k] = rp.cy + (offY[k] ?? 0);
    }
    segN[seat] = n;
  }
}
