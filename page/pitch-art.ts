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

/** One hat's art: its footprint, where it sits, and how to draw it. */
export interface HatArt {
  /** Width as a fraction of a cell. */
  wf: number;
  /** Height as a fraction of a cell. */
  hf: number;
  /** Where it sits relative to the head's centre. */
  dy: (cellPixels: number, height: number) => number;
  /** How to draw it into a canvas of the given size. */
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
}

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

/**
 * The hats.
 *
 * Drawn rather than lettered, unlike the flag: there is no standalone cowboy
 * hat in the emoji set (the one that exists is a whole face), and art beats a
 * glyph for a skin anyway, since it depends on no platform's font and every
 * device draws the same shapes. `classic` is the felt hat a bare hat slot has
 * always worn; the `hat-` ids are bought.
 */
export const HATS = {
  classic: {
    wf: 1.5, hf: 0.95,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.62,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.72;             // where the brim sits in the sprite
      // the crown: a tapered shape with the dented top a felt hat has
      c.fillStyle = '#8a5a2b';
      c.beginPath();
      c.moveTo(midX - w * 0.2, brimY);
      c.lineTo(midX - w * 0.165, h * 0.3);
      c.quadraticCurveTo(midX - w * 0.1, h * 0.11, midX - w * 0.045, h * 0.2);
      c.quadraticCurveTo(midX, h * 0.3, midX + w * 0.045, h * 0.2);
      c.quadraticCurveTo(midX + w * 0.1, h * 0.11, midX + w * 0.165, h * 0.3);
      c.lineTo(midX + w * 0.2, brimY);
      c.closePath();
      c.fill();
      // the band, where the crown meets the brim
      c.fillStyle = '#42291a';
      c.fillRect(midX - w * 0.205, brimY - h * 0.16, w * 0.41, h * 0.13);
      // the brim: wide, and curling up at the tips, which is the whole
      // silhouette of the thing at this size
      c.fillStyle = '#9a6631';
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.06);
      c.quadraticCurveTo(midX, brimY + h * 0.26, midX + w * 0.5, brimY - h * 0.06);
      c.quadraticCurveTo(midX, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.06);
      c.closePath();
      c.fill();
    },
  },
  'hat-band': {
    wf: 1.06, hf: 0.3,
    // across the forehead, not above it: a sweatband is worn, not perched
    dy: (cellPixels: number) => -cellPixels * 0.38,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#e6402a';
      c.beginPath();
      c.moveTo(h / 2, 0); c.lineTo(w - h / 2, 0);
      c.arc(w - h / 2, h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
      c.lineTo(h / 2, h);
      c.arc(h / 2, h / 2, h / 2, Math.PI / 2, -Math.PI / 2);
      c.closePath();
      c.fill();
      c.fillStyle = '#f6efde';
      c.fillRect(w * 0.14, h * 0.38, w * 0.72, h * 0.24);
    },
  },
  'hat-cap': {
    wf: 1.35, hf: 0.62,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.38 - height * 0.58,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the terrace flat cap, face on: a low tweed dome over a slim brim
      c.fillStyle = '#6b5b45';
      c.beginPath();
      c.moveTo(w * 0.06, h * 0.78);
      c.quadraticCurveTo(w * 0.1, h * 0.1, w * 0.5, h * 0.08);
      c.quadraticCurveTo(w * 0.9, h * 0.1, w * 0.94, h * 0.78);
      c.closePath();
      c.fill();
      // the button on the crown
      c.fillStyle = '#57482f';
      c.fillRect(w * 0.46, h * 0.02, w * 0.08, h * 0.1);
      // the brim, a darker sliver curling across the front
      c.fillStyle = '#4c3f2c';
      c.beginPath();
      c.moveTo(w * 0.04, h * 0.76);
      c.quadraticCurveTo(w * 0.5, h * 1.02, w * 0.96, h * 0.76);
      c.quadraticCurveTo(w * 0.5, h * 0.8, w * 0.04, h * 0.76);
      c.closePath();
      c.fill();
    },
  },
  'hat-crown': {
    wf: 1.1, hf: 0.72,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.52,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // three points, jewelled tips, a solid base band: royalty at 20px
      c.fillStyle = '#f0c440';
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.92);
      c.lineTo(w * 0.08, h * 0.3);
      c.lineTo(w * 0.28, h * 0.58);
      c.lineTo(w * 0.5, h * 0.06);
      c.lineTo(w * 0.72, h * 0.58);
      c.lineTo(w * 0.92, h * 0.3);
      c.lineTo(w * 0.92, h * 0.92);
      c.closePath();
      c.fill();
      c.fillStyle = '#a87d1e';
      c.fillRect(w * 0.08, h * 0.78, w * 0.84, h * 0.14);
      c.fillStyle = '#e6402a';
      c.beginPath();
      c.arc(w * 0.5, h * 0.1, w * 0.05, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-sombrero': {
    // wide is the whole point, but capped: any wider and it shades the cell
    // behind the head on the pitch
    wf: 1.6, hf: 0.85,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.68;
      // the crown: a tall straw cone with a blunt top
      c.fillStyle = '#e0b45c';
      c.beginPath();
      c.moveTo(midX - w * 0.17, brimY);
      c.lineTo(midX - w * 0.08, h * 0.08);
      c.quadraticCurveTo(midX, 0, midX + w * 0.08, h * 0.08);
      c.lineTo(midX + w * 0.17, brimY);
      c.closePath();
      c.fill();
      // the band: a red stripe where crown meets brim
      c.fillStyle = '#c23b2a';
      c.fillRect(midX - w * 0.175, brimY - h * 0.17, w * 0.35, h * 0.15);
      // the brim: very wide, curling up hard at the tips
      c.fillStyle = '#caa04e';
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.22);
      c.quadraticCurveTo(midX - w * 0.42, brimY + h * 0.16, midX, brimY + h * 0.2);
      c.quadraticCurveTo(midX + w * 0.42, brimY + h * 0.16, midX + w * 0.5, brimY - h * 0.22);
      c.quadraticCurveTo(midX + w * 0.38, brimY + h * 0.02, midX, brimY + h * 0.04);
      c.quadraticCurveTo(midX - w * 0.38, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.22);
      c.closePath();
      c.fill();
    },
  },
  'hat-beret': {
    wf: 1.2, hf: 0.45,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.45,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the soft disc, drooping to the right the way a beret slumps
      c.fillStyle = '#b03040';
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.82);
      c.quadraticCurveTo(w * 0.02, h * 0.3, w * 0.34, h * 0.2);
      c.quadraticCurveTo(w * 0.72, h * 0.04, w * 0.95, h * 0.5);
      c.quadraticCurveTo(w * 0.99, h * 0.78, w * 0.86, h * 0.84);
      c.closePath();
      c.fill();
      // the stalk on top, the one detail that says beret and not pancake
      c.fillStyle = '#7c1f2c';
      c.fillRect(w * 0.47, h * 0.02, w * 0.06, h * 0.22);
      // the snug headband edge
      c.fillStyle = '#8e2634';
      c.fillRect(w * 0.14, h * 0.74, w * 0.68, h * 0.16);
    },
  },
  'hat-topper': {
    // tall and narrow: the silhouette is the height, never the width
    wf: 0.95, hf: 0.95,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.38 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const brimY = h * 0.8;
      // the stovepipe, a whisker wider at the top than the band
      c.fillStyle = '#26232b';
      c.beginPath();
      c.moveTo(w * 0.2, brimY);
      c.lineTo(w * 0.17, h * 0.06);
      c.lineTo(w * 0.83, h * 0.06);
      c.lineTo(w * 0.8, brimY);
      c.closePath();
      c.fill();
      // the band, a grey ribbon low on the pipe
      c.fillStyle = '#5a5563';
      c.fillRect(w * 0.185, brimY - h * 0.16, w * 0.63, h * 0.12);
      // the brim: short, flat, a hair of curl at the tips
      c.fillStyle = '#26232b';
      c.beginPath();
      c.moveTo(w * 0.02, brimY - h * 0.05);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.2, w * 0.98, brimY - h * 0.05);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.02, w * 0.02, brimY - h * 0.05);
      c.closePath();
      c.fill();
    },
  },
  'hat-fez': {
    wf: 0.85, hf: 0.72,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.5,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the truncated cone, crimson
      c.fillStyle = '#b8232e';
      c.beginPath();
      c.moveTo(w * 0.12, h * 0.94);
      c.lineTo(w * 0.26, h * 0.1);
      c.lineTo(w * 0.74, h * 0.1);
      c.lineTo(w * 0.88, h * 0.94);
      c.closePath();
      c.fill();
      // the flat top, a shade darker
      c.fillStyle = '#8e1a23';
      c.fillRect(w * 0.26, h * 0.06, w * 0.48, h * 0.1);
      // the tassel: a thread from the crown swinging out to the right
      c.strokeStyle = '#26232b';
      c.lineWidth = Math.max(1, w * 0.04);
      c.beginPath();
      c.moveTo(w * 0.5, h * 0.1);
      c.quadraticCurveTo(w * 0.82, h * 0.16, w * 0.9, h * 0.52);
      c.stroke();
      c.fillStyle = '#26232b';
      c.beginPath();
      c.arc(w * 0.9, h * 0.6, w * 0.07, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-nonla': {
    wf: 1.55, hf: 0.62,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.5,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // one clean straw cone, edge to edge; the shape IS the hat
      c.fillStyle = '#d9b872';
      c.beginPath();
      c.moveTo(w * 0.02, h * 0.9);
      c.quadraticCurveTo(w * 0.3, h * 0.42, w * 0.5, h * 0.06);
      c.quadraticCurveTo(w * 0.7, h * 0.42, w * 0.98, h * 0.9);
      c.closePath();
      c.fill();
      // the rim, darker, and one weave ring part way up
      c.fillStyle = '#b3924e';
      c.fillRect(w * 0.02, h * 0.84, w * 0.96, h * 0.1);
      c.strokeStyle = '#b3924e';
      c.lineWidth = Math.max(1, h * 0.06);
      c.beginPath();
      c.moveTo(w * 0.27, h * 0.52);
      c.quadraticCurveTo(w * 0.5, h * 0.38, w * 0.73, h * 0.52);
      c.stroke();
    },
  },
  'hat-chullo': {
    wf: 1.05, hf: 0.9,
    // worn, not perched: the flaps hold the head's sides
    dy: (cellPixels: number, height: number) => -cellPixels * 0.3 - height * 0.42,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the knit dome
      c.fillStyle = '#2e7d84';
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.62);
      c.quadraticCurveTo(w * 0.12, h * 0.16, w * 0.5, h * 0.14);
      c.quadraticCurveTo(w * 0.88, h * 0.16, w * 0.9, h * 0.62);
      c.closePath();
      c.fill();
      // the patterned band across the brow
      c.fillStyle = '#d97f2e';
      c.fillRect(w * 0.09, h * 0.56, w * 0.82, h * 0.14);
      c.fillStyle = '#f4e3c2';
      for (let i = 0; i < 4; i++) {
        c.fillRect(w * (0.16 + i * 0.2), h * 0.585, w * 0.07, h * 0.09);
      }
      // the ear flaps, hanging just past the band
      c.fillStyle = '#2e7d84';
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.64);
      c.quadraticCurveTo(w * 0.1, h * 0.94, w * 0.22, h * 0.96);
      c.lineTo(w * 0.26, h * 0.68);
      c.closePath();
      c.moveTo(w * 0.9, h * 0.64);
      c.quadraticCurveTo(w * 0.9, h * 0.94, w * 0.78, h * 0.96);
      c.lineTo(w * 0.74, h * 0.68);
      c.closePath();
      c.fill();
      // the pompom
      c.fillStyle = '#d97f2e';
      c.beginPath();
      c.arc(w * 0.5, h * 0.1, w * 0.08, 0, Math.PI * 2);
      c.fill();
    },
  },
} as const satisfies Record<string, HatArt>;

// The catalogues are authored as literals so their keys stay literal, and read
// through these widened views so an id from the server (or from a rival's
// presence payload, or a URL) can be looked up without a cast. Under
// noUncheckedIndexedAccess an unknown id reads as undefined, which is exactly
// the fallback the economy asks for.
const SKIN_BY_ID: Record<string, SkinArt> = SKINS;
const HAT_BY_ID: Record<string, HatArt> = HATS;

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
 * The hat an id resolves to. Unknown, null and empty all wear classic.
 *
 * @param id A `pitch_snake_items` id, or null for "nothing equipped".
 * @returns Always a hat, for the same reason as {@link skinFor}.
 */
export function hatFor(id: string | null | undefined): HatArt {
  return (id ? HAT_BY_ID[id] : undefined) ?? HATS.classic;
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
