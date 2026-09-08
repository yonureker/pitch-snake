/**
 * The snake preview: one small canvas that shows what a player is wearing.
 *
 * OWNS the preview's geometry and the crisp sizing, and nothing else. It is
 * told a skin, a hat and a jersey and draws them into a canvas; it never asks
 * what is worn, never reads the profile or the wallet, and never touches the
 * pitch. Everything it paints comes from page/pitch-art.ts, which is the whole
 * point: the shop's rule is that a preview cannot lie about what the money
 * buys, and the same rule now covers the jersey, which costs nothing.
 *
 * WHY ITS OWN FILE. It lived in page/shop.ts until 2026-09-08, when the
 * profile sheet needed the same picture. Exporting it from the shop would have
 * meant the account sheet importing its art from a module about buying things,
 * and shop.ts was already 561 lines against a 500 ceiling. Two callers is the
 * moment a thing stops belonging to one of them.
 *
 * MUST NEVER be reached from the frame loop: this is bake-time work, run when
 * a sheet opens or a colour changes (performance rule 7).
 *
 * @module snake-preview
 */
import type { Kit } from './kit.js';
import {
  buildLutFor, drawCrest, JERSEY_SOLO_NUM, paintJersey, roundRectOn,
  type HatArt, type SkinArt, SNAKE_SHADES,
} from './pitch-art.js';

// The preview is a real snake, not a drawing of one.
//
// It used to be a flat circle with the hat floating over it, on a canvas sized
// in CSS pixels only, so on any screen with a device pixel ratio above one the
// browser upscaled it and every preview looked soft. Both halves of that are
// fixed here: the canvas is sized in DEVICE pixels, and what it draws is the
// pitch's own body cell, ramp, outline, crest, eyes and hat.
//
// Two segments rather than one, because a snake is a body and a head and a
// single square reads as a token. The head is the right-hand square, facing
// right, which is the direction a round opens in.

// THREE squares, centred in the box. Two read as a fragment and one reads as
// a token; three is the shortest run that says "snake".
//
// The CELL shrank rather than the box growing, which is the part worth
// knowing. Widening the box to 88px to fit a third square at the old size
// took 24px straight out of the row, and the shop row is three things across
// a 320px sheet: the label lost it. SWEATBAND clipped and FLAT CAP wrapped to
// two lines. A smaller cell keeps the trio inside the width the row already
// had. The height still pays for a hat, which reaches about a cell above the
// crown, and the snake is centred rather than pushed to the floor.
/** How many body cells a preview draws. */
const PREVIEW_CELLS = 3;
/** The cell size those squares are drawn at. */
const PREVIEW_CELL = 17;
const PREVIEW_WIDTH = 72;
const PREVIEW_HEIGHT = 44;

