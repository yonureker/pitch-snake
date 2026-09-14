/**
 * The hats: every silhouette a snake can wear, on either client.
 *
 * The founding wardrobe lives here with the contract; the world tour rides
 * in three regional collections (old world, new world, Asia), split so each
 * file stays inside the 500-line ceiling and a stray deletion stays visible
 * in a diff. The server sells ids and prices, this package owns what an id
 * LOOKS like, and an id a build has never heard of falls back to classic,
 * which is what lets the shop grow by SQL alone.
 *
 * SHARED, NOT COPIED, since 2026-09-14: this art lived twice, drawn against
 * Canvas2D on the page and re-ported stroke by stroke to Skia in the app.
 * Every hat now draws once, against the HatSurface dialect (see
 * hat-surface.ts): the page hands its real 2d context in, the app wraps its
 * Skia canvas in a small adapter. Adding a hat is adding it HERE, once.
 *
 * The one design rule, learned from the first batch: a hat that sits on the
 * head COVERS the head; only ornaments that ride above may be narrower, and
 * no brim runs past ~1.6 cells.
 *
 * Drawn rather than lettered, unlike the flag: there is no standalone cowboy
 * hat in the emoji set (the one that exists is a whole face), and art beats a
 * glyph for a skin anyway, since it depends on no platform's font and every
 * device draws the same shapes.
 *
 * @module hat-art
 */
import { ASIA_HATS } from './hats-asia.js';
import { NEW_WORLD_HATS } from './hats-new-world.js';
import { OLD_WORLD_HATS } from './hats-old-world.js';
import type { HatSurface } from './hat-surface.js';

/** One hat's art: its footprint, where it sits, and how to draw it. */
export interface HatArt {
  /** Width as a fraction of a cell. */
  wf: number;
  /** Height as a fraction of a cell. */
  hf: number;
  /** Where it sits relative to the head's centre. */
  dy: (cellPixels: number, height: number) => number;
  /** How to draw it into a canvas of the given size. */
  draw: (context: HatSurface, width: number, height: number) => void;
}

/**
 * The founding wardrobe. `classic` is the felt hat a bare hat slot has
 * always worn; the `hat-` ids are bought.
 */
export const HATS = {
  classic: {
    wf: 1.5, hf: 0.95,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.62,
    draw(c: HatSurface, w: number, h: number) {
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
    draw(c: HatSurface, w: number, h: number) {
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
    draw(c: HatSurface, w: number, h: number) {
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
    draw(c: HatSurface, w: number, h: number) {
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
} as const satisfies Record<string, HatArt>;

// the catalogue: the founding wardrobe plus the three regional collections
const HAT_BY_ID: Record<string, HatArt> = { ...HATS, ...OLD_WORLD_HATS, ...ASIA_HATS, ...NEW_WORLD_HATS };

/** Every id the catalogue can draw, for proofs and previews. */
export const HAT_IDS: readonly string[] = Object.keys(HAT_BY_ID);

/**
 * The hat an id resolves to. Unknown, null and empty all wear classic.
 *
 * @param id A `pitch_snake_items` id, or null for "nothing equipped".
 * @returns Always a hat: an unknown id costing a default is the fallback\n *   rule every cosmetic follows.
 */
export function hatFor(id: string | null | undefined): HatArt {
  return (id ? HAT_BY_ID[id] : undefined) ?? HATS.classic;
}
