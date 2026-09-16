/**
 * The header tray's icons, DRAWN, exactly as the page draws them.
 *
 * The page stopped typing these as glyphs for a reason worth repeating: a
 * character like U+2699 is a font's opinion. It arrived as a hairline on some
 * platforms and a filled blob on others, never matched the weight of the
 * chips beside it, and could not be resized without dragging its line box
 * along. The app had the same problem one step worse, because an emoji cannot
 * even take a colour: a full-colour trophy sat in a row of gold outlines.
 *
 * So these are the page's own SVG path data, rendered through Skia, which
 * this app already ships for the pitch. Skia parses SVG path strings
 * directly, so the geometry is not a re-drawing or an approximation: it is
 * the same numbers, and the two clients cannot drift.
 *
 * Must never: grow a dependency for this. react-native-svg would do the job
 * and would be a second renderer in an app that already has one.
 *
 * @module
 */
import { Canvas, FillType, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

/** The page's viewBox; every path below is in these coordinates. */
const BOX = 24;

/**
 * The gear: a solid body with eight tapered teeth and a punched hub.
 *
 * Copied from index.html. Its own comment records that the first cut drew a
 * thin ring with round-capped spokes and read as a sun, so the outline is
 * computed (tip radius 10.6, root 7.9, hub 4.2, teeth narrowing 26 degrees to
 * 19) rather than eyeballed. The hub is punched by the even-odd fill rule.
 */
const GEAR_D =
  'M19.70 10.22L22.45 10.25L22.45 13.75L19.70 13.78A7.9 7.9 0 0 1 18.70 16.19L20.63 18.16L18.16 20.63L16.19 18.70A7.9 7.9 0 0 1 13.78 19.70L13.75 22.45L10.25 22.45L10.22 19.70A7.9 7.9 0 0 1 7.81 18.70L5.84 20.63L3.37 18.16L5.30 16.19A7.9 7.9 0 0 1 4.30 13.78L1.55 13.75L1.55 10.25L4.30 10.22A7.9 7.9 0 0 1 5.30 7.81L3.37 5.84L5.84 3.37L7.81 5.30A7.9 7.9 0 0 1 10.22 4.30L10.25 1.55L13.75 1.55L13.78 4.30A7.9 7.9 0 0 1 16.19 5.30L18.16 3.37L20.63 5.84L18.70 7.81A7.9 7.9 0 0 1 19.70 10.22ZM16.20 12.00A4.2 4.2 0 1 0 7.80 12.00A4.2 4.2 0 1 0 16.20 12.00Z';

/** The cup: bowl, stem and base filled, the two handles stroked. */
const CUP_BOWL = 'M6.3 2.8L17.7 2.8L17.15 9.4C16.75 13.2 14.6 15.3 12 15.3C9.4 15.3 7.25 13.2 6.85 9.4Z';
const CUP_STEM = 'M10.5 15.0L13.5 15.0L13.5 18.0L10.5 18.0Z';
const CUP_BASE = 'M7.6 17.8L16.4 17.8L17.6 21.3L6.4 21.3Z';
const CUP_HANDLES =
  'M6.5 4.4C3.7 4.5 2.5 6.0 2.9 7.9C3.3 9.8 4.9 10.8 7.25 11.1M17.5 4.4C20.3 4.5 21.5 6.0 21.1 7.9C20.7 9.8 19.1 10.8 16.75 11.1';

/**
 * Parse once, and never let a chrome icon take the screen down with it.
 *
 * These run at module scope, which is the right place for immutable art:
 * reparsing the same string every render is pure waste. But module scope is
 * also the worst place to throw from, because the failure is not "no icon",
 * it is a blank app. Skia has to be initialised before any of this is legal,
 * and on some hosts it is not. A missing gear is a cosmetic problem; an
 * uncaught throw here is every screen gone.
 */
function svg(d: string): SkPath | null {
  try {
    return Skia.Path.MakeFromSVGString(d);
  } catch {
    return null;
  }
}
/**
 * The gear parsed with EVEN-ODD fill, which punches the hub out of the body.
 * setFillType is deprecated on SkPath itself, so it goes through PathBuilder
 * (its own setFillType is current) and the intermediate objects are freed.
 * Guarded like svg(): a chrome icon must never take the screen down.
 */
function evenOddGear(): SkPath | null {
  const raw = svg(GEAR_D);
  if (raw === null) return null;
  try {
    const b = Skia.PathBuilder.MakeFromPath(raw);
    b.setFillType(FillType.EvenOdd);
    const path = b.build();
    b.dispose();
    raw.dispose();
    return path;
  } catch {
    return raw;
  }
}
const gearPath = evenOddGear();
const cupBowl = svg(CUP_BOWL);
const cupStem = svg(CUP_STEM);
const cupBase = svg(CUP_BASE);
const cupHandles = svg(CUP_HANDLES);

/** Props: how big, and in what colour. */
export interface TrayIconProps {
  size: number;
  color: string;
}

/**
 * The settings gear.
 *
 * @param props - the drawn size in points, and the ink.
 */
export function GearIcon({ size, color }: TrayIconProps) {
  const s = size / BOX;
  return (
    <View style={[styles.box, { width: size, height: size }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {gearPath !== null && <Path path={gearPath} color={color} style="fill" transform={[{ scale: s }]} />}
      </Canvas>
    </View>
  );
}

/**
 * The boards trophy.
 *
 * @param props - the drawn size in points, and the ink.
 */
export function CupIcon({ size, color }: TrayIconProps) {
  const s = size / BOX;
  const t = [{ scale: s }];
  return (
    <View style={[styles.box, { width: size, height: size }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {cupBowl !== null && <Path path={cupBowl} color={color} style="fill" transform={t} />}
        {cupStem !== null && <Path path={cupStem} color={color} style="fill" transform={t} />}
        {cupBase !== null && <Path path={cupBase} color={color} style="fill" transform={t} />}
        {cupHandles !== null && (
          <Path
            path={cupHandles}
            color={color}
            style="stroke"
            strokeWidth={2.3}
            strokeCap="round"
            transform={t}
          />
        )}
      </Canvas>
    </View>
  );
}

/**
 * The half-time pair, and the page's own numbers again.
 *
 * The page draws these as two `<rect rx="1.4">` and a triangle. A rect is not
 * a path, so the bars are written out here as the path that rect describes
 * (left 6.6 and 13.1, width 4.3, height 14.8, corner 1.4, in the same 24 box)
 * rather than re-invented at some other size. Anything else and the two
 * clients start drifting on a control that is meant to read as the same
 * button in both.
 */
const PAUSE_L =
  'M8.0 4.6L9.5 4.6A1.4 1.4 0 0 1 10.9 6.0L10.9 18.0A1.4 1.4 0 0 1 9.5 19.4L8.0 19.4A1.4 1.4 0 0 1 6.6 18.0L6.6 6.0A1.4 1.4 0 0 1 8.0 4.6Z';
const PAUSE_R =
  'M14.5 4.6L16.0 4.6A1.4 1.4 0 0 1 17.4 6.0L17.4 18.0A1.4 1.4 0 0 1 16.0 19.4L14.5 19.4A1.4 1.4 0 0 1 13.1 18.0L13.1 6.0A1.4 1.4 0 0 1 14.5 4.6Z';
const PLAY_D = 'M7.8 4.8L19.3 12L7.8 19.2Z';
const pauseLeft = svg(PAUSE_L);
const pauseRight = svg(PAUSE_R);
const playPath = svg(PLAY_D);

/**
 * The two bars: pause.
 *
 * @param props - the drawn size in points, and the ink.
 */
export function PauseIcon({ size, color }: TrayIconProps) {
  const t = [{ scale: size / BOX }];
  return (
    <View style={[styles.box, { width: size, height: size }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {pauseLeft !== null && <Path path={pauseLeft} color={color} style="fill" transform={t} />}
        {pauseRight !== null && <Path path={pauseRight} color={color} style="fill" transform={t} />}
      </Canvas>
    </View>
  );
}

/**
 * The triangle: resume.
 *
 * @param props - the drawn size in points, and the ink.
 */
export function PlayIcon({ size, color }: TrayIconProps) {
  return (
    <View style={[styles.box, { width: size, height: size }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {playPath !== null && (
          <Path path={playPath} color={color} style="fill" transform={[{ scale: size / BOX }]} />
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
