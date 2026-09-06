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
 * The hats, ported stroke for stroke from the web page's HATS canvas art:
 * width/height factors, the y offset that seats each one on the head, and
 * the vector draw. Keyed by pitch_snake_items ids plus the classic felt;
 * unknown ids wear classic, the same degrade rule the skins follow.
 */
export const HAT_ART = {
  classic: {
    wf: 1.5,
    hf: 0.95,
    dy: (cellPx: number, h: number) => -cellPx * 0.42 - h * 0.62,
    draw(c: SkCanvas, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.72;
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#8a5a2b'));
      const crown = Skia.Path.Make();
      crown.moveTo(midX - w * 0.2, brimY);
      crown.lineTo(midX - w * 0.165, h * 0.3);
      crown.quadTo(midX - w * 0.1, h * 0.11, midX - w * 0.045, h * 0.2);
      crown.quadTo(midX, h * 0.3, midX + w * 0.045, h * 0.2);
      crown.quadTo(midX + w * 0.1, h * 0.11, midX + w * 0.165, h * 0.3);
      crown.lineTo(midX + w * 0.2, brimY);
      crown.close();
      c.drawPath(crown, paint);
      crown.dispose();
      paint.setColor(Skia.Color('#42291a'));
      c.drawRect(Skia.XYWHRect(midX - w * 0.205, brimY - h * 0.16, w * 0.41, h * 0.13), paint);
      paint.setColor(Skia.Color('#9a6631'));
      const brim = Skia.Path.Make();
      brim.moveTo(midX - w * 0.5, brimY - h * 0.06);
      brim.quadTo(midX, brimY + h * 0.26, midX + w * 0.5, brimY - h * 0.06);
      brim.quadTo(midX, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.06);
      brim.close();
      c.drawPath(brim, paint);
      brim.dispose();
    },
  },
  'hat-band': {
    wf: 1.06,
    hf: 0.3,
    dy: (cellPx: number) => -cellPx * 0.38,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#e6402a'));
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, w, h), h / 2, h / 2), paint);
      paint.setColor(Skia.Color('#f6efde'));
      c.drawRect(Skia.XYWHRect(w * 0.14, h * 0.38, w * 0.72, h * 0.24), paint);
    },
  },
  'hat-cap': {
    wf: 1.35,
    hf: 0.62,
    dy: (cellPx: number, h: number) => -cellPx * 0.38 - h * 0.58,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#6b5b45'));
      const dome = Skia.Path.Make();
      dome.moveTo(w * 0.06, h * 0.78);
      dome.quadTo(w * 0.1, h * 0.1, w * 0.5, h * 0.08);
      dome.quadTo(w * 0.9, h * 0.1, w * 0.94, h * 0.78);
      dome.close();
      c.drawPath(dome, paint);
      dome.dispose();
      paint.setColor(Skia.Color('#57482f'));
      c.drawRect(Skia.XYWHRect(w * 0.46, h * 0.02, w * 0.08, h * 0.1), paint);
      paint.setColor(Skia.Color('#4c3f2c'));
      const brim = Skia.Path.Make();
      brim.moveTo(w * 0.04, h * 0.76);
      brim.quadTo(w * 0.5, h * 1.02, w * 0.96, h * 0.76);
      brim.quadTo(w * 0.5, h * 0.8, w * 0.04, h * 0.76);
      brim.close();
      c.drawPath(brim, paint);
      brim.dispose();
    },
  },
  'hat-crown': {
    wf: 1.1,
    hf: 0.72,
    dy: (cellPx: number, h: number) => -cellPx * 0.4 - h * 0.52,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#f0c440'));
      const points = Skia.Path.Make();
      points.moveTo(w * 0.08, h * 0.92);
      points.lineTo(w * 0.08, h * 0.3);
      points.lineTo(w * 0.28, h * 0.58);
      points.lineTo(w * 0.5, h * 0.06);
      points.lineTo(w * 0.72, h * 0.58);
      points.lineTo(w * 0.92, h * 0.3);
      points.lineTo(w * 0.92, h * 0.92);
      points.close();
      c.drawPath(points, paint);
      points.dispose();
      paint.setColor(Skia.Color('#a87d1e'));
      c.drawRect(Skia.XYWHRect(w * 0.08, h * 0.78, w * 0.84, h * 0.14), paint);
      paint.setColor(Skia.Color('#e6402a'));
      c.drawCircle(w * 0.5, h * 0.1, w * 0.05, paint);
    },
  },
} as const satisfies Record<
  string,
  {
    wf: number;
    hf: number;
    dy: (cellPx: number, h: number) => number;
    draw: (c: SkCanvas, w: number, h: number) => void;
  }
>;

function isHatId(v: string): v is keyof typeof HAT_ART {
  return Object.hasOwn(HAT_ART, v);
}

/** The hat a wallet id resolves to; unknown ids and null wear classic. */
export function hatArt(id: string | null): (typeof HAT_ART)[keyof typeof HAT_ART] {
  return id !== null && isHatId(id) ? HAT_ART[id] : HAT_ART.classic;
}

/**
 * The number ten in yellow and red halves, worn on the square behind the
 * head: the web page's test balloon, mirrored. 3x5 pixel-grid digits drawn
 * as blocks, 8-bit on purpose and immune to font differences.
 */
export function paintJersey(c: SkCanvas, size: number): void {
  const rad = size * 0.3;
  const paint = Skia.Paint();
  c.save();
  const shirt = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), rad, rad);
  c.clipRRect(shirt, 1, true);
  paint.setColor(Skia.Color('#f2c114'));
  c.drawRect(Skia.XYWHRect(0, 0, size / 2, size), paint);
  paint.setColor(Skia.Color('#d8231f'));
  c.drawRect(Skia.XYWHRect(size / 2, 0, size / 2, size), paint);
  c.restore();
  const line = Skia.Paint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(Math.max(1, size * 0.05));
  line.setColor(Skia.Color('rgba(33,30,26,0.55)'));
  c.drawRRect(shirt, line);
  const DIGITS = [
    ['010', '110', '010', '010', '111'],
    ['111', '101', '101', '101', '111'],
  ];
  const px = Math.max(1, Math.round(size * 0.11));
  const x0 = Math.round((size - px * 7) / 2);
  const y0 = Math.round((size - px * 5) / 2);
  const ink = (color: string, dx: number, dy: number): void => {
    paint.setColor(Skia.Color(color));
    for (let d = 0; d < 2; d++) {
      for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 3; k++) {
          if (DIGITS[d]?.[r]?.[k] === '1') {
            c.drawRect(Skia.XYWHRect(x0 + d * px * 4 + k * px + dx, y0 + r * px + dy, px, px), paint);
          }
        }
      }
    }
  };
  ink('rgba(33,30,26,0.8)', 1, 1);
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
