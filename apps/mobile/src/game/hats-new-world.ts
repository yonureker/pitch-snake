/**
 * The hats of the Americas and Oceania: the world tour, western half.
 *
 * One of the hat catalogue's two regional collections
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
export const NEW_WORLD_HATS: Record<string, HatArt> = {
  'hat-sombrero': {
    // wide is the whole point, but capped: any wider and it shades the cell
    // behind the head on the pitch
    wf: 1.6,
    hf: 0.85,
    dy: (cellPx: number, height: number) => -cellPx * 0.4 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const midX = w / 2;
      const brimY = h * 0.68;
      // the crown: a tall straw cone with a blunt top
      paint.setColor(Skia.Color('#e0b45c'));
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.17, brimY);
      p1.lineTo(midX - w * 0.08, h * 0.08);
      p1.quadTo(midX, 0, midX + w * 0.08, h * 0.08);
      p1.lineTo(midX + w * 0.17, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the band: a red stripe where crown meets brim
      paint.setColor(Skia.Color('#c23b2a'));
      c.drawRect(Skia.XYWHRect(midX - w * 0.175, brimY - h * 0.17, w * 0.35, h * 0.15), paint);
      // the brim: very wide, curling up hard at the tips
      paint.setColor(Skia.Color('#caa04e'));
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.5, brimY - h * 0.22);
      p2.quadTo(midX - w * 0.42, brimY + h * 0.16, midX, brimY + h * 0.2);
      p2.quadTo(midX + w * 0.42, brimY + h * 0.16, midX + w * 0.5, brimY - h * 0.22);
      p2.quadTo(midX + w * 0.38, brimY + h * 0.02, midX, brimY + h * 0.04);
      p2.quadTo(midX - w * 0.38, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.22);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-chullo': {
    wf: 1.05,
    hf: 0.9,
    // worn, not perched: the flaps hold the head's sides
    dy: (cellPx: number, height: number) => -cellPx * 0.3 - height * 0.42,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      // the knit dome
      paint.setColor(Skia.Color('#2e7d84'));
      const p1 = Skia.Path.Make();
      p1.moveTo(w * 0.1, h * 0.62);
      p1.quadTo(w * 0.12, h * 0.16, w * 0.5, h * 0.14);
      p1.quadTo(w * 0.88, h * 0.16, w * 0.9, h * 0.62);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      // the patterned band across the brow
      paint.setColor(Skia.Color('#d97f2e'));
      c.drawRect(Skia.XYWHRect(w * 0.09, h * 0.56, w * 0.82, h * 0.14), paint);
      paint.setColor(Skia.Color('#f4e3c2'));
      for (let i = 0; i < 4; i++) {
        c.drawRect(Skia.XYWHRect(w * (0.16 + i * 0.2), h * 0.585, w * 0.07, h * 0.09), paint);
      }
      // the ear flaps, hanging just past the band
      paint.setColor(Skia.Color('#2e7d84'));
      const p2 = Skia.Path.Make();
      p2.moveTo(w * 0.1, h * 0.64);
      p2.quadTo(w * 0.1, h * 0.94, w * 0.22, h * 0.96);
      p2.lineTo(w * 0.26, h * 0.68);
      p2.close();
      p2.moveTo(w * 0.9, h * 0.64);
      p2.quadTo(w * 0.9, h * 0.94, w * 0.78, h * 0.96);
      p2.lineTo(w * 0.74, h * 0.68);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
      // the pompom
      paint.setColor(Skia.Color('#d97f2e'));
      const p3 = Skia.Path.Make();
      p3.addCircle(w * 0.5, h * 0.1, w * 0.08);
      c.drawPath(p3, paint);
      p3.dispose();
    },
  },
  'hat-panama': {
    wf: 1.4,
    hf: 0.75,
    dy: (cellPx: number, height: number) => -cellPx * 0.42 - height * 0.58,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const midX = w / 2;
      const brimY = h * 0.7;
      paint.setColor(Skia.Color('#efe3c2')); // the dented cream crown
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.19, brimY);
      p1.lineTo(midX - w * 0.165, h * 0.24);
      p1.quadTo(midX - w * 0.1, h * 0.06, midX - w * 0.04, h * 0.16);
      p1.quadTo(midX, h * 0.24, midX + w * 0.04, h * 0.16);
      p1.quadTo(midX + w * 0.1, h * 0.06, midX + w * 0.165, h * 0.24);
      p1.lineTo(midX + w * 0.19, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#26232b')); // the black band
      c.drawRect(Skia.XYWHRect(midX - w * 0.195, brimY - h * 0.16, w * 0.39, h * 0.14), paint);
      paint.setColor(Skia.Color('#e3d5ae')); // the brim, a gentle wave
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.5, brimY - h * 0.08);
      p2.quadTo(midX, brimY + h * 0.28, midX + w * 0.5, brimY - h * 0.08);
      p2.quadTo(midX, brimY + h * 0.04, midX - w * 0.5, brimY - h * 0.08);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-cowboy': {
    wf: 1.55,
    hf: 0.9,
    dy: (cellPx: number, height: number) => -cellPx * 0.42 - height * 0.58,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const midX = w / 2;
      const brimY = h * 0.7;
      paint.setColor(Skia.Color('#b07f42')); // tall crown, creased down the middle
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.19, brimY);
      p1.lineTo(midX - w * 0.17, h * 0.1);
      p1.quadTo(midX - w * 0.08, h * 0.02, midX, h * 0.18);
      p1.quadTo(midX + w * 0.08, h * 0.02, midX + w * 0.17, h * 0.1);
      p1.lineTo(midX + w * 0.19, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#6e4a24')); // the band
      c.drawRect(Skia.XYWHRect(midX - w * 0.195, brimY - h * 0.14, w * 0.39, h * 0.12), paint);
      paint.setColor(Skia.Color('#c08d4c')); // the gull-wing brim
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.5, brimY - h * 0.3);
      p2.quadTo(midX - w * 0.4, brimY + h * 0.18, midX, brimY + h * 0.22);
      p2.quadTo(midX + w * 0.4, brimY + h * 0.18, midX + w * 0.5, brimY - h * 0.3);
      p2.quadTo(midX + w * 0.36, brimY + h * 0.02, midX, brimY + h * 0.04);
      p2.quadTo(midX - w * 0.36, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.3);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
  'hat-mountie': {
    wf: 1.5,
    hf: 0.8,
    dy: (cellPx: number, height: number) => -cellPx * 0.42 - height * 0.56,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const midX = w / 2;
      const brimY = h * 0.7;
      paint.setColor(Skia.Color('#c8a55a')); // the campaign peak
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.17, brimY);
      p1.lineTo(midX - w * 0.05, h * 0.06);
      p1.lineTo(midX + w * 0.05, h * 0.06);
      p1.lineTo(midX + w * 0.17, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#7a5c28')); // the strap band
      c.drawRect(Skia.XYWHRect(midX - w * 0.175, brimY - h * 0.13, w * 0.35, h * 0.11), paint);
      paint.setColor(Skia.Color('#b8954e')); // the dead-flat brim
      c.drawRect(Skia.XYWHRect(w * 0.02, brimY - h * 0.02, w * 0.96, h * 0.13), paint);
    },
  },
  'hat-vueltiao': {
    wf: 1.5,
    hf: 0.7,
    dy: (cellPx: number, height: number) => -cellPx * 0.42 - height * 0.56,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      const midX = w / 2;
      const brimY = h * 0.68;
      paint.setColor(Skia.Color('#e8dcb0')); // the woven crown
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.17, brimY);
      p1.lineTo(midX - w * 0.15, h * 0.12);
      p1.quadTo(midX, h * 0.02, midX + w * 0.15, h * 0.12);
      p1.lineTo(midX + w * 0.17, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#26232b')); // the black turns of the weave
      c.drawRect(Skia.XYWHRect(midX - w * 0.16, h * 0.22, w * 0.32, h * 0.09), paint);
      c.drawRect(Skia.XYWHRect(midX - w * 0.175, brimY - h * 0.16, w * 0.35, h * 0.12), paint);
      paint.setColor(Skia.Color('#e8dcb0')); // the wide brim, nearly flat
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.5, brimY - h * 0.12);
      p2.quadTo(midX, brimY + h * 0.24, midX + w * 0.5, brimY - h * 0.12);
      p2.quadTo(midX, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.12);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
      stroke.setColor(Skia.Color('#26232b')); // the banded brim edge
      stroke.setStrokeWidth(Math.max(1, h * 0.06));
      const p3 = Skia.Path.Make();
      p3.moveTo(midX - w * 0.46, brimY - h * 0.08);
      p3.quadTo(midX, brimY + h * 0.2, midX + w * 0.46, brimY - h * 0.08);
      c.drawPath(p3, stroke);
      p3.dispose();
    },
  },
  'hat-cocar': {
    wf: 1.35,
    hf: 0.85,
    dy: (cellPx: number, height: number) => -cellPx * 0.36 - height * 0.5,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const stroke = Skia.Paint();
      stroke.setStyle(PaintStyle.Stroke);
      // seven feathers fanning from the band, colours alternating
      const colors = ['#d94036', '#e8c23a', '#2f74c0', '#d94036', '#2f74c0', '#e8c23a', '#d94036'];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1 - (i + 0.5) / 7); // left to right across the fan
        const bx = w * 0.5 + Math.cos(a) * w * 0.28;
        const tipX = w * 0.5 + Math.cos(a) * w * 0.48;
        const tipY = h * 0.68 - Math.sin(a) * h * 0.62;
        stroke.setColor(Skia.Color(colors[i] ?? '#d94036'));
        stroke.setStrokeWidth(w * 0.09);
        const p1 = Skia.Path.Make();
        p1.moveTo(bx, h * 0.72);
        p1.lineTo(tipX, tipY);
        c.drawPath(p1, stroke);
        p1.dispose();
      }
      paint.setColor(Skia.Color('#7a4a26')); // the woven band
      c.drawRect(Skia.XYWHRect(w * 0.08, h * 0.7, w * 0.84, h * 0.22), paint);
      paint.setColor(Skia.Color('#e8c23a'));
      c.drawRect(Skia.XYWHRect(w * 0.08, h * 0.76, w * 0.84, h * 0.08), paint);
    },
  },
  'hat-bush': {
    wf: 1.4,
    hf: 0.7,
    dy: (cellPx: number, height: number) => -cellPx * 0.42 - height * 0.55,
    draw(c: SkCanvas, w: number, h: number) {
      const paint = Skia.Paint();
      const midX = w / 2;
      const brimY = h * 0.66;
      paint.setColor(Skia.Color('#6b6b3a')); // the low soft crown
      const p1 = Skia.Path.Make();
      p1.moveTo(midX - w * 0.18, brimY);
      p1.quadTo(midX - w * 0.16, h * 0.1, midX, h * 0.08);
      p1.quadTo(midX + w * 0.16, h * 0.1, midX + w * 0.18, brimY);
      p1.close();
      c.drawPath(p1, paint);
      p1.dispose();
      paint.setColor(Skia.Color('#4f5029')); // the band
      c.drawRect(Skia.XYWHRect(midX - w * 0.185, brimY - h * 0.14, w * 0.37, h * 0.12), paint);
      paint.setColor(Skia.Color('#7a7a45')); // the brim, slouching right
      const p2 = Skia.Path.Make();
      p2.moveTo(midX - w * 0.5, brimY - h * 0.16);
      p2.quadTo(midX - w * 0.3, brimY + h * 0.22, midX + w * 0.1, brimY + h * 0.18);
      p2.quadTo(midX + w * 0.42, brimY + h * 0.3, midX + w * 0.5, brimY + h * 0.02);
      p2.quadTo(midX + w * 0.2, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.16);
      p2.close();
      c.drawPath(p2, paint);
      p2.dispose();
    },
  },
};
