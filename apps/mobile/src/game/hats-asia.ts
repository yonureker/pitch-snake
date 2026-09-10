/**
 * The hats of Asia and the steppe: the world tour, eastern collection.
 *
 * One of the hat catalogue's three regional collections
 * (see hat-art.ts for
 * the contract and the rule that a worn hat covers the head). Splitting by
 * region follows the infographic the tour was picked from, and keeps each
 * file inside the 500-line ceiling so a stray deletion stays visible in a
 * diff.
 *
 * @module
 */
import { PaintStyle, Skia, type SkCanvas } from '@shopify/react-native-skia';

import type { HatArt } from './hat-art';

/** The collection, merged into the catalogue by hat-art.ts. */
export const ASIA_HATS: Record<string, HatArt> = {
  'hat-ushanka': {
    wf: 1.1,
    hf: 0.8,
    // worn: the fur holds the head, the flaps hang past the brow
    dy: (cellPx: number, height: number) => -cellPx * 0.32 - height * 0.42,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#9a938c')); // the crown
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.08, h * 0.6);
      p1.quadTo(w * 0.1, h * 0.08, w * 0.5, h * 0.06);
      p1.quadTo(w * 0.9, h * 0.08, w * 0.92, h * 0.6);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#c9c3bb')); // the turned-up fur front
      c.drawRect(Skia.XYWHRect(w * 0.08, h * 0.52, w * 0.84, h * 0.2), paint);
      paint.setColor(Skia.Color('#847d75')); // the ear flaps
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.08, h * 0.62);
      p2.quadTo(w * 0.06, h * 0.92, w * 0.2, h * 0.96);
      p2.lineTo(w * 0.24, h * 0.7);
      p2.close();
      p2.moveTo(w * 0.92, h * 0.62);
      p2.quadTo(w * 0.94, h * 0.92, w * 0.8, h * 0.96);
      p2.lineTo(w * 0.76, h * 0.7);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-turban': {
    wf: 1.1,
    hf: 0.68,
    dy: (cellPx: number, height: number) => -cellPx * 0.34 - height * 0.45,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      paint.setColor(Skia.Color('#e08a2e')); // the wrapped dome
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.06, h * 0.9);
      p1.quadTo(w * 0.06, h * 0.1, w * 0.5, h * 0.08);
      p1.quadTo(w * 0.94, h * 0.1, w * 0.94, h * 0.9);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // two fold lines that say wrap rather than dome
      stroke.setColor(Skia.Color('#b96e1f'));
      stroke.setStrokeWidth(Math.max(1, h * 0.07));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.12, h * 0.78);
      p2.quadTo(w * 0.5, h * 0.3, w * 0.88, h * 0.78);
      p2.moveTo(w * 0.2, h * 0.88);
      p2.quadTo(w * 0.5, h * 0.52, w * 0.8, h * 0.88);
      c.drawPath(p2, stroke);
      p2.dispose();
      paint.setColor(Skia.Color('#f4c14f')); // the front knot
      const p3 = Skia.Path.Make();
      p3.addCircle(w * 0.5, h * 0.28, w * 0.07);
      c.drawPath(p3, paint);
      p3.dispose();
    },
  },
  'hat-gat': {
    wf: 1.5,
    hf: 0.85,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      const midX = w / 2;
      const brimY = h * 0.76;
      paint.setColor(Skia.Color('#2b2b30')); // the tall tapered crown
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.16, brimY);
      p1.lineTo(midX - w * 0.11, h * 0.06);
      p1.lineTo(midX + w * 0.11, h * 0.06);
      p1.lineTo(midX + w * 0.16, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#3a3a41')); // the vast flat brim, a thin plane
      c.drawRect(Skia.XYWHRect(w * 0.02, brimY - h * 0.02, w * 0.96, h * 0.1), paint);
      stroke.setColor(Skia.Color('#3a3a41')); // the chin cords
      stroke.setStrokeWidth(Math.max(1, w * 0.02));
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.1, brimY + h * 0.08);
      p2.lineTo(midX - w * 0.14, h * 0.98);
      p2.moveTo(midX + w * 0.1, brimY + h * 0.08);
      p2.lineTo(midX + w * 0.14, h * 0.98);
      c.drawPath(p2, stroke);
      p2.dispose();
    },
  },
  'hat-nonla': {
    wf: 1.55,
    hf: 0.62,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.5,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      // one clean straw cone, edge to edge; the shape IS the hat
      paint.setColor(Skia.Color('#d9b872'));
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.02, h * 0.9);
      p1.quadTo(w * 0.3, h * 0.42, w * 0.5, h * 0.06);
      p1.quadTo(w * 0.7, h * 0.42, w * 0.98, h * 0.9);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the rim, darker, and one weave ring part way up
      paint.setColor(Skia.Color('#b3924e'));
      c.drawRect(Skia.XYWHRect(w * 0.02, h * 0.84, w * 0.96, h * 0.1), paint);
      stroke.setColor(Skia.Color('#b3924e'));
      stroke.setStrokeWidth(Math.max(1, h * 0.06));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.27, h * 0.52);
      p2.quadTo(w * 0.5, h * 0.38, w * 0.73, h * 0.52);
      c.drawPath(p2, stroke);
      p2.dispose();
    },
  },
};
