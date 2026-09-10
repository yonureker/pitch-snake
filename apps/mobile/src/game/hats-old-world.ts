/**
 * The hats of Europe and Africa: the world tour, western old world.
 *
 * One of the hat catalogue's three regional collections
 * (see hat-art.ts for
 * the contract and the rule that a worn hat covers the head). Splitting by
 * hemisphere follows the infographic the tour was picked from, and keeps
 * each file inside the 500-line ceiling so a stray deletion stays visible
 * in a diff.
 *
 * @module
 */
import { PaintStyle, Skia, type SkCanvas } from '@shopify/react-native-skia';

import type { HatArt } from './hat-art';

/** The collection, merged into the catalogue by hat-art.ts. */
export const OLD_WORLD_HATS: Record<string, HatArt> = {
  'hat-beret': {
    wf: 1.2,
    hf: 0.45,
    dy: (cellPx: number, height: number) => -cellPx * 0.42 - height * 0.45,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      // the soft disc, drooping to the right the way a beret slumps
      paint.setColor(Skia.Color('#b03040'));
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.08, h * 0.82);
      p1.quadTo(w * 0.02, h * 0.3, w * 0.34, h * 0.2);
      p1.quadTo(w * 0.72, h * 0.04, w * 0.95, h * 0.5);
      p1.quadTo(w * 0.99, h * 0.78, w * 0.86, h * 0.84);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the stalk on top, the one detail that says beret and not pancake
      paint.setColor(Skia.Color('#7c1f2c'));
      c.drawRect(Skia.XYWHRect(w * 0.47, h * 0.02, w * 0.06, h * 0.22), paint);
      // the snug headband edge
      paint.setColor(Skia.Color('#8e2634'));
      c.drawRect(Skia.XYWHRect(w * 0.14, h * 0.74, w * 0.68, h * 0.16), paint);
    },
  },
  'hat-topper': {
    // tall, and the pipe itself spans the brow: the silhouette is the
    // height, but a hat that sits on the head covers the head
    wf: 1.2,
    hf: 0.95,
    dy: (cellPx: number, height: number) => -cellPx * 0.38 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const brimY = h * 0.8;
      // the stovepipe, a whisker wider at the top than the band
      paint.setColor(Skia.Color('#26232b'));
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.16, brimY);
      p1.lineTo(w * 0.13, h * 0.06);
      p1.lineTo(w * 0.87, h * 0.06);
      p1.lineTo(w * 0.84, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the band, a grey ribbon low on the pipe
      paint.setColor(Skia.Color('#5a5563'));
      c.drawRect(Skia.XYWHRect(w * 0.15, brimY - h * 0.16, w * 0.7, h * 0.12), paint);
      // the brim: short, flat, a hair of curl at the tips
      paint.setColor(Skia.Color('#26232b'));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.02, brimY - h * 0.05);
      p2.quadTo(w * 0.5, brimY + h * 0.2, w * 0.98, brimY - h * 0.05);
      p2.quadTo(w * 0.5, brimY + h * 0.02, w * 0.02, brimY - h * 0.05);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-bowler': {
    wf: 1.15,
    hf: 0.65,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const brimY = h * 0.74;
      paint.setColor(Skia.Color('#26232b'));
      const p1 = Skia.Path.Make(); // the hard round dome
      p1.moveTo(w * 0.14, brimY);
      p1.quadTo(w * 0.14, h * 0.02, w * 0.5, h * 0.02);
      p1.quadTo(w * 0.86, h * 0.02, w * 0.86, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#4a4550')); // the band
      c.drawRect(Skia.XYWHRect(w * 0.14, brimY - h * 0.16, w * 0.72, h * 0.13), paint);
      paint.setColor(Skia.Color('#26232b')); // the tight curled brim
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.02, brimY - h * 0.1);
      p2.quadTo(w * 0.5, brimY + h * 0.3, w * 0.98, brimY - h * 0.1);
      p2.quadTo(w * 0.5, brimY + h * 0.06, w * 0.02, brimY - h * 0.1);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-boater': {
    wf: 1.3,
    hf: 0.5,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const brimY = h * 0.68;
      paint.setColor(Skia.Color('#e6cf7e')); // the flat straw pillbox
      c.drawRect(Skia.XYWHRect(w * 0.2, h * 0.06, w * 0.6, brimY - h * 0.06), paint);
      paint.setColor(Skia.Color('#b03040')); // the regatta band
      c.drawRect(Skia.XYWHRect(w * 0.2, brimY - h * 0.26, w * 0.6, h * 0.2), paint);
      paint.setColor(Skia.Color('#2c3a55'));
      c.drawRect(Skia.XYWHRect(w * 0.2, brimY - h * 0.19, w * 0.6, h * 0.07), paint);
      paint.setColor(Skia.Color('#d9be66')); // the dead-flat brim
      c.drawRect(Skia.XYWHRect(w * 0.02, brimY - h * 0.06, w * 0.96, h * 0.14), paint);
    },
  },
  'hat-tam': {
    wf: 1.25,
    hf: 0.5,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.45,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      paint.setColor(Skia.Color('#3e5a3a')); // the wide soft disc
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.1, h * 0.8);
      p1.quadTo(w * 0.02, h * 0.24, w * 0.5, h * 0.18);
      p1.quadTo(w * 0.98, h * 0.24, w * 0.9, h * 0.8);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the tartan: one red and one yellow thread each way
      stroke.setColor(Skia.Color('#b03040'));
      stroke.setStrokeWidth(Math.max(1, h * 0.07));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.12, h * 0.52);
      p2.lineTo(w * 0.88, h * 0.52);
      p2.moveTo(w * 0.38, h * 0.2);
      p2.lineTo(w * 0.36, h * 0.78);
      c.drawPath(p2, stroke);
      p2.dispose();
      stroke.setColor(Skia.Color('#d8b35e'));
      stroke.setStrokeWidth(Math.max(1, h * 0.045));
      const p3 = Skia.Path.Make();
      p3.moveTo(w * 0.1, h * 0.66);
      p3.lineTo(w * 0.9, h * 0.66);
      p3.moveTo(w * 0.62, h * 0.2);
      p3.lineTo(w * 0.64, h * 0.78);
      c.drawPath(p3, stroke);
      p3.dispose();
      paint.setColor(Skia.Color('#b03040')); // the toorie on top
      const p4 = Skia.Path.Make();
      p4.addCircle(w * 0.5, h * 0.14, w * 0.06);
      c.drawPath(p4, paint);
      p4.dispose();
    },
  },
  'hat-fez': {
    // wide enough that the base spans the whole brow: a fez is worn, and a
    // hat that sits on the head covers the head (the module rule)
    wf: 1.05,
    hf: 0.72,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.5,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      // the truncated cone, crimson
      paint.setColor(Skia.Color('#b8232e'));
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.08, h * 0.94);
      p1.lineTo(w * 0.26, h * 0.1);
      p1.lineTo(w * 0.74, h * 0.1);
      p1.lineTo(w * 0.92, h * 0.94);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the flat top, a shade darker
      paint.setColor(Skia.Color('#8e1a23'));
      c.drawRect(Skia.XYWHRect(w * 0.26, h * 0.06, w * 0.48, h * 0.1), paint);
      // the tassel: a thread from the crown swinging out to the right
      stroke.setColor(Skia.Color('#26232b'));
      stroke.setStrokeWidth(Math.max(1, w * 0.04));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.5, h * 0.1);
      p2.quadTo(w * 0.82, h * 0.16, w * 0.9, h * 0.52);
      c.drawPath(p2, stroke);
      p2.dispose();
      paint.setColor(Skia.Color('#26232b'));
      const p3 = Skia.Path.Make();
      p3.addCircle(w * 0.9, h * 0.6, w * 0.07);
      c.drawPath(p3, paint);
      p3.dispose();
    },
  },
  'hat-kufi': {
    wf: 0.95,
    hf: 0.42,
    dy: (cellPx: number, height: number) => -cellPx * 0.36 - height * 0.4,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#b0562e')); // the low round cap
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.05, h * 0.94);
      p1.quadTo(w * 0.08, h * 0.06, w * 0.5, h * 0.04);
      p1.quadTo(w * 0.92, h * 0.06, w * 0.95, h * 0.94);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#e8c98f')); // the woven border row
      for (let i = 0; i < 5; i++) {
        c.drawRect(Skia.XYWHRect(w * (0.12 + i * 0.16), h * 0.62, w * 0.08, h * 0.24), paint);
      }
    },
  },
  'hat-kepi': {
    wf: 0.95,
    hf: 0.55,
    dy: (cellPx: number, height: number) => -cellPx * 0.36 - height * 0.42,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#34486e')); // the drum, tapering up
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.08, h * 0.78);
      p1.lineTo(w * 0.16, h * 0.1);
      p1.lineTo(w * 0.84, h * 0.1);
      p1.lineTo(w * 0.92, h * 0.78);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#c23b2a')); // the red top
      c.drawRect(Skia.XYWHRect(w * 0.16, h * 0.04, w * 0.68, h * 0.12), paint);
      paint.setColor(Skia.Color('#1a2233')); // the short visor
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.18, h * 0.78);
      p2.quadTo(w * 0.5, h * 1.04, w * 0.82, h * 0.78);
      p2.quadTo(w * 0.5, h * 0.86, w * 0.18, h * 0.78);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-pith': {
    wf: 1.2,
    hf: 0.65,
    dy: (cellPx: number, height: number) => -cellPx * 0.38 - height * 0.5,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const brimY = h * 0.7;
      paint.setColor(Skia.Color('#ded4b8')); // the dome
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.12, brimY);
      p1.quadTo(w * 0.14, h * 0.06, w * 0.5, h * 0.04);
      p1.quadTo(w * 0.86, h * 0.06, w * 0.88, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#b8ad8e')); // the puggaree band
      c.drawRect(Skia.XYWHRect(w * 0.12, brimY - h * 0.18, w * 0.76, h * 0.14), paint);
      paint.setColor(Skia.Color('#cfc4a4')); // the all-round downward brim
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.02, brimY - h * 0.06);
      p2.quadTo(w * 0.5, brimY + h * 0.34, w * 0.98, brimY - h * 0.06);
      p2.quadTo(w * 0.5, brimY + h * 0.1, w * 0.02, brimY - h * 0.06);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
      paint.setColor(Skia.Color('#b8ad8e')); // the top button
      c.drawRect(Skia.XYWHRect(w * 0.46, h * 0.0, w * 0.08, h * 0.08), paint);
    },
  },
  'hat-fisher': {
    wf: 1.05,
    hf: 0.5,
    dy: (cellPx: number, height: number) => -cellPx * 0.36 - height * 0.4,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      paint.setColor(Skia.Color('#2c3a55')); // the soft crown, leaning back
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.06, h * 0.72);
      p1.quadTo(w * 0.02, h * 0.1, w * 0.5, h * 0.08);
      p1.quadTo(w * 0.96, h * 0.1, w * 0.94, h * 0.72);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      stroke.setColor(Skia.Color('#d8b35e')); // the braid above the visor
      stroke.setStrokeWidth(Math.max(1, h * 0.08));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.1, h * 0.66);
      p2.lineTo(w * 0.9, h * 0.66);
      c.drawPath(p2, stroke);
      p2.dispose();
      paint.setColor(Skia.Color('#1a2233')); // the short shiny visor
      const p3 = Skia.Path.Make();
      p3.moveTo(w * 0.2, h * 0.74);
      p3.quadTo(w * 0.5, h * 1.0, w * 0.8, h * 0.74);
      p3.quadTo(w * 0.5, h * 0.82, w * 0.2, h * 0.74);
      p3.close();
      c.drawPath(p3, paint);
      p3.dispose();
    },
  },
  'hat-tyrol': {
    wf: 1.25,
    hf: 0.75,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      const midX = w / 2;
      const brimY = h * 0.72;
      paint.setColor(Skia.Color('#4a6741')); // the green felt crown
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.19, brimY);
      p1.lineTo(midX - w * 0.15, h * 0.2);
      p1.quadTo(midX - w * 0.02, h * 0.06, midX + w * 0.08, h * 0.16);
      p1.lineTo(midX + w * 0.19, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#33492d')); // the cord band
      c.drawRect(Skia.XYWHRect(midX - w * 0.195, brimY - h * 0.15, w * 0.39, h * 0.12), paint);
      paint.setColor(Skia.Color('#587a4e')); // the narrow brim
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.34, brimY - h * 0.06);
      p2.quadTo(midX, brimY + h * 0.26, midX + w * 0.34, brimY - h * 0.06);
      p2.quadTo(midX, brimY + h * 0.04, midX - w * 0.34, brimY - h * 0.06);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
      stroke.setColor(Skia.Color('#e9e2cf')); // the feather, leaning out right
      stroke.setStrokeWidth(Math.max(1, w * 0.05));
      const p3 = Skia.Path.Make();
      p3.moveTo(midX + w * 0.08, brimY - h * 0.12);
      p3.quadTo(midX + w * 0.3, h * 0.3, midX + w * 0.4, h * 0.02);
      c.drawPath(p3, stroke);
      p3.dispose();
    },
  },
  'hat-bicorne': {
    wf: 1.45,
    hf: 0.62,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      // worn side-on, the way the portraits have it: one solid boat with
      // both tips rising. (The face-on crescent was tried first and filled
      // as a floating smile at twenty pixels.)
      paint.setColor(Skia.Color('#23242c'));
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.02, h * 0.28);
      p1.quadTo(w * 0.5, h * -0.14, w * 0.98, h * 0.28);
      p1.quadTo(w * 0.86, h * 0.9, w * 0.5, h * 0.94);
      p1.quadTo(w * 0.14, h * 0.9, w * 0.02, h * 0.28);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      stroke.setColor(Skia.Color('#d8b35e')); // the gold lace along the brim
      stroke.setStrokeWidth(Math.max(1, h * 0.06));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.1, h * 0.42);
      p2.quadTo(w * 0.5, h * 0.7, w * 0.9, h * 0.42);
      c.drawPath(p2, stroke);
      p2.dispose();
      paint.setColor(Skia.Color('#d8b35e')); // the cockade
      const p3 = Skia.Path.Make();
      p3.addCircle(w * 0.5, h * 0.42, w * 0.05);
      c.drawPath(p3, paint);
      p3.dispose();
    },
  },
  'hat-cordobes': {
    wf: 1.4,
    hf: 0.6,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const brimY = h * 0.72;
      paint.setColor(Skia.Color('#26232b')); // the low flat drum
      c.drawRect(Skia.XYWHRect(w * 0.19, h * 0.1, w * 0.62, brimY - h * 0.1), paint);
      paint.setColor(Skia.Color('#8e2634')); // the wine band
      c.drawRect(Skia.XYWHRect(w * 0.19, brimY - h * 0.2, w * 0.62, h * 0.16), paint);
      paint.setColor(Skia.Color('#26232b')); // the wide FLAT brim, dead level
      c.drawRect(Skia.XYWHRect(w * 0.02, brimY - h * 0.04, w * 0.96, h * 0.14), paint);
    },
  },
  'hat-bearskin': {
    // tall, and worn on the brow: the column rises ABOVE the head, and its
    // base stops short of the eyes (the first cut swallowed the whole face)
    wf: 0.95,
    hf: 1.05,
    dy: (cellPx: number, height: number) => -cellPx * 0.15 - height,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      paint.setColor(Skia.Color('#26232b')); // the fur column
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.07, h * 0.96);
      p1.lineTo(w * 0.09, h * 0.16);
      p1.quadTo(w * 0.5, h * -0.04, w * 0.91, h * 0.16);
      p1.lineTo(w * 0.93, h * 0.96);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // fur reads as a ragged edge: three darker licks down the face
      stroke.setColor(Skia.Color('#111014'));
      stroke.setStrokeWidth(Math.max(1, w * 0.05));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.3, h * 0.2);
      p2.lineTo(w * 0.27, h * 0.5);
      p2.moveTo(w * 0.52, h * 0.14);
      p2.lineTo(w * 0.5, h * 0.46);
      p2.moveTo(w * 0.72, h * 0.2);
      p2.lineTo(w * 0.74, h * 0.5);
      c.drawPath(p2, stroke);
      p2.dispose();
      paint.setColor(Skia.Color('#b03040')); // the plume on the left
      c.drawRect(Skia.XYWHRect(w * 0.12, h * 0.08, w * 0.09, h * 0.3), paint);
    },
  },
};
