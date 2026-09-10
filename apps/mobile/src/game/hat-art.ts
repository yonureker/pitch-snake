/**
 * The hats: every silhouette a snake can wear on this platform.
 *
 * The web page's hat-art.ts, ported stroke for stroke, and split the same
 * way for the same reason: the world tour pushed the art past the 500-line
 * ceiling, so the founding wardrobe lives here with the contract, and the
 * tour rides in three regional collections. The server sells ids and
 * prices, this module owns what an id LOOKS like, and an id this build has
 * never heard of falls back to classic, which is what lets the shop grow
 * by SQL alone.
 *
 * The one design rule, learned from the first batch: a hat that sits on
 * the head COVERS the head; only ornaments that ride above may be
 * narrower, and no brim runs past ~1.6 cells.
 *
 * @module
 */
import { Skia, type SkCanvas } from '@shopify/react-native-skia';

import { ASIA_HATS } from './hats-asia';
import { NEW_WORLD_HATS } from './hats-new-world';
import { OLD_WORLD_HATS } from './hats-old-world';

/** One hat's art: its footprint, where it sits, and how to draw it. */
export interface HatArt {
  /** Width as a fraction of a cell. */
  wf: number;
  /** Height as a fraction of a cell. */
  hf: number;
  /** Where it sits relative to the head's centre. */
  dy: (cellPx: number, h: number) => number;
  /** How to draw it into a canvas of the given size. */
  draw: (c: SkCanvas, w: number, h: number) => void;
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
} as const satisfies Record<string, HatArt>;

// the catalogue: the founding wardrobe plus the three regional collections
const HAT_BY_ID: Record<string, HatArt> = {
  ...HAT_ART,
  ...OLD_WORLD_HATS,
  ...ASIA_HATS,
  ...NEW_WORLD_HATS,
};

/** The hat a wallet id resolves to; unknown ids and null wear classic. */
export function hatArt(id: string | null): HatArt {
  return (id !== null ? HAT_BY_ID[id] : undefined) ?? HAT_ART.classic;
}
