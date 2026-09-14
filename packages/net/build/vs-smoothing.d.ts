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
 * head's error made the tail shake. It lives in packages/net because it is the
 * paint-side half of the rollback the session performs, and because it was a
 * copy in each client until 2026-09-14: the two clients smooth the same way so
 * a room looks the same on every screen, which one module guarantees and two
 * ports only promise.
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
import { type Game, type Player } from '@pitch-snake/engine';
/**
 * Forget everything. Called at kickoff, because a fresh round shares nothing
 * with the last one and a stale offset would paint the first frame crooked.
 */
export declare function resetVsSmoothing(): void;
/**
 * How many of a seat's segments have a smoothed position this frame.
 *
 * @param seat - the player index.
 * @returns the count; segments at or past it should be drawn unsmoothed.
 */
export declare function smoothDepth(seat: number): number;
/**
 * Where a segment should be painted, along the tunnel's x.
 *
 * @param seat - the player index.
 * @param i - the segment, head first.
 * @returns the x this segment should be painted at, in cells.
 */
export declare function smoothX(seat: number, i: number): number;
/**
 * Where a segment should be painted, along the tunnel's y.
 *
 * @param seat - the player index.
 * @param i - the segment, head first.
 * @returns the y this segment should be painted at, in cells.
 */
export declare function smoothY(seat: number, i: number): number;
/**
 * A segment's paint OFFSET alone, for a renderer that computes its own glide
 * and nudges it, rather than reading the absolute position back. Zero for a
 * seat outside the table (solo passes -1) and past the smoothed depth, so the
 * caller can add it unconditionally.
 *
 * @param seat - the player index, or -1 outside a room.
 * @param i - the segment, head first.
 * @returns cells to add to this segment's own rendered x.
 */
export declare function smoothOffX(seat: number, i: number): number;
/**
 * The y half of `smoothOffX`; same guards, same use.
 *
 * @param seat - the player index, or -1 outside a room.
 * @param i - the segment, head first.
 * @returns cells to add to this segment's own rendered y.
 */
export declare function smoothOffY(seat: number, i: number): number;
/**
 * Fold this frame's correction, if there was one, into the paint offsets.
 *
 * Call once per frame, before anything is drawn, and only in a room. A
 * rollback is detected by the session's own counter changing rather than by
 * comparing positions, so an ordinary step is never mistaken for a correction.
 *
 * @param game - the round, read for its players and their per-snake progress.
 * @param rollbacks - the session's rollback count; any change means the past
 *   was rewritten since the last frame. Pass null when there is no session to
 *   ask (a room still assembling), which reads as "nothing changed".
 * @param pulseMs - the renderer's continuous clock, used only for the frame
 *   length. The first frame after a reset simply establishes the baseline.
 * @param playing - false once the round has stopped, when every glide is done.
 * @param posOf - the renderer's own segment glide. Pass the function itself
 *   rather than a closure over it: this is a draw path, and a closure built
 *   per frame is an allocation per frame. It may return a reused scratch
 *   object, which is why the result is read immediately.
 */
export declare function updateVsSmoothing(game: Game, rollbacks: number | null, pulseMs: number, playing: boolean, posOf: (pl: Player, i: number, p: number) => {
    cx: number;
    cy: number;
}): void;