/** How many device pixels there are per CSS pixel, clamped to something sane. */
function pixelRatio(): number {
  return Math.min(4, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * Size a canvas for the screen it is on rather than for CSS, and hand back a
 * context already scaled so callers keep drawing in CSS pixels.
 *
 * This is the whole of the blurriness fix: a 64x28 canvas on a 2x screen was
 * being stretched to 128x56 by the browser.
 *
 * @param canvas - the canvas to resize; its style keeps the CSS size.
 * @param width - the CSS width to present.
 * @param height - the CSS height to present.
 */
function crispContext(
  canvas: HTMLCanvasElement, width: number, height: number,
): CanvasRenderingContext2D | null {
  const ratio = pixelRatio();
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

/**
 * Draw the snake the way the pitch draws it: three body cells, head on the
 * right, wearing a skin, a hat and a jersey.
 *
 * @param canvas - the preview canvas; it is resized to suit the screen.
 * @param skin - the skin to wear, which decides the ramp, the outline and the
 *   crest.
 * @param hat - the hat to wear, or null for a bare head.
 * @param kit - the jersey to wear, or null for no shirt at all. Its colours
 *   must already be washed by page/kit.ts.
 */
export function paintSnakePreview(
  canvas: HTMLCanvasElement,
  skin: SkinArt,
  hat: HatArt | null,
  kit: Kit | null = null,
): void {
  const context = crispContext(canvas, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  if (context === null) return;

  const cell = PREVIEW_CELL;
  // the pitch's own proportions: half-width 0.42 of a cell, corner radius 0.32
  const half = cell * 0.42;
  const radius = cell * 0.32;
  const ramp = buildLutFor(skin);
  // Centred, both ways. The run of cells is centred on the box's middle, and
  // the head is the rightmost, so the trio reads left to right into its face.
  const step = cell * 0.92;
  const centreY = PREVIEW_HEIGHT / 2;
  const headX = PREVIEW_WIDTH / 2 + (step * (PREVIEW_CELLS - 1)) / 2;

  context.lineWidth = Math.max(1, cell * 0.05);
  context.strokeStyle = skin.line;
  // Tail first, so each cell sits over the one behind it exactly as on the
  // pitch, and the shade walks the ramp the same way the body does.
  for (let i = PREVIEW_CELLS - 1; i >= 0; i--) {
    const shade = Math.round((i / (PREVIEW_CELLS - 1)) * (SNAKE_SHADES - 1));
    context.fillStyle = ramp[shade] ?? '#f4ecd8';
    const x = headX - step * i;
    roundRectOn(context, x - half, centreY - half, half * 2, half * 2, radius);
    context.fill();
    context.stroke();
  }

  // THE JERSEY, on the cell behind the head. That is not a decorative choice:
  // it is segment index 1 on the pitch, the square the shirt actually rides,
  // so a preview and a round put it in the same place. Drawn after the body
  // and before the face, which is the pitch's own order.
  if (kit !== null) {
    const shirt = Math.ceil(cell * 0.84);
    const scratchShirt = document.createElement('canvas');
    const shirtRatio = pixelRatio();
    scratchShirt.width = Math.round(shirt * shirtRatio);
    scratchShirt.height = Math.round(shirt * shirtRatio);
    const shirtContext = scratchShirt.getContext('2d');
    if (shirtContext !== null) {
      shirtContext.setTransform(shirtRatio, 0, 0, shirtRatio, 0, 0);
      paintJersey(shirtContext, shirt, kit.num ?? JERSEY_SOLO_NUM, kit.left, kit.right);
      context.drawImage(
        scratchShirt, headX - step - shirt / 2, centreY - shirt / 2, shirt, shirt,
      );
    }
  }

  // the crest belongs to the SKIN, so one without a crest draws nothing
  context.save();
  context.translate(headX - half, centreY - half);
  drawCrest(context, half * 2, half * 2, skin);
  context.restore();

  // Eyes side by side and low on the head, which is how the pitch draws them
  // whenever the snake is heading up or down. Facing RIGHT the pitch stacks
  // them vertically instead, and every hat here sits low enough to cover the
  // upper one, so a faithful right-facing head previewed as one-eyed. The hat
  // is what the money buys and it has not moved; this only picks the heading
  // that leaves a face under it.
  const eye = cell * 0.16;
  context.fillStyle = '#211e1a';
  context.beginPath();
  context.arc(headX - eye * 0.72, centreY + eye * 0.66, cell * 0.08, 0, Math.PI * 2);
  context.arc(headX + eye * 0.72, centreY + eye * 0.66, cell * 0.08, 0, Math.PI * 2);
  context.fill();

  if (hat === null) return;
  // baked and blitted the way the pitch bakes and blits it, so a preview and a
  // round go through the same draw call and cannot disagree
  const hatWidth = Math.ceil(cell * hat.wf);
  const hatHeight = Math.ceil(cell * hat.hf);
  const scratch = document.createElement('canvas');
  const ratio = pixelRatio();
  scratch.width = Math.round(hatWidth * ratio);
  scratch.height = Math.round(hatHeight * ratio);
  const scratchContext = scratch.getContext('2d');
  if (scratchContext === null) return;
  scratchContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  hat.draw(scratchContext, hatWidth, hatHeight);
  context.drawImage(
    scratch, headX - hatWidth / 2, centreY + hat.dy(cell, hatHeight), hatWidth, hatHeight,
  );
}
