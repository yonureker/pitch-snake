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
 * validator re-pin, which is absurd for content. The mobile app carries the
 * same catalogue ported to Skia in apps/mobile/src/game/pitch-art.ts, because
 * only the numbers are shared: `quadraticCurveTo` on a 2D context and a
 * `Skia.Path` are different enough that a common drawing language would cost
 * more than the duplicated coordinates.
 *
 * @module pitch-art
 */

/** One skin's colour ramp, outline, and the crest that some skins carry. */
export interface SkinArt {
  /** The head's colour, as r/g/b in 0..255. */
  head: readonly number[];
  /** The tail's colour; every segment interpolates between the two. */
  tail: readonly number[];
  /** The outline that rides every segment. */
  line: string;
  /** The crest's colour, or null for a skin that wears none. */
  spikes: string | null;
  /** The crest's second colour, alternating tooth by tooth. */
  spikesAlt: string | null;
}

// The hats grew past this file's ceiling and moved to their own module
// (hat-art.ts); the re-export below keeps every existing import working.
export { HATS, hatFor } from './hat-art.js';
export type { HatArt } from './hat-art.js';

/**
 * The skins.
 *
 * `classic` is the bare snake and `viper` stays the blue curio with the crest
 * that ?skin=viper has always summoned; the `skin-` ids are what the shop
 * sells. Rival BODIES wear this clothing too, so these ramps are not the local
 * player's alone; VS_COLORS in the page survive as name tags and roster dots,
 * which are identity rather than clothing.
 */
export const SKINS = {
  classic:      { head: [244, 236, 216], tail: [214, 196, 158], line: 'rgba(194,162,90,0.65)',
                  spikes: null, spikesAlt: null },
  viper:        { head: [ 88, 168, 246], tail: [ 24,  74, 150], line: 'rgba(150,110,235,0.75)',
                  spikes: '#9a5cf0', spikesAlt: '#7b3fd6' },
  'skin-away':  { head: [248, 248, 252], tail: [172, 194, 222], line: 'rgba(70,110,180,0.65)',
                  spikes: null, spikesAlt: null },
  'skin-volt':  { head: [250, 240, 104], tail: [172, 142, 24],  line: 'rgba(64,60,36,0.6)',
                  spikes: null, spikesAlt: null },
  'skin-rosa':  { head: [252, 186, 208], tail: [212, 106, 148], line: 'rgba(214,80,130,0.6)',
                  spikes: null, spikesAlt: null },
  'skin-night': { head: [226, 231, 241], tail: [ 36,  42,  56], line: 'rgba(122,132,160,0.55)',
                  spikes: null, spikesAlt: null },
  'skin-gilt':  { head: [252, 232, 152], tail: [194, 150, 56],  line: 'rgba(140,100,30,0.7)',
                  spikes: null, spikesAlt: null },
} as const satisfies Record<string, SkinArt>;


// The catalogues are authored as literals so their keys stay literal, and read
// through these widened views so an id from the server (or from a rival's
// presence payload, or a URL) can be looked up without a cast. Under
// noUncheckedIndexedAccess an unknown id reads as undefined, which is exactly
// the fallback the economy asks for.
const SKIN_BY_ID: Record<string, SkinArt> = SKINS;

/**
 * The skin an id resolves to. Unknown, null and empty all wear classic.
 *
 * @param id A `pitch_snake_items` id, or null for "nothing equipped".
 * @returns Always a skin: this never fails, because a client that has not heard
 *   of next month's item still has to draw a snake.
 */
export function skinFor(id: string | null | undefined): SkinArt {
  return (id ? SKIN_BY_ID[id] : undefined) ?? SKINS.classic;
}


/**
 * How many shades a body ramp holds.
 *
 * Exported because the renderer indexes the ramp by it: how long the table is
 * belongs to whoever builds the table.
 */
export const SNAKE_SHADES = 64;

