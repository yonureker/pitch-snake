/**
 * The hats of Asia and the steppe: the world tour, eastern collection.
 *
 * One of the hat catalogue's three regional collections (see hat-art.ts for
 * the contract and the rule that a worn hat covers the head). Splitting by
 * region follows the infographic the tour was picked from, and keeps each
 * file inside the 500-line ceiling so a stray deletion stays visible in a
 * diff.
 *
 * @module
 */
import type { HatArt } from './hat-art.js';

/** The collection, merged into the catalogue by hat-art.ts. */
export const ASIA_HATS: Record<string, HatArt> = {
  'hat-ushanka': {
    wf: 1.1, hf: 0.8,
    // worn: the fur holds the head, the flaps hang past the brow
    dy: (cellPixels: number, height: number) => -cellPixels * 0.32 - height * 0.42,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#9a938c';                // the crown
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.6);
      c.quadraticCurveTo(w * 0.1, h * 0.08, w * 0.5, h * 0.06);
      c.quadraticCurveTo(w * 0.9, h * 0.08, w * 0.92, h * 0.6);
      c.closePath();
      c.fill();
      c.fillStyle = '#c9c3bb';                // the turned-up fur front
      c.fillRect(w * 0.08, h * 0.52, w * 0.84, h * 0.2);
      c.fillStyle = '#847d75';                // the ear flaps
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.62);
      c.quadraticCurveTo(w * 0.06, h * 0.92, w * 0.2, h * 0.96);
      c.lineTo(w * 0.24, h * 0.7);
      c.closePath();
      c.moveTo(w * 0.92, h * 0.62);
      c.quadraticCurveTo(w * 0.94, h * 0.92, w * 0.8, h * 0.96);
      c.lineTo(w * 0.76, h * 0.7);
      c.closePath();
      c.fill();
    },
  },
  'hat-turban': {
    wf: 1.1, hf: 0.68,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.34 - height * 0.45,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#e08a2e';                // the wrapped dome
      c.beginPath();
      c.moveTo(w * 0.06, h * 0.9);
      c.quadraticCurveTo(w * 0.06, h * 0.1, w * 0.5, h * 0.08);
      c.quadraticCurveTo(w * 0.94, h * 0.1, w * 0.94, h * 0.9);
      c.closePath();
      c.fill();
      // two fold lines that say wrap rather than dome
      c.strokeStyle = '#b96e1f';
      c.lineWidth = Math.max(1, h * 0.07);
      c.beginPath();
      c.moveTo(w * 0.12, h * 0.78);
      c.quadraticCurveTo(w * 0.5, h * 0.3, w * 0.88, h * 0.78);
      c.moveTo(w * 0.2, h * 0.88);
      c.quadraticCurveTo(w * 0.5, h * 0.52, w * 0.8, h * 0.88);
      c.stroke();
      c.fillStyle = '#f4c14f';                // the front knot
      c.beginPath();
      c.arc(w * 0.5, h * 0.28, w * 0.07, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-gat': {
    wf: 1.5, hf: 0.85,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.76;
      c.fillStyle = '#2b2b30';                // the tall tapered crown
      c.beginPath();
      c.moveTo(midX - w * 0.16, brimY);
      c.lineTo(midX - w * 0.11, h * 0.06);
      c.lineTo(midX + w * 0.11, h * 0.06);
      c.lineTo(midX + w * 0.16, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#3a3a41';                // the vast flat brim, a thin plane
      c.fillRect(w * 0.02, brimY - h * 0.02, w * 0.96, h * 0.1);
      c.strokeStyle = '#3a3a41';              // the chin cords
      c.lineWidth = Math.max(1, w * 0.02);
      c.beginPath();
      c.moveTo(midX - w * 0.1, brimY + h * 0.08);
      c.lineTo(midX - w * 0.14, h * 0.98);
      c.moveTo(midX + w * 0.1, brimY + h * 0.08);
      c.lineTo(midX + w * 0.14, h * 0.98);
      c.stroke();
    },
  },
  'hat-nonla': {
    wf: 1.55, hf: 0.62,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.5,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // one clean straw cone, edge to edge; the shape IS the hat
      c.fillStyle = '#d9b872';
      c.beginPath();
      c.moveTo(w * 0.02, h * 0.9);
      c.quadraticCurveTo(w * 0.3, h * 0.42, w * 0.5, h * 0.06);
      c.quadraticCurveTo(w * 0.7, h * 0.42, w * 0.98, h * 0.9);
      c.closePath();
      c.fill();
      // the rim, darker, and one weave ring part way up
      c.fillStyle = '#b3924e';
      c.fillRect(w * 0.02, h * 0.84, w * 0.96, h * 0.1);
      c.strokeStyle = '#b3924e';
      c.lineWidth = Math.max(1, h * 0.06);
      c.beginPath();
      c.moveTo(w * 0.27, h * 0.52);
      c.quadraticCurveTo(w * 0.5, h * 0.38, w * 0.73, h * 0.52);
      c.stroke();
    },
  },
};
