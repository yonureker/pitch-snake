/**
 * The pitch and its props as vector paint: the grass, the mown bands, the
 * centre-field glow, the chalk (halfway line, centre circle, centre spot)
 * and the golden thunderbolt. The mobile twin of the web page's buildArena
 * and buildBoltSprite, split into its own module so field art grows here
 * rather than in the renderer, which is already over its file ceiling.
 * Everything here runs at BAKE time only (a resize, a cell-size change),
 * never per frame, so local paint allocations are fine. Nothing here
 * reaches the engine: this is paint, and it can never touch a rule or a
 * replay.
 * @module
 */
import { BlurStyle, PaintStyle, Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';

import { GRID } from '@pitch-snake/engine';

import { GameColors } from './theme';

/**
 * Paint the whole arena into `c`: base green, mown bands two cells wide,
 * the radial daylight, the cell grid, then the chalk on top. The vertical
 * halfway line is the TV view, matching the web page.
 */
export function paintPitch(c: SkCanvas, boardPx: number): void {
  const cell = boardPx / GRID;
  const full = Skia.XYWHRect(0, 0, boardPx, boardPx);
  const fill = Skia.Paint();
  fill.setColor(Skia.Color(GameColors.arena));
  c.drawRect(full, fill);
  // mown bands, every other pair of columns lifted a touch
  fill.setColor(Skia.Color('rgba(214,232,164,0.05)'));
  for (let i = 0; i < GRID; i += 4) {
    c.drawRect(Skia.XYWHRect(i * cell, 0, cell * 2, boardPx), fill);
  }
  // the daylight pooled at midfield, fading out toward the stands
  const glow = Skia.Paint();
  glow.setShader(
    Skia.Shader.MakeRadialGradient(
      Skia.Point(boardPx / 2, boardPx / 2),
      boardPx * 0.72,
      [
        Skia.Color('rgba(104,126,58,0.34)'),
        Skia.Color('rgba(104,126,58,0.34)'),
        Skia.Color('rgba(104,126,58,0)'),
      ],
      [0, 0.14, 1],
      TileMode.Clamp,
    ),
  );
  c.drawRect(full, glow);
  // the cell grid, same faint cream as the web
  const line = Skia.Paint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(1);
  line.setColor(Skia.Color(GameColors.gridLine));
  for (let i = 1; i < GRID; i++) {
    c.drawLine(i * cell, 0, i * cell, boardPx, line);
    c.drawLine(0, i * cell, boardPx, i * cell, line);
  }
  // the chalk: halfway line, centre circle, centre spot
  const chalk = Skia.Paint();
  chalk.setStyle(PaintStyle.Stroke);
  chalk.setStrokeWidth(Math.max(2, cell * 0.09));
  chalk.setColor(Skia.Color('rgba(238,244,226,0.15)'));
  c.drawLine(boardPx / 2, 0, boardPx / 2, boardPx, chalk);
  c.drawCircle(boardPx / 2, boardPx / 2, cell * 2.8, chalk);
  const spot = Skia.Paint();
  spot.setColor(Skia.Color('rgba(238,244,226,0.22)'));
  c.drawCircle(boardPx / 2, boardPx / 2, Math.max(3, cell * 0.12), spot);
}

// The hats grew past this file's ceiling and moved to their own module
// (hat-art.ts, with three regional collections); the re-export keeps every
// existing import working.
export { hatArt } from './hat-art';
export type { HatArt } from './hat-art';

/**
 * The eight offsets the number's dark trim is drawn at, so a digit is outlined
 * on every side rather than shadowed on one. See the note in `paintJersey`.
 */
const JERSEY_TRIM = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** The classic shirt's left half, worn when a player has chosen no colour. */
export const JERSEY_LEFT_DEFAULT = '#f2c114';

/** The classic shirt's right half, worn when a player has chosen no colour. */
export const JERSEY_RIGHT_DEFAULT = '#d8231f';

/**
 * 3x5 pixel glyphs, 0-9, so a shirt can wear any number.
 *
 * Blocks rather than text on purpose: 8-bit at this size, and immune to which
 * fonts a device happens to ship, which is the same reason the flags are a
 * sprite. This carried only the 1 and the 0 while the number was always ten;
 * the full set arrived with player-chosen numbers on 2026-09-07 and is a
 * character-for-character copy of page/pitch-art.ts's, because the two clients
 * must put the same shirt on the same player.
 */
const JERSEY_GLYPH: Record<string, readonly string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

/**
 * Paint one shirt: two colour halves, a rounded edge, a centred number.
 *
 * Worn on the square behind the head, mirroring page/pitch-art.ts. Both halves
 * and the number are the player's own since 2026-09-07; the defaults are the
 * classic yellow and red this shipped as. Colours arrive already washed by
 * lib/kit.ts, so a caller that skips that wash is the bug, not a bad hex here.
 *
 * The dark outline stroke is load-bearing rather than decorative now that the
 * halves are free-form: it keeps a kit chosen close to the pitch's own green
 * readable as a shape instead of a hole.
 *
 * @param c - the canvas to paint into.
 * @param size - the shirt's size in pixels; it is square.
 * @param num - the number on the back, 0..99.
 * @param left - the left half as `#rrggbb`; the classic yellow when null.
 * @param right - the right half as `#rrggbb`; the classic red when null.
 */
export function paintJersey(
  c: SkCanvas,
  size: number,
  num = 10,
  left: string | null = null,
  right: string | null = null,
): void {
  const rad = size * 0.3;
  const paint = Skia.Paint();
  c.save();
  const shirt = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), rad, rad);
  c.clipRRect(shirt, 1, true);
  paint.setColor(Skia.Color(left ?? JERSEY_LEFT_DEFAULT));
  c.drawRect(Skia.XYWHRect(0, 0, size / 2, size), paint);
  paint.setColor(Skia.Color(right ?? JERSEY_RIGHT_DEFAULT));
  c.drawRect(Skia.XYWHRect(size / 2, 0, size / 2, size), paint);
  c.restore();
  const line = Skia.Paint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(Math.max(1, size * 0.05));
  line.setColor(Skia.Color('rgba(33,30,26,0.55)'));
  c.drawRRect(shirt, line);
  const digits = String(num).split('');
  const px = Math.max(1, Math.round(size * 0.11));
  // 3px per glyph plus a 1px gap, less the trailing gap
  const w = digits.length * 4 - 1;
  const x0 = Math.round((size - px * w) / 2);
  const y0 = Math.round((size - px * 5) / 2);
  const ink = (color: string, dx: number, dy: number): void => {
    paint.setColor(Skia.Color(color));
    for (let d = 0; d < digits.length; d++) {
      const glyph = JERSEY_GLYPH[digits[d] ?? ''];
      if (glyph === undefined) continue;
      for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 3; k++) {
          if (glyph[r]?.[k] === '1') {
            c.drawRect(Skia.XYWHRect(x0 + d * px * 4 + k * px + dx, y0 + r * px + dy, px, px), paint);
          }
        }
      }
    }
  };
  // A TRIM, not a drop shadow: white digits over a one-sided shadow vanish on
  // a white kit, which is one of the commonest shirts there is. Every
  // direction instead, the way a real shirt number is trimmed, so it holds on
  // any two colours a player picks. Eight passes at BAKE time, never per frame.
  for (const [dx, dy] of JERSEY_TRIM) ink('rgba(33,30,26,0.85)', dx, dy);
  ink('#ffffff', 0, 0);
}

/**
 * Paint the bolt pickup: the golden lightning under its own bloom, back by
 * request after a dizzy-ghost interlude. Same silhouette the old per-frame
 * path drew, now baked once; the halo replaces the pulsing ring box.
 */
export function paintBolt(c: SkCanvas, size: number, cell: number): void {
  const bx = size / 2;
  const by = size / 2;
  const s = cell * 0.55;
  const p = Skia.Path.Make();
  p.moveTo(bx + s * 0.18, by - s);
  p.lineTo(bx - s * 0.62, by + s * 0.12);
  p.lineTo(bx - s * 0.06, by + s * 0.12);
  p.lineTo(bx - s * 0.22, by + s);
  p.lineTo(bx + s * 0.66, by - s * 0.18);
  p.lineTo(bx + s * 0.08, by - s * 0.18);
  p.close();
  const halo = Skia.Paint();
  halo.setColor(Skia.Color('rgba(255,214,102,0.9)'));
  halo.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(2, cell * 0.16), true));
  c.drawPath(p, halo);
  const gold = Skia.Paint();
  gold.setColor(Skia.Color(GameColors.goldBright));
  c.drawPath(p, gold);
  p.dispose();
}
