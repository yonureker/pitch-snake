/**
 * The outfits: what a skin, a hat and a shirt LOOK like.
 *
 * OWNS the catalogue of wearable art and the drawing of it. A skin is a colour
 * ramp plus an optional crest; a hat is a footprint, a seat on the head and a
 * draw call; a shirt is a number in 8-bit blocks. Every entry keys on its
 * `pitch_snake_items` id, which is the economy's contract: the SERVER sells ids
 * and prices, the client owns what those ids look like, and an id this build
 * has never heard of falls back to classic. That fallback is what lets the
 * catalogue grow by SQL alone without stranding a page somebody left open.
 *
 * MUST NEVER know what is being worn, where it is on the pitch, or how big a
 * cell is. Nothing here reads `cell`, `ctx`, the round, or the profile: every
 * function is told its context and its size and draws into it. That is what
 * makes this a leaf (see page/README.md) and it is also why the shop can call
 * the very same functions for its previews, so a preview cannot lie about what
 * the money buys.
 *
 * MUST NEVER be reached from the frame loop. All of it is bake-time work: the
 * shell renders these once into offscreen canvases on a resize or a change of
 * clothes and blits them per frame (performance rule 7).
 *
 * ART IS NOT RULES. None of this crosses into packages/engine: a cosmetic in
 * the engine would chain every new hat to an ENGINE_VERSION bump and a
 * validator re-pin, which is absurd for content. The catalogues themselves
 * (hats, skins, textures, jersey) live in the shared cosmetics package and
 * are re-exported here, so both clients draw one set of numbers.
 *
 * @module pitch-art
 */

// The skins moved to the shared cosmetics package on 2026-09-16, the hats'
// own move applied to the body: the table lived here and again in the app's
// theme.ts, and the pattern drop would have doubled a duplicated table. The
// re-exports keep every existing import working; the ramp + ring math lives
// once in shadeRgbFor, and buildLutFor below is now the page's thin wrapper
// turning those numbers into the CSS strings its frame loop reads (rule 5).
// The hats made the move first (2026-09-14); these keep their imports whole.
export { HATS, hatFor } from '@pitch-snake/cosmetics/hat-art';
export type { HatArt } from '@pitch-snake/cosmetics/hat-art';
export { SKINS, skinFor, SNAKE_SHADES, shadeRgbFor } from '@pitch-snake/cosmetics/skin-art';
export type { SkinArt } from '@pitch-snake/cosmetics/skin-art';
export { SKIN_TEXTURES, textureFor } from '@pitch-snake/cosmetics/skin-texture';
export type { SkinTexturePainter } from '@pitch-snake/cosmetics/skin-texture';
import { SNAKE_SHADES, shadeRgbFor, type SkinArt } from '@pitch-snake/cosmetics/skin-art';

/**
 * The body's shades from head to tail, as ready-made fill strings.
 *
 * Performance rule 5: the per-segment loop reads this table and never builds
 * a `rgb(...)` string, so it is computed once per change of skin and never in
 * a frame. The numbers come from the shared shadeRgbFor, so the app's Skia
 * colours and these strings can never drift apart.
 *
 * @param skin The skin to ramp.
 * @returns `SNAKE_SHADES` fill styles, head first.
 */
export function buildLutFor(skin: SkinArt): string[] {
  return Array.from({ length: SNAKE_SHADES }, (_, i) => {
    const [r, g, b] = shadeRgbFor(skin, i / (SNAKE_SHADES - 1));
    return `rgb(${r}, ${g}, ${b})`;
  });
}

/**
 * Trace a rounded rectangle onto a context, leaving it as the current path.
 *
 * The caller fills or strokes it, which is why this traces rather than paints:
 * the wall layer clips with it, the jersey fills then strokes it.
 *
 * @param c The context to trace onto.
 * @param x Left edge, in pixels.
 * @param y Top edge, in pixels.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param rad Corner radius in pixels.
 */
export function roundRectOn(
  c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number,
): void {
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}

