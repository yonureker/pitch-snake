/**
 * The hats of the Americas and Oceania: the world tour, western half.
 *
 * One of the hat catalogue's two regional collections (see hat-art.ts for
 * the contract and the rule that a worn hat covers the head). Splitting by
 * hemisphere follows the infographic the tour was picked from, and keeps
 * each file inside the 500-line ceiling so a stray deletion stays visible
 * in a diff.
 *
 * @module
 */
import type { HatArt } from './hat-art.js';

/** The collection, merged into the catalogue by hat-art.ts. */
export const NEW_WORLD_HATS: Record<string, HatArt> = {
  'hat-sombrero': {
    // wide is the whole point, but capped: any wider and it shades the cell
    // behind the head on the pitch
    wf: 1.6, hf: 0.85,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.4 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.68;
      // the crown: a tall straw cone with a blunt top
      c.fillStyle = '#e0b45c';
      c.beginPath();
      c.moveTo(midX - w * 0.17, brimY);
      c.lineTo(midX - w * 0.08, h * 0.08);
      c.quadraticCurveTo(midX, 0, midX + w * 0.08, h * 0.08);
      c.lineTo(midX + w * 0.17, brimY);
      c.closePath();
      c.fill();
      // the band: a red stripe where crown meets brim
      c.fillStyle = '#c23b2a';
      c.fillRect(midX - w * 0.175, brimY - h * 0.17, w * 0.35, h * 0.15);
      // the brim: very wide, curling up hard at the tips
      c.fillStyle = '#caa04e';
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.22);
      c.quadraticCurveTo(midX - w * 0.42, brimY + h * 0.16, midX, brimY + h * 0.2);
      c.quadraticCurveTo(midX + w * 0.42, brimY + h * 0.16, midX + w * 0.5, brimY - h * 0.22);
      c.quadraticCurveTo(midX + w * 0.38, brimY + h * 0.02, midX, brimY + h * 0.04);
      c.quadraticCurveTo(midX - w * 0.38, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.22);
      c.closePath();
      c.fill();
    },
  },
  'hat-chullo': {
    wf: 1.05, hf: 0.9,
    // worn, not perched: the flaps hold the head's sides
    dy: (cellPixels: number, height: number) => -cellPixels * 0.3 - height * 0.42,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // the knit dome
      c.fillStyle = '#2e7d84';
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.62);
      c.quadraticCurveTo(w * 0.12, h * 0.16, w * 0.5, h * 0.14);
      c.quadraticCurveTo(w * 0.88, h * 0.16, w * 0.9, h * 0.62);
      c.closePath();
      c.fill();
      // the patterned band across the brow
      c.fillStyle = '#d97f2e';
      c.fillRect(w * 0.09, h * 0.56, w * 0.82, h * 0.14);
      c.fillStyle = '#f4e3c2';
      for (let i = 0; i < 4; i++) {
        c.fillRect(w * (0.16 + i * 0.2), h * 0.585, w * 0.07, h * 0.09);
      }
      // the ear flaps, hanging just past the band
      c.fillStyle = '#2e7d84';
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.64);
      c.quadraticCurveTo(w * 0.1, h * 0.94, w * 0.22, h * 0.96);
      c.lineTo(w * 0.26, h * 0.68);
      c.closePath();
      c.moveTo(w * 0.9, h * 0.64);
      c.quadraticCurveTo(w * 0.9, h * 0.94, w * 0.78, h * 0.96);
      c.lineTo(w * 0.74, h * 0.68);
      c.closePath();
      c.fill();
      // the pompom
      c.fillStyle = '#d97f2e';
      c.beginPath();
      c.arc(w * 0.5, h * 0.1, w * 0.08, 0, Math.PI * 2);
      c.fill();
    },
  },
  'hat-panama': {
    wf: 1.4, hf: 0.75,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.58,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.7;
      c.fillStyle = '#efe3c2';                // the dented cream crown
      c.beginPath();
      c.moveTo(midX - w * 0.19, brimY);
      c.lineTo(midX - w * 0.165, h * 0.24);
      c.quadraticCurveTo(midX - w * 0.1, h * 0.06, midX - w * 0.04, h * 0.16);
      c.quadraticCurveTo(midX, h * 0.24, midX + w * 0.04, h * 0.16);
      c.quadraticCurveTo(midX + w * 0.1, h * 0.06, midX + w * 0.165, h * 0.24);
      c.lineTo(midX + w * 0.19, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#26232b';                // the black band
      c.fillRect(midX - w * 0.195, brimY - h * 0.16, w * 0.39, h * 0.14);
      c.fillStyle = '#e3d5ae';                // the brim, a gentle wave
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.08);
      c.quadraticCurveTo(midX, brimY + h * 0.28, midX + w * 0.5, brimY - h * 0.08);
      c.quadraticCurveTo(midX, brimY + h * 0.04, midX - w * 0.5, brimY - h * 0.08);
      c.closePath();
      c.fill();
    },
  },
  'hat-cowboy': {
    wf: 1.55, hf: 0.9,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.58,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.7;
      c.fillStyle = '#b07f42';                // tall crown, creased down the middle
      c.beginPath();
      c.moveTo(midX - w * 0.19, brimY);
      c.lineTo(midX - w * 0.17, h * 0.1);
      c.quadraticCurveTo(midX - w * 0.08, h * 0.02, midX, h * 0.18);
      c.quadraticCurveTo(midX + w * 0.08, h * 0.02, midX + w * 0.17, h * 0.1);
      c.lineTo(midX + w * 0.19, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#6e4a24';                // the band
      c.fillRect(midX - w * 0.195, brimY - h * 0.14, w * 0.39, h * 0.12);
      c.fillStyle = '#c08d4c';                // the gull-wing brim
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.3);
      c.quadraticCurveTo(midX - w * 0.4, brimY + h * 0.18, midX, brimY + h * 0.22);
      c.quadraticCurveTo(midX + w * 0.4, brimY + h * 0.18, midX + w * 0.5, brimY - h * 0.3);
      c.quadraticCurveTo(midX + w * 0.36, brimY + h * 0.02, midX, brimY + h * 0.04);
      c.quadraticCurveTo(midX - w * 0.36, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.3);
      c.closePath();
      c.fill();
    },
  },
  'hat-mountie': {
    wf: 1.5, hf: 0.8,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.56,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.7;
      c.fillStyle = '#c8a55a';                // the campaign peak
      c.beginPath();
      c.moveTo(midX - w * 0.17, brimY);
      c.lineTo(midX - w * 0.05, h * 0.06);
      c.lineTo(midX + w * 0.05, h * 0.06);
      c.lineTo(midX + w * 0.17, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#7a5c28';                // the strap band
      c.fillRect(midX - w * 0.175, brimY - h * 0.13, w * 0.35, h * 0.11);
      c.fillStyle = '#b8954e';                // the dead-flat brim
      c.fillRect(w * 0.02, brimY - h * 0.02, w * 0.96, h * 0.13);
    },
  },
  'hat-vueltiao': {
    wf: 1.5, hf: 0.7,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.56,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.68;
      c.fillStyle = '#e8dcb0';                // the woven crown
      c.beginPath();
      c.moveTo(midX - w * 0.17, brimY);
      c.lineTo(midX - w * 0.15, h * 0.12);
      c.quadraticCurveTo(midX, h * 0.02, midX + w * 0.15, h * 0.12);
      c.lineTo(midX + w * 0.17, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#26232b';                // the black turns of the weave
      c.fillRect(midX - w * 0.16, h * 0.22, w * 0.32, h * 0.09);
      c.fillRect(midX - w * 0.175, brimY - h * 0.16, w * 0.35, h * 0.12);
      c.fillStyle = '#e8dcb0';                // the wide brim, nearly flat
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.12);
      c.quadraticCurveTo(midX, brimY + h * 0.24, midX + w * 0.5, brimY - h * 0.12);
      c.quadraticCurveTo(midX, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.12);
      c.closePath();
      c.fill();
      c.strokeStyle = '#26232b';              // the banded brim edge
      c.lineWidth = Math.max(1, h * 0.06);
      c.beginPath();
      c.moveTo(midX - w * 0.46, brimY - h * 0.08);
      c.quadraticCurveTo(midX, brimY + h * 0.2, midX + w * 0.46, brimY - h * 0.08);
      c.stroke();
    },
  },
  'hat-cocar': {
    wf: 1.35, hf: 0.85,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.36 - height * 0.5,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      // seven feathers fanning from the band, colours alternating
      const colors = ['#d94036', '#e8c23a', '#2f74c0', '#d94036', '#2f74c0', '#e8c23a', '#d94036'];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1 - (i + 0.5) / 7);   // left to right across the fan
        const bx = w * 0.5 + Math.cos(a) * w * 0.28;
        const tipX = w * 0.5 + Math.cos(a) * w * 0.48;
        const tipY = h * 0.68 - Math.sin(a) * h * 0.62;
        c.strokeStyle = colors[i] ?? '#d94036';
        c.lineWidth = w * 0.09;
        c.beginPath();
        c.moveTo(bx, h * 0.72);
        c.lineTo(tipX, tipY);
        c.stroke();
      }
      c.fillStyle = '#7a4a26';                // the woven band
      c.fillRect(w * 0.08, h * 0.7, w * 0.84, h * 0.22);
      c.fillStyle = '#e8c23a';
      c.fillRect(w * 0.08, h * 0.76, w * 0.84, h * 0.08);
    },
  },
  'hat-bush': {
    wf: 1.4, hf: 0.7,
    dy: (cellPixels: number, height: number) => -cellPixels * 0.42 - height * 0.55,
    draw(c: CanvasRenderingContext2D, w: number, h: number) {
      const midX = w / 2;
      const brimY = h * 0.66;
      c.fillStyle = '#6b6b3a';                // the low soft crown
      c.beginPath();
      c.moveTo(midX - w * 0.18, brimY);
      c.quadraticCurveTo(midX - w * 0.16, h * 0.1, midX, h * 0.08);
      c.quadraticCurveTo(midX + w * 0.16, h * 0.1, midX + w * 0.18, brimY);
      c.closePath();
      c.fill();
      c.fillStyle = '#4f5029';                // the band
      c.fillRect(midX - w * 0.185, brimY - h * 0.14, w * 0.37, h * 0.12);
      c.fillStyle = '#7a7a45';                // the brim, slouching right
      c.beginPath();
      c.moveTo(midX - w * 0.5, brimY - h * 0.16);
      c.quadraticCurveTo(midX - w * 0.3, brimY + h * 0.22, midX + w * 0.1, brimY + h * 0.18);
      c.quadraticCurveTo(midX + w * 0.42, brimY + h * 0.3, midX + w * 0.5, brimY + h * 0.02);
      c.quadraticCurveTo(midX + w * 0.2, brimY + h * 0.02, midX - w * 0.5, brimY - h * 0.16);
      c.closePath();
      c.fill();
    },
  },
};
