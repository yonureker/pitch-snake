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
