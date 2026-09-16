/**
 * The texture painters: what a skin's `texture.id` LOOKS like, drawn once
 * into one segment tile at bake time on either client.
 *
 * OWNS the motifs and nothing else. Each painter is handed a surface already
 * CLIPPED to the rounded segment shape by the caller (clipping is not in the
 * dialect, and keeping it client-side is what let this package stay free of
 * any canvas import), a tile size, and the skin's ink(s); it paints across
 * the whole size x size square and lets the clip do the cropping.
 *
 * THE RULES A MOTIF LIVES BY, set by where these tiles end up:
 *
 *   Legible at 16 device pixels. A phone cell is that small, so no mark
 *   thinner than ~7% of the tile and no detail that needs more than two
 *   colours to read. The reference sheets are 100px swatches; these are not.
 *
 *   Orientation-neutral. A segment sprite is stamped at any board position
 *   and the body turns corners, so nothing may depend on neighbouring tiles
 *   lining up: each tile is its own complete mark, which is also true of a
 *   real snake's scales.
 *
 *   Bake-time only. A painter runs when a skin is equipped or the board
 *   resizes, never per frame; extravagance here costs nothing at 60fps,
 *   exactly like the ring patterns before it.
 *
 * MUST NEVER read the DOM, import a canvas, or know which client is baking:
 * the page hands its real 2d context in, the app wraps Skia in the same
 * adapter the hats draw through.
 *
 * @module skin-texture
 */
import type { HatSurface } from './hat-surface.js';
/** A texture painter: one segment tile, `s` px square, pre-clipped. */
export type SkinTexturePainter = (c: HatSurface, s: number, ink: string, ink2: string | null) => void;
/**
 * The catalogue of motifs, keyed by the id a SkinArt names.
 *
 * Geometric tier: dots, pinstripe, crosshatch, zigzag, chequer, roundel,
 * argyle. Ornamental tier: scales, waves, ocelli, diamondback, mosaic.
 */
export declare const SKIN_TEXTURES: Record<string, SkinTexturePainter>;
/**
 * The painter a texture id resolves to, or null for an id this build has
 * never heard of, which the caller treats as "no texture": the same
 * fall-back-to-less contract every cosmetic here obeys.
 *
 * @param id A SkinArt texture id.
 * @returns The painter, or null.
 */
export declare function textureFor(id: string | null | undefined): SkinTexturePainter | null;
