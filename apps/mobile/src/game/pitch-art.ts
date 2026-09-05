/**
 * The pitch and its props as vector paint: the grass, the mown bands, the
 * centre-field glow, the chalk (halfway line, centre circle, centre spot)
 * and the dizzy-ghost face of the engine's bolt. The mobile twin of the web
 * page's buildArena and buildBoltSprite, split into its own module so field
 * art grows here rather than in the renderer, which is already over its
 * file ceiling. Everything here runs at BAKE time only (a resize, a
 * cell-size change), never per frame, so local paint allocations are fine.
 * Nothing here reaches the engine: this is paint, and it can never touch a
 * rule or a replay.
 * @module
 */
import {
  BlurStyle,
  PaintStyle,
  Skia,
  TileMode,
  type SkCanvas,
  type SkPath,
} from '@shopify/react-native-skia';

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

/** The renderer's ghost silhouette (dome plus four skirt teeth), as a path. */
function ghostPath(gx: number, gy: number, r: number): SkPath {
  const domeY = -r * 0.16;
  const path = Skia.Path.Make();
  path.addArc(Skia.XYWHRect(gx - r, gy + domeY - r, r * 2, r * 2), 180, 180);
  path.lineTo(gx + r, gy + r);
  const n = 4;
  const step = (2 * r) / n;
  let x = gx + r;
  for (let i = 0; i < n; i++) {
    path.lineTo(x - step / 2, gy + r - r * 0.42);
    path.lineTo(x - step, gy + r);
    x -= step;
  }
  path.lineTo(gx - r, gy + domeY);
  path.close();
  return path;
}

/**
 * Paint the bolt pickup's face: a spectral ghost with a golden dizzy star
 * over its brow, under the golden bloom the bolt always wore. The phones
 * cannot render a text emoji, so the web's glyph pair is redrawn as
 * vectors; the engine's item is still the bolt, only its portrait changed.
 */
export function paintDizzyGhost(c: SkCanvas, size: number, cell: number): void {
  const r = cell * 0.34;
  const gx = size / 2;
  const gy = size / 2 + r * 0.3;
  const body = ghostPath(gx, gy, r);
  const halo = Skia.Paint();
  halo.setColor(Skia.Color('rgba(255,214,102,0.9)'));
  halo.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(2, cell * 0.16), true));
  c.drawPath(body, halo);
  const sheet = Skia.Paint();
  sheet.setColor(Skia.Color('#f2f4ff'));
  c.drawPath(body, sheet);
  body.dispose();
  const ink = Skia.Paint();
  ink.setColor(Skia.Color('#3a3f66'));
  c.drawCircle(gx - r * 0.34, gy - r * 0.2, r * 0.14, ink);
  c.drawCircle(gx + r * 0.34, gy - r * 0.2, r * 0.14, ink);
  // the dizzy star riding past the brow, with its little comet crumb
  const gold = Skia.Paint();
  gold.setColor(Skia.Color('#ffd666'));
  const sx = gx + r * 0.66;
  const sy = gy - r * 1.34;
  const sr = r * 0.5;
  const star = Skia.Path.Make();
  star.moveTo(sx, sy - sr);
  star.quadTo(sx + sr * 0.18, sy - sr * 0.18, sx + sr, sy);
  star.quadTo(sx + sr * 0.18, sy + sr * 0.18, sx, sy + sr);
  star.quadTo(sx - sr * 0.18, sy + sr * 0.18, sx - sr, sy);
  star.quadTo(sx - sr * 0.18, sy - sr * 0.18, sx, sy - sr);
  star.close();
  c.drawPath(star, gold);
  star.dispose();
  c.drawCircle(sx - sr * 1.15, sy + sr * 0.75, sr * 0.16, gold);
}
