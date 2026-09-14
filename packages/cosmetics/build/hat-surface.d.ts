/**
 * The drawing surface a hat is drawn onto: the Canvas2D subset the art uses,
 * as a structural type.
 *
 * WHY THIS SHAPE AND NOT A PRETTIER ONE. The hat art was written against a
 * real CanvasRenderingContext2D and lived as two hand-kept ports, one per
 * client, until 2026-09-14. Making the shared dialect BE the canvas subset
 * means the page passes its real 2d context straight in, no adapter and no
 * cast, and every hat's geometry moved into the shared package byte for byte,
 * which is the difference between a move and forty transcriptions. The app
 * wraps its Skia canvas in a small adapter that speaks this interface
 * (apps/mobile/src/game/hat-canvas.ts); that adapter is client code because
 * it imports Skia, and this package imports nothing.
 *
 * The union types on `fillStyle`/`strokeStyle` exist so the page's context is
 * structurally assignable under strict rules: a real context can HOLD a
 * gradient or pattern, even though the hats only ever assign colour strings.
 * An adapter may treat anything that is not a string as "ignore".
 *
 * MUST NEVER grow a member the art does not use: every method here is one an
 * adapter has to implement faithfully, and the inventory (fill paths, quads,
 * lines, arcs, rects, strokes) is the whole of what forty hats needed.
 *
 * @module hat-surface
 */
/** Structural stand-in for CanvasGradient, so no DOM lib is needed here. */
export interface GradientLike {
    addColorStop(offset: number, color: string): void;
}
/** Structural stand-in for CanvasPattern, so no DOM lib is needed here. */
export interface PatternLike {
    setTransform(transform?: unknown): void;
}
/**
 * What a hat draws on. A real CanvasRenderingContext2D satisfies this as it
 * stands; anything else provides these members and canvas semantics, the one
 * that earns a comment being `arc`: it first connects the current point to
 * the arc's start with a straight line, which the sweatband's pill shape
 * depends on.
 */
export interface HatSurface {
    /** The colour the next `fill()` or `fillRect` paints; hats assign strings. */
    fillStyle: string | GradientLike | PatternLike;
    /** The colour the next `stroke()` paints; hats assign strings. */
    strokeStyle: string | GradientLike | PatternLike;
    /** Stroke width in pixels. */
    lineWidth: number;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    /** Angles in radians, clockwise from +x; connects from the current point. */
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    closePath(): void;
    fill(): void;
    stroke(): void;
    fillRect(x: number, y: number, w: number, h: number): void;
}
