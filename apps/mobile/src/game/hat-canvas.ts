/**
 * A Skia canvas wearing the hat art's Canvas2D dialect.
 *
 * The hats live once, in the shared cosmetics package, written against the
 * small Canvas2D subset they always used (HatSurface): the page hands its
 * real 2d context straight in, and this adapter is how the app's Skia canvas
 * answers to the same calls. It exists so forty hats could MOVE instead of
 * being transcribed, and so the next hat is drawn once.
 *
 * Canvas semantics that matter here and are honoured deliberately: a path
 * survives its own fill() so a stroke() can follow it, and arc() first
 * connects the current point to the arc's start with a straight line (the
 * sweatband's pill shape is two such arcs). A full circle becomes addCircle,
 * because a 360-degree sweep collapses to nothing in Skia's arcToOval.
 *
 * ONLY at bake time: drawing a hat allocates a builder and paints, which is
 * fine in bakeOutfit/prepareVersusSprites and banned in the frame loop
 * (performance rule 4). Nothing here is reachable from buildPicture's steady
 * state.
 *
 * @module hat-canvas
 */
import { PaintStyle, Skia, type SkCanvas, type SkPath, type SkPathBuilder } from '@shopify/react-native-skia';

import type { HatArt } from './pitch-art';

/** What the shared art draws on; kept structurally, see hat-surface.ts. */
type HatSurface = Parameters<HatArt['draw']>[0];

/**
 * Draw one hat onto a Skia canvas through the shared dialect, and clean up
 * every native object the drawing created.
 *
 * @param c - the canvas of the sprite being baked.
 * @param art - the hat, from `hatFor`.
 * @param w - sprite width in pixels.
 * @param h - sprite height in pixels.
 */
export function drawHatOn(c: SkCanvas, art: HatArt, w: number, h: number): void {
  const fillPaint = Skia.Paint();
  const strokePaint = Skia.Paint();
  strokePaint.setStyle(PaintStyle.Stroke);
  let builder: SkPathBuilder | null = null;
  let path: SkPath | null = null;
  let hasPoint = false;

  const dropPath = (): void => {
    path?.dispose();
    path = null;
  };
  const dropBuilder = (): void => {
    builder?.dispose();
    builder = null;
  };
  // The verbs write into the builder; fill/stroke need a built path. Canvas
  // keeps the path alive across a fill so a stroke can reuse it, which is why
  // the built path is cached until the next beginPath rather than consumed.
  const pen = (): SkPathBuilder => {
    builder ??= Skia.PathBuilder.Make();
    return builder;
  };
  const built = (): SkPath => {
    if (path === null) {
      path = builder === null ? Skia.Path.Make() : builder.build();
      dropBuilder();
    }
    return path;
  };

  const surface: HatSurface = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    beginPath(): void {
      dropPath();
      dropBuilder();
      hasPoint = false;
    },
    moveTo(x: number, y: number): void {
      pen().moveTo(x, y);
      hasPoint = true;
    },
    lineTo(x: number, y: number): void {
      pen().lineTo(x, y);
      hasPoint = true;
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
      pen().quadTo(cpx, cpy, x, y);
      hasPoint = true;
    },
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
      const raw = endAngle - startAngle;
      if (raw >= Math.PI * 2 || raw <= -Math.PI * 2) {
        // a full turn: arcToOval would take the sweep modulo 360 and draw
        // nothing, so a circle contour is the honest translation
        pen().addCircle(x, y, radius);
        hasPoint = true;
        return;
      }
      // canvas sweeps clockwise and wraps a "backwards" pair the long way
      // round, so normalise into (0, 360] clockwise before handing to Skia
      const sweep = ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const oval = Skia.XYWHRect(x - radius, y - radius, radius * 2, radius * 2);
      pen().arcToOval(oval, (startAngle * 180) / Math.PI, (sweep * 180) / Math.PI, !hasPoint);
      hasPoint = true;
    },
    closePath(): void {
      pen().close();
    },
    fill(): void {
      if (typeof surface.fillStyle === 'string') fillPaint.setColor(Skia.Color(surface.fillStyle));
      c.drawPath(built(), fillPaint);
    },
    stroke(): void {
      if (typeof surface.strokeStyle === 'string') strokePaint.setColor(Skia.Color(surface.strokeStyle));
      strokePaint.setStrokeWidth(surface.lineWidth);
      c.drawPath(built(), strokePaint);
    },
    fillRect(x: number, y: number, w2: number, h2: number): void {
      if (typeof surface.fillStyle === 'string') fillPaint.setColor(Skia.Color(surface.fillStyle));
      c.drawRect(Skia.XYWHRect(x, y, w2, h2), fillPaint);
    },
  };

  art.draw(surface, w, h);
  dropPath();
  dropBuilder();
  fillPaint.dispose();
  strokePaint.dispose();
}
