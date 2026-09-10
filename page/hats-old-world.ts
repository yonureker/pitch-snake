/**
 * The hats of Europe and Africa: the world tour, western old world.
 *
 * One of the hat catalogue's three regional collections (see hat-art.ts for
 * the contract and the rule that a worn hat covers the head). Splitting by
 * hemisphere follows the infographic the tour was picked from, and keeps
 * each file inside the 500-line ceiling so a stray deletion stays visible
 * in a diff.
 *
 * @module
 */
import type { HatArt } from './hat-art.js';

/** The collection, merged into the catalogue by hat-art.ts. */
export const OLD_WORLD_HATS: Record<string, HatArt> = {
  'hat-beret': {
    wf: 1.2, hf: 0.45,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.45,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the soft disc, drooping to the right the way a beret slumps
      c.fillStyle = '#b03040';
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.82);
      c.quadraticCurveTo(w * 0.02, h * 0.3, w * 0.34, h * 0.2);
      c.quadraticCurveTo(w * 0.72, h * 0.04, w * 0.95, h * 0.5);
      c.quadraticCurveTo(w * 0.99, h * 0.78, w * 0.86, h * 0.84);
      c.closePath();
      c.fill();
      // the stalk on top, the one detail that says beret and not pancake
      c.fillStyle = '#7c1f2c';
      c.fillRect(w * 0.47, h * 0.02, w * 0.06, h * 0.22);
      // the snug headband edge
      c.fillStyle = '#8e2634';
      c.fillRect(w * 0.14, h * 0.74, w * 0.68, h * 0.16);
    },
  },
  'hat-topper': {
    // tall, and the pipe itself spans the brow: the silhouette is the
    // height, but a hat that sits on the head covers the head
    wf: 1.2, hf: 0.95,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.38 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const brimY = h * 0.8;
      // the stovepipe, a whisker wider at the top than the band
      c.fillStyle = '#26232b';
      c.beginPath();
      c.moveTo(w * 0.16, brimY);
      c.lineTo(w * 0.13, h * 0.06);
      c.lineTo(w * 0.87, h * 0.06);
      c.lineTo(w * 0.84, brimY);
      c.closePath();
      c.fill();
      // the band, a grey ribbon low on the pipe
      c.fillStyle = '#5a5563';
      c.fillRect(w * 0.15, brimY - h * 0.16, w * 0.7, h * 0.12);
      // the brim: short, flat, a hair of curl at the tips
      c.fillStyle = '#26232b';
      c.beginPath();
      c.moveTo(w * 0.02, brimY - h * 0.05);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.2, w * 0.98, brimY - h * 0.05);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.02, w * 0.02, brimY - h * 0.05);
      c.closePath();
      c.fill();
    },
  },
  'hat-bowler': {
    wf: 1.15, hf: 0.65,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const brimY = h * 0.74;
      c.fillStyle = '#26232b';
      c.beginPath();                          // the hard round dome
      c.moveTo(w * 0.14, brimY);
      c.quadraticCurveTo(w * 0.14, h * 0.02, w * 0.5, h * 0.02);
      c.quadraticCurveTo(w * 0.86, h * 0.02, w * 0.86, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#4a4550';                // the band
      c.fillRect(w * 0.14, brimY - h * 0.16, w * 0.72, h * 0.13);
      c.fillStyle = '#26232b';                // the tight curled brim
      c.beginPath();
      c.moveTo(w * 0.02, brimY - h * 0.1);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.3, w * 0.98, brimY - h * 0.1);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.06, w * 0.02, brimY - h * 0.1);
      c.closePath();
      c.fill();
    },
  },
  'hat-boater': {
    wf: 1.3, hf: 0.5,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const brimY = h * 0.68;
      c.fillStyle = '#e6cf7e';                // the flat straw pillbox
      c.fillRect(w * 0.2, h * 0.06, w * 0.6, brimY - h * 0.06);
      c.fillStyle = '#b03040';                // the regatta band
      c.fillRect(w * 0.2, brimY - h * 0.26, w * 0.6, h * 0.2);
      c.fillStyle = '#2c3a55';
      c.fillRect(w * 0.2, brimY - h * 0.19, w * 0.6, h * 0.07);
      c.fillStyle = '#d9be66';                // the dead-flat brim
      c.fillRect(w * 0.02, brimY - h * 0.06, w * 0.96, h * 0.14);
    },
  },
  'hat-tam': {
    wf: 1.25, hf: 0.5,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.45,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#3e5a3a';                // the wide soft disc
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.8);
      c.quadraticCurveTo(w * 0.02, h * 0.24, w * 0.5, h * 0.18);
      c.quadraticCurveTo(w * 0.98, h * 0.24, w * 0.9, h * 0.8);
      c.closePath();
      c.fill();
      // the tartan: one red and one yellow thread each way
      c.strokeStyle = '#b03040';
      c.lineWidth = Math.max(1, h * 0.07);
      c.beginPath();
      c.moveTo(w * 0.12, h * 0.52); c.lineTo(w * 0.88, h * 0.52);
      c.moveTo(w * 0.38, h * 0.2); c.lineTo(w * 0.36, h * 0.78);
      c.stroke();
      c.strokeStyle = '#d8b35e';
      c.lineWidth = Math.max(1, h * 0.045);
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.66); c.lineTo(w * 0.9, h * 0.66);
      c.moveTo(w * 0.62, h * 0.2); c.lineTo(w * 0.64, h * 0.78);
      c.stroke();
      c.fillStyle = '#b03040';                // the toorie on top
      c.beginPath();
      c.arc(w * 0.5, h * 0.14, w * 0.06, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-fez': {
    // wide enough that the base spans the whole brow: a fez is worn, and a
    // hat that sits on the head covers the head (the module rule)
    wf: 1.05, hf: 0.72,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.5,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the truncated cone, crimson
      c.fillStyle = '#b8232e';
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.94);
      c.lineTo(w * 0.26, h * 0.1);
      c.lineTo(w * 0.74, h * 0.1);
      c.lineTo(w * 0.92, h * 0.94);
      c.closePath();
      c.fill();
      // the flat top, a shade darker
      c.fillStyle = '#8e1a23';
      c.fillRect(w * 0.26, h * 0.06, w * 0.48, h * 0.1);
      // the tassel: a thread from the crown swinging out to the right
      c.strokeStyle = '#26232b';
      c.lineWidth = Math.max(1, w * 0.04);
      c.beginPath();
      c.moveTo(w * 0.5, h * 0.1);
      c.quadraticCurveTo(w * 0.82, h * 0.16, w * 0.9, h * 0.52);
      c.stroke();
      c.fillStyle = '#26232b';
      c.beginPath();
      c.arc(w * 0.9, h * 0.6, w * 0.07, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-kufi': {
    wf: 0.95, hf: 0.42,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.36 - height * 0.4,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#b0562e';                // the low round cap
      c.beginPath();
      c.moveTo(w * 0.05, h * 0.94);
      c.quadraticCurveTo(w * 0.08, h * 0.06, w * 0.5, h * 0.04);
      c.quadraticCurveTo(w * 0.92, h * 0.06, w * 0.95, h * 0.94);
      c.closePath();
      c.fill();
      c.fillStyle = '#e8c98f';                // the woven border row
      for (let i = 0; i < 5; i++) {
        c.fillRect(w * (0.12 + i * 0.16), h * 0.62, w * 0.08, h * 0.24);
      }
    },
  },
  'hat-kepi': {
    wf: 0.95, hf: 0.55,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.36 - height * 0.42,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#34486e';                // the drum, tapering up
      c.beginPath();
      c.moveTo(w * 0.08, h * 0.78);
      c.lineTo(w * 0.16, h * 0.1);
      c.lineTo(w * 0.84, h * 0.1);
      c.lineTo(w * 0.92, h * 0.78);
      c.closePath();
      c.fill();
      c.fillStyle = '#c23b2a';                // the red top
      c.fillRect(w * 0.16, h * 0.04, w * 0.68, h * 0.12);
      c.fillStyle = '#1a2233';                // the short visor
      c.beginPath();
      c.moveTo(w * 0.18, h * 0.78);
      c.quadraticCurveTo(w * 0.5, h * 1.04, w * 0.82, h * 0.78);
      c.quadraticCurveTo(w * 0.5, h * 0.86, w * 0.18, h * 0.78);
      c.closePath();
      c.fill();
    },
  },
  'hat-pith': {
    wf: 1.2, hf: 0.65,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.38 - height * 0.5,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const brimY = h * 0.7;
      c.fillStyle = '#ded4b8';                // the dome
      c.beginPath();
      c.moveTo(w * 0.12, brimY);
      c.quadraticCurveTo(w * 0.14, h * 0.06, w * 0.5, h * 0.04);
      c.quadraticCurveTo(w * 0.86, h * 0.06, w * 0.88, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#b8ad8e';                // the puggaree band
      c.fillRect(w * 0.12, brimY - h * 0.18, w * 0.76, h * 0.14);
      c.fillStyle = '#cfc4a4';                // the all-round downward brim
      c.beginPath();
      c.moveTo(w * 0.02, brimY - h * 0.06);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.34, w * 0.98, brimY - h * 0.06);
      c.quadraticCurveTo(w * 0.5, brimY + h * 0.1, w * 0.02, brimY - h * 0.06);
      c.closePath();
      c.fill();
      c.fillStyle = '#b8ad8e';                // the top button
      c.fillRect(w * 0.46, 0, w * 0.08, h * 0.08);
    },
  },
  'hat-fisher': {
    wf: 1.05, hf: 0.5,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.36 - height * 0.4,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#2c3a55';                // the soft crown, leaning back
      c.beginPath();
      c.moveTo(w * 0.06, h * 0.72);
      c.quadraticCurveTo(w * 0.02, h * 0.1, w * 0.5, h * 0.08);
      c.quadraticCurveTo(w * 0.96, h * 0.1, w * 0.94, h * 0.72);
      c.closePath();
      c.fill();
      c.strokeStyle = '#d8b35e';              // the braid above the visor
      c.lineWidth = Math.max(1, h * 0.08);
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.66);
      c.lineTo(w * 0.9, h * 0.66);
      c.stroke();
      c.fillStyle = '#1a2233';                // the short shiny visor
      c.beginPath();
      c.moveTo(w * 0.2, h * 0.74);
      c.quadraticCurveTo(w * 0.5, h, w * 0.8, h * 0.74);
      c.quadraticCurveTo(w * 0.5, h * 0.82, w * 0.2, h * 0.74);
      c.closePath();
      c.fill();
    },
  },
  'hat-tyrol': {
    wf: 1.25, hf: 0.75,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.72;
      c.fillStyle = '#4a6741';                // the green felt crown
      c.beginPath();
      c.moveTo(midX - w * 0.19, brimY);
      c.lineTo(midX - w * 0.15, h * 0.2);
      c.quadraticCurveTo(midX - w * 0.02, h * 0.06, midX + w * 0.08, h * 0.16);
      c.lineTo(midX + w * 0.19, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#33492d';                // the cord band
      c.fillRect(midX - w * 0.195, brimY - h * 0.15, w * 0.39, h * 0.12);
      c.fillStyle = '#587a4e';                // the narrow brim
      c.beginPath();
      c.moveTo(midX - w * 0.34, brimY - h * 0.06);
      c.quadraticCurveTo(midX, brimY + h * 0.26, midX + w * 0.34, brimY - h * 0.06);
      c.quadraticCurveTo(midX, brimY + h * 0.04, midX - w * 0.34, brimY - h * 0.06);
      c.closePath();
      c.fill();
      c.strokeStyle = '#e9e2cf';              // the feather, leaning out right
      c.lineWidth = Math.max(1, w * 0.05);
      c.beginPath();
      c.moveTo(midX + w * 0.08, brimY - h * 0.12);
      c.quadraticCurveTo(midX + w * 0.3, h * 0.3, midX + w * 0.4, h * 0.02);
      c.stroke();
    },
  },
  'hat-bicorne': {
    wf: 1.45, hf: 0.62,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // worn side-on, the way the portraits have it: one solid boat with
      // both tips rising. (The face-on crescent was tried first and filled
      // as a floating smile at twenty pixels.)
      c.fillStyle = '#23242c';
      c.beginPath();
      c.moveTo(w * 0.02, h * 0.28);
      c.quadraticCurveTo(w * 0.5, h * -0.14, w * 0.98, h * 0.28);
      c.quadraticCurveTo(w * 0.86, h * 0.9, w * 0.5, h * 0.94);
      c.quadraticCurveTo(w * 0.14, h * 0.9, w * 0.02, h * 0.28);
      c.closePath();
      c.fill();
      c.strokeStyle = '#d8b35e';              // the gold lace along the brim
      c.lineWidth = Math.max(1, h * 0.06);
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.42);
      c.quadraticCurveTo(w * 0.5, h * 0.7, w * 0.9, h * 0.42);
      c.stroke();
      c.fillStyle = '#d8b35e';                // the cockade
      c.beginPath();
      c.arc(w * 0.5, h * 0.42, w * 0.05, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-cordobes': {
    wf: 1.4, hf: 0.6,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const brimY = h * 0.72;
      c.fillStyle = '#26232b';                // the low flat drum
      c.fillRect(w * 0.19, h * 0.1, w * 0.62, brimY - h * 0.1);
      c.fillStyle = '#8e2634';                // the wine band
      c.fillRect(w * 0.19, brimY - h * 0.2, w * 0.62, h * 0.16);
      c.fillStyle = '#26232b';                // the wide FLAT brim, dead level
      c.fillRect(w * 0.02, brimY - h * 0.04, w * 0.96, h * 0.14);
    },
  },
  'hat-bearskin': {
    // tall, and worn on the brow: the column rises ABOVE the head, and its
    // base stops short of the eyes (the first cut swallowed the whole face)
    wf: 0.95, hf: 1.05,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.15 - height,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      c.fillStyle = '#26232b';                // the fur column
      c.beginPath();
      c.moveTo(w * 0.07, h * 0.96);
      c.lineTo(w * 0.09, h * 0.16);
      c.quadraticCurveTo(w * 0.5, -h * 0.04, w * 0.91, h * 0.16);
      c.lineTo(w * 0.93, h * 0.96);
      c.closePath();
      c.fill();
      // fur reads as a ragged edge: three darker licks down the face
      c.strokeStyle = '#111014';
      c.lineWidth = Math.max(1, w * 0.05);
      c.beginPath();
      c.moveTo(w * 0.3, h * 0.2); c.lineTo(w * 0.27, h * 0.5);
      c.moveTo(w * 0.52, h * 0.14); c.lineTo(w * 0.5, h * 0.46);
      c.moveTo(w * 0.72, h * 0.2); c.lineTo(w * 0.74, h * 0.5);
      c.stroke();
      c.fillStyle = '#b03040';                // the plume on the left
      c.fillRect(w * 0.12, h * 0.08, w * 0.09, h * 0.3);
    },
  },
};