/**
 * The body's shades from head to tail, as ready-made fill strings.
 *
 * Performance rule 5: the per-segment loop reads this table and never builds a
 * `rgb(...)` string, so it is computed once per change of skin and never in a
 * frame.
 *
 * @param skin The skin to ramp.
 * @returns `SNAKE_SHADES` fill styles, head first.
 */
export function buildLutFor(skin: SkinArt): string[] {
  return Array.from({ length: SNAKE_SHADES }, (_, i) => {
    const t = i / (SNAKE_SHADES - 1);
    const h = skin.head, l = skin.tail;
    const r = (h[0] ?? 0) + ((l[0] ?? 0) - (h[0] ?? 0)) * t;
    const g = (h[1] ?? 0) + ((l[1] ?? 0) - (h[1] ?? 0)) * t;
    const b = (h[2] ?? 0) + ((l[2] ?? 0) - (h[2] ?? 0)) * t;
    return `rgb(${Math.trunc(r)}, ${Math.trunc(g)}, ${Math.trunc(b)})`;
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

/**
 * The number DEALT to each room seat, which is what a player who has chosen no
 * shirt number wears, and the fallback when two players chose the same one.
 * Solo keeps the classic ten.
 *
 * It stopped being the whole story on 2026-09-07, when numbers became a player
 * choice, but it did not stop mattering: it is still what keeps a five-a-side
 * from fielding five number tens. `kitNumbersFor` in page/kit.ts is where the
 * two meet.
 */
export const VS_NUMS = [10, 7, 9, 4, 8] as const;

/**
 * 3x5 pixel glyphs, 0-9, so a shirt can wear any number.
 *
 * Blocks rather than text on purpose: 8-bit at this size, and immune to which
 * fonts a device happens to ship, which is the same reason the flags are a
 * sprite rather than regional-indicator pairs.
 */
const JERSEY_GLYPH: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};

/**
 * The eight offsets the number's dark trim is drawn at, so a digit is outlined
 * on every side rather than shadowed on one. See the note in `paintJersey`.
 */
const JERSEY_TRIM = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

/**
 * The number a snake wears when its player has chosen none: the classic ten.
 * A room deals from `VS_NUMS` instead, so this is the solo answer and the one
 * every preview shows.
 */
export const JERSEY_SOLO_NUM = 10;

/** The classic shirt's left half, worn when a player has chosen no colour. */
export const JERSEY_LEFT_DEFAULT = '#f2c114';

/** The classic shirt's right half, worn when a player has chosen no colour. */
export const JERSEY_RIGHT_DEFAULT = '#d8231f';

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
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- digits of a number, never text: there is nothing here for a code point to break.
  const digits = [...String(num)];
  const px = Math.max(1, Math.round(s * 0.11));
  const w = digits.length * 4 - 1;   // 3px per glyph plus a 1px gap, less the trailing gap
  const x0 = Math.round((s - px * w) / 2), y0 = Math.round((s - px * 5) / 2);
  const ink = (color: string, dx: number, dy: number): void => {
    c.fillStyle = color;
    for (let d = 0; d < digits.length; d++) {
      const glyph = JERSEY_GLYPH[digits[d] ?? ''];
      if (!glyph) continue;
      for (let r = 0; r < 5; r++)
        for (let k = 0; k < 3; k++)
          if (glyph[r]?.[k] === '1') c.fillRect(x0 + d * px * 4 + k * px + dx, y0 + r * px + dy, px, px);
    }
  };
  // A TRIM, not a drop shadow, and this is the one place free-form colours
  // forced a change to the art. White digits over a one-sided shadow read
  // perfectly on the classic yellow-and-red, and vanish on a white kit, which
  // is one of the commonest shirts there is: only the shadow's edge survived,
  // so the number became an outline of itself. Every direction instead, which
  // is how a real shirt number is trimmed, and it holds on any two colours a
  // player picks without the art overriding either of them. Eight passes at
  // BAKE time, so it costs a frame nothing (performance rule 7).
  for (const [dx, dy] of JERSEY_TRIM) ink('rgba(33,30,26,0.85)', dx, dy);
  ink('#ffffff', 0, 0);
}
