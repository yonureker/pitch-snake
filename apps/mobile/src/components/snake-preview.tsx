/**
 * A short snake dressed in the profile's own choices: the worn skin for the
 * body, the typed kit as a shirt on the cell behind the head.
 *
 * The body is a real Skia draw since 2026-09-16, not a row of coloured
 * Views. The Views sampled shade indices 1..4 of a 64-step ramp, which is
 * the head's own end of every skin, so ring-patterned and textured skins
 * alike previewed as one solid colour: the owner's "I am just seeing solid
 * colors", diagnosed. The picture now walks the WHOLE ramp the way the
 * web's preview does and paints each skin's texture through the same shared
 * painters the pitch bakes with, so a preview cannot lie about what the
 * money buys.
 *
 * The shirt and the eyes stay as View overlays on purpose. The kit arrives
 * as TYPED TEXT, not a washed Kit: a half-typed '#f2c1' must keep showing
 * the classic colour until it becomes a colour, never delete what the
 * player is in the middle of typing, and a Text element re-renders per
 * keystroke for free.
 *
 * @module
 */
import { Canvas, ClipOp, PaintStyle, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import { StyleSheet, Text, View } from 'react-native';

import { textureFor } from '@pitch-snake/cosmetics/skin-texture';

import { JERSEY_LEFT_DEFAULT, JERSEY_RIGHT_DEFAULT } from '@/game/pitch-art';
import { withHatSurface } from '@/game/hat-canvas';
import { SNAKE_SHADES, skinRamp, snakeShadeFor } from '@/game/theme';
import { kitColor } from '@pitch-snake/cosmetics/kit';

const CELL = 24;
const GAP = 2;

// The body as one recorded picture: rounded cells tail to head, the shade
// walking the full ramp, each cell clipped and textured exactly as the
// pitch's own bake does it. Recorded at render (menu time, a handful of
// rects); the frame loop never comes near this.
function bodyPicture(skin: string | null, cells: 3 | 4): SkPicture {
  const width = cells * CELL + (cells - 1) * GAP;
  const recorder = Skia.PictureRecorder();
  const c = recorder.beginRecording(Skia.XYWHRect(0, 0, width, CELL));
  const art = skinRamp(skin);
  const texInfo = art.texture;
  const painter = texInfo === undefined ? null : textureFor(texInfo.id);
  const fill = Skia.Paint();
  const stroke = Skia.Paint();
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setColor(Skia.Color(art.line));
  stroke.setStrokeWidth(1.4);
  for (let col = 0; col < cells; col++) {
    // head on the right: column 0 is the tail-most cell, so its body
    // fraction is the far end of the ramp (the web preview's own mapping)
    const shadeIndex = Math.round(((cells - 1 - col) / (cells - 1)) * (SNAKE_SHADES - 1));
    const x = col * (CELL + GAP);
    const rect = Skia.RRectXY(Skia.XYWHRect(x + 1, 1, CELL - 2, CELL - 2), 6, 6);
    fill.setColor(Skia.Color(snakeShadeFor(skin, shadeIndex)));
    c.drawRRect(rect, fill);
    if (painter !== null && texInfo !== undefined) {
      c.save();
      c.clipRRect(rect, ClipOp.Intersect, true);
      c.translate(x + 1, 1);
      withHatSurface(c, (surface) => {
        painter(surface, CELL - 2, texInfo.ink, texInfo.ink2 ?? null);
      });
      c.restore();
    }
    c.drawRRect(rect, stroke);
  }
  fill.dispose();
  stroke.dispose();
  return recorder.finishRecordingAsPicture();
}

/** Props: the skin to wear, the kit fields exactly as typed, and the cut. */
export interface SnakePreviewProps {
  skin: string | null;
  left?: string;
  right?: string;
  num?: string;
  /** three cells for a shop row, four for the account sheet (the default) */
  cells?: 3 | 4;
  /** false leaves the shirt off: a shop row previews a SKIN, not your kit */
  dressed?: boolean;
}

/** The snake, head to the right, shirt on the cell behind it when dressed. */
export function SnakePreview({
  skin,
  left = '',
  right = '',
  num = '',
  cells = 4,
  dressed = true,
}: SnakePreviewProps) {
  const shirtLeft = kitColor(left) ?? JERSEY_LEFT_DEFAULT;
  const shirtRight = kitColor(right) ?? JERSEY_RIGHT_DEFAULT;
  const width = cells * CELL + (cells - 1) * GAP;
  const picture = bodyPicture(skin, cells);
  // the shirt rides the cell behind the head, exactly as on the pitch
  const shirtLeftEdge = (cells - 2) * (CELL + GAP) + 2;
  return (
    <View style={[styles.row, { width }]} pointerEvents="none">
      <Canvas style={{ width, height: CELL }}>
        <Picture picture={picture} />
      </Canvas>
      {dressed && (
        <View style={[styles.shirt, { left: shirtLeftEdge }]}>
          <View style={[styles.shirtHalf, { backgroundColor: shirtLeft }]} />
          <View style={[styles.shirtHalf, { backgroundColor: shirtRight }]} />
          <Text style={styles.shirtNum}>{num === '' ? '10' : num}</Text>
        </View>
      )}
      {/* the head looks where it is going: two eyes on its leading edge */}
      <View style={[styles.eye, styles.eyeTop]} />
      <View style={[styles.eye, styles.eyeLow]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: CELL, justifyContent: 'center' },
  shirt: {
    position: 'absolute',
    top: 2,
    width: CELL - 4,
    height: CELL - 4,
    borderRadius: 5,
    flexDirection: 'row',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(33,30,26,0.55)',
  },
  shirtHalf: { flex: 1, height: '100%' },
  shirtNum: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
    textShadowColor: 'rgba(33,30,26,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 2,
  },
  eye: { position: 'absolute', right: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#211e1a' },
  eyeTop: { top: 5 },
  eyeLow: { bottom: 5 },
});