/**
 * The crest: five teeth hanging off the head, longest in the middle.
 *
 * Part of the SKIN rather than a thing you wear, so it takes the skin's colours
 * and a skin with none draws nothing. The bases sit above the sprite's top so
 * they tuck behind the head instead of ending in a straight line across it, and
 * the fan shape (rather than a comb) is what stops it reading as teeth.
 *
 * @param c The context to draw into.
 * @param w The sprite's width in pixels.
 * @param h The sprite's height in pixels.
 * @param skin The skin whose crest colours to use; one without a crest is a
 *   no-op, so the caller need not check.
 */
export function drawCrest(
  c: CanvasRenderingContext2D, w: number, h: number, skin: SkinArt,
): void {
  if (skin.spikes === null) return;
  const n = 5, toothW = w / n;
  for (let i = 0; i < n; i++) {
    const mid = (i + 0.5) * toothW;
    const fall = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);   // 0 at the ends, 1 in the middle
    const len = h * (0.58 + 0.42 * fall);
    c.fillStyle = (i % 2 ? skin.spikes : skin.spikesAlt) ?? skin.spikes;
    c.beginPath();
    c.moveTo(mid - toothW * 0.62, -h * 0.2);
    c.lineTo(mid + toothW * 0.62, -h * 0.2);
    c.lineTo(mid, len);
    c.closePath();
    c.fill();
  }
}

// The shirt's shared half (glyphs, trim, defaults, dealt numbers, digit
// layout) moved to the cosmetics package on 2026-09-14, so a number cannot
// render differently on two screens; the re-export keeps imports working.
export {
  JERSEY_LEFT_DEFAULT, JERSEY_RIGHT_DEFAULT, JERSEY_SOLO_NUM, VS_NUMS,
} from '@pitch-snake/cosmetics/jersey';
import {
  JERSEY_LEFT_DEFAULT, JERSEY_RIGHT_DEFAULT, JERSEY_TRIM, jerseyDigitCells,
} from '@pitch-snake/cosmetics/jersey';

/**
 * Paint one shirt: two colour halves, a rounded edge, a centred number.
 *
 * Worn on the square behind the head. Both halves and the number are the
 * player's own since 2026-09-07; the defaults are the classic yellow and red
 * this shipped as. The colours arrive already washed by page/kit.ts, so a
 * caller that skips that wash is the bug, not a bad hex here.
 *
 * The dark outline stroke is load-bearing rather than decorative now that the
 * halves are free-form: it is what keeps a kit chosen close to the pitch's own
 * green readable as a shape instead of a hole.
 *
 * @param c The context to paint into.
 * @param s The shirt's size in pixels; it is square.
 * @param num The number on the back.
 * @param left The left half as `#rrggbb`; the classic yellow when omitted.
 * @param right The right half as `#rrggbb`; the classic red when omitted.
 */
export function paintJersey(
  c: CanvasRenderingContext2D,
  s: number,
  num: number,
  left: string | null = null,
  right: string | null = null,
): void {
  c.clearRect(0, 0, s, s);
  c.save();
  roundRectOn(c, 0, 0, s, s, s * 0.3);
  c.clip();
  c.fillStyle = left ?? JERSEY_LEFT_DEFAULT; c.fillRect(0, 0, s / 2, s);
  c.fillStyle = right ?? JERSEY_RIGHT_DEFAULT; c.fillRect(s / 2, 0, s / 2, s);
  c.restore();
  roundRectOn(c, 0.5, 0.5, s - 1, s - 1, s * 0.3);
  c.strokeStyle = 'rgba(33,30,26,0.55)';
  c.lineWidth = Math.max(1, s * 0.05);
  c.stroke();
  // the digit geometry is shared (see the jersey module for the trim's why);
  // this side only fills the cells it is handed
  const { px, cells } = jerseyDigitCells(num, s);
  const ink = (color: string, dx: number, dy: number): void => {
    c.fillStyle = color;
    for (const [x, y] of cells) c.fillRect(x + dx, y + dy, px, px);
  };
  for (const [dx, dy] of JERSEY_TRIM) ink('rgba(33,30,26,0.85)', dx, dy);
  ink('#ffffff', 0, 0);
}
