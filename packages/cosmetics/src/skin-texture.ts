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

function dot(c: HatSurface, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

// a filled diamond (rotated square) centred at (x, y) with half-diagonal r
function diamondPath(c: HatSurface, x: number, y: number, r: number): void {
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r, y);
  c.lineTo(x, y + r);
  c.lineTo(x - r, y);
  c.closePath();
}

// a stroked line from (x1, y1) to (x2, y2)
function line(c: HatSurface, x1: number, y1: number, x2: number, y2: number): void {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

/**
 * The catalogue of motifs, keyed by the id a SkinArt names.
 *
 * Geometric tier: dots, pinstripe, crosshatch, zigzag, chequer, roundel,
 * argyle. Ornamental tier: scales, waves, ocelli, diamondback, mosaic.
 */
export const SKIN_TEXTURES: Record<string, SkinTexturePainter> = {
  // polka quincunx: four spots and a centre, the away-kit classic
  dots(c, s, ink) {
    c.fillStyle = ink;
    const r = s * 0.11;
    dot(c, s * 0.26, s * 0.26, r);
    dot(c, s * 0.74, s * 0.26, r);
    dot(c, s * 0.26, s * 0.74, r);
    dot(c, s * 0.74, s * 0.74, r);
    dot(c, s * 0.5, s * 0.5, r);
  },

  // three diagonal pinstripes, banker's cloth on a snake
  pinstripe(c, s, ink) {
    c.strokeStyle = ink;
    c.lineWidth = s * 0.08;
    line(c, -s * 0.25, s * 0.75, s * 0.75, -s * 0.25);
    line(c, s * 0.25, s * 1.25, s * 1.25, s * 0.25);
    line(c, -s * 0.75, s * 0.25, s * 0.25, -s * 0.75);
  },

  // both diagonals, twice each: a woven lattice
  crosshatch(c, s, ink) {
    c.strokeStyle = ink;
    c.lineWidth = s * 0.07;
    line(c, -s * 0.5, s * 0.83, s * 0.83, -s * 0.5);
    line(c, s * 0.17, s * 1.5, s * 1.5, s * 0.17);
    line(c, s * 0.17, -s * 0.5, s * 1.5, s * 0.83);
    line(c, -s * 0.5, s * 0.17, s * 0.83, s * 1.5);
  },

  // one bold chevron band across the middle
  zigzag(c, s, ink) {
    c.fillStyle = ink;
    const amp = s * 0.16;
    const th = s * 0.2;
    c.beginPath();
    c.moveTo(-s * 0.05, s * 0.5 + amp);
    c.lineTo(s * 0.25, s * 0.5 - amp);
    c.lineTo(s * 0.5, s * 0.5 + amp);
    c.lineTo(s * 0.75, s * 0.5 - amp);
    c.lineTo(s * 1.05, s * 0.5 + amp);
    c.lineTo(s * 1.05, s * 0.5 + amp + th);
    c.lineTo(s * 0.75, s * 0.5 - amp + th);
    c.lineTo(s * 0.5, s * 0.5 + amp + th);
    c.lineTo(s * 0.25, s * 0.5 - amp + th);
    c.lineTo(-s * 0.05, s * 0.5 + amp + th);
    c.closePath();
    c.fill();
  },

  // two opposite quadrants inked: the chequerboard at cell scale
  chequer(c, s, ink) {
    c.fillStyle = ink;
    c.fillRect(0, 0, s * 0.5, s * 0.5);
    c.fillRect(s * 0.5, s * 0.5, s * 0.5, s * 0.5);
  },

  // a ring and its heart: the target every winger aims at
  roundel(c, s, ink, ink2) {
    c.strokeStyle = ink;
    c.lineWidth = s * 0.11;
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.3, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = ink2 ?? ink;
    dot(c, s * 0.5, s * 0.5, s * 0.13);
  },

  // the golf-club diamond with its thin crossed overlines
  argyle(c, s, ink, ink2) {
    c.fillStyle = ink;
    diamondPath(c, s * 0.5, s * 0.5, s * 0.34);
    c.fill();
    c.strokeStyle = ink2 ?? ink;
    c.lineWidth = s * 0.05;
    line(c, 0, 0, s, s);
    line(c, s, 0, 0, s);
  },

  // three rows of overlapping fish-scales, filled so they read when small
  scales(c, s, ink) {
    c.fillStyle = ink;
    const r = s * 0.24;
    for (let row = 0; row < 3; row++) {
      const y = s * (0.22 + row * 0.3);
      const off = row % 2 === 0 ? 0 : r;
      for (let k = -1; k < 4; k++) {
        c.beginPath();
        c.arc(off + k * r * 2, y, r, 0, Math.PI);
        c.closePath();
        c.fill();
      }
    }
  },

  // two stroked crests of foam: the same sea the scales swim in, drawn as
  // line rather than mass so the two never read as one motif
  waves(c, s, ink) {
    c.strokeStyle = ink;
    c.lineWidth = s * 0.09;
    for (let row = 0; row < 2; row++) {
      const y = s * (0.34 + row * 0.36);
      const off = row % 2 === 0 ? 0 : s * 0.25;
      for (let k = -1; k < 3; k++) {
        c.beginPath();
        c.arc(off + k * s * 0.5 + s * 0.25, y, s * 0.22, Math.PI, Math.PI * 2);
        c.stroke();
      }
    }
  },

  // one eyespot per tile: ring, heart, and a glint of the second ink
  ocelli(c, s, ink, ink2) {
    c.strokeStyle = ink;
    c.lineWidth = s * 0.09;
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.3, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = ink2 ?? ink;
    dot(c, s * 0.5, s * 0.5, s * 0.15);
    c.fillStyle = ink;
    dot(c, s * 0.16, s * 0.16, s * 0.06);
    dot(c, s * 0.84, s * 0.84, s * 0.06);
  },

  // the rattler's chain: an open diamond around a solid one
  diamondback(c, s, ink) {
    c.strokeStyle = ink;
    c.lineWidth = s * 0.09;
    diamondPath(c, s * 0.5, s * 0.5, s * 0.36);
    c.stroke();
    c.fillStyle = ink;
    diamondPath(c, s * 0.5, s * 0.5, s * 0.12);
    c.fill();
  },

  // tesserae in two inks with the shade showing through as grout
  mosaic(c, s, ink, ink2) {
    const t = s * 0.26;
    const g = s * 0.06;
    const second = ink2 ?? ink;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if ((row + col) % 2 === 0) continue; // the grout keeps the ramp visible
        c.fillStyle = (row * 3 + col) % 4 === 1 ? second : ink;
        c.fillRect(g + col * (t + g), g + row * (t + g), t, t);
      }
    }
  },
};

/**
 * The painter a texture id resolves to, or null for an id this build has
 * never heard of, which the caller treats as "no texture": the same
 * fall-back-to-less contract every cosmetic here obeys.
 *
 * @param id A SkinArt texture id.
 * @returns The painter, or null.
 */
export function textureFor(id: string | null | undefined): SkinTexturePainter | null {
  return (id ? SKIN_TEXTURES[id] : undefined) ?? null;
}
