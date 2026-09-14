/**
 * Build an SkPath through the non-deprecated PathBuilder.
 *
 * react-native-skia deprecated the mutating methods on SkPath itself
 * (moveTo, lineTo, quadTo, close, addArc, ...) in favour of
 * Skia.PathBuilder. Calling them still worked but logged a warning per call,
 * and this app draws every hat, the pitch and the field art by hand, so a
 * bake was a wall of them.
 *
 * The builder has the identical method names and signatures, so the art code
 * is unchanged inside the callback; only the object it draws into is a
 * builder. The built path is returned with the SAME ownership the old
 * `Skia.Path.Make()` result had: it is the caller's to dispose. The builder
 * itself is disposed here, so nothing leaks across the swap.
 *
 * @module
 */
import { Skia, type SkPath, type SkPathBuilder } from '@shopify/react-native-skia';

/**
 * Draw a path with the builder, return the finished SkPath.
 *
 * @param draw - receives the builder; call moveTo/lineTo/quadTo/close/etc on
 *   it exactly as the old code called them on the path.
 */
export function buildPath(draw: (b: SkPathBuilder) => void): SkPath {
  const b = Skia.PathBuilder.Make();
  draw(b);
  const path = b.build();
  b.dispose();
  return path;
}
