/**
 * A four-cell snake dressed in the profile's own choices: the worn skin's
 * ramp for the body, the typed kit as a shirt on the cell behind the head.
 * The web sheet's preview (page/snake-preview.ts) ported to plain Views,
 * because a preview needs no atlas and Views re-render on every keystroke
 * for free; the Skia painter keeps the real pitch. The hat stays out on
 * purpose: its art lives in the Skia layer, and a preview that needs the
 * game's loader would tie this sheet to it for one decoration.
 *
 * The kit arrives as TYPED TEXT, not a washed Kit, for the same reason the
 * sheet holds it that way: a half-typed '#f2c1' must keep showing the
 * classic colour until it becomes a colour, never delete what the player is
 * in the middle of typing.
 *
 * @module
 */
import { StyleSheet, Text, View } from 'react-native';

import { JERSEY_LEFT_DEFAULT, JERSEY_RIGHT_DEFAULT } from '@/game/pitch-art';
import { snakeShadeFor, skinRamp } from '@/game/theme';
import { kitColor } from '@/lib/kit';

const CELL = 24;

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
  const head = skinRamp(skin).head;
  const shirtLeft = kitColor(left) ?? JERSEY_LEFT_DEFAULT;
  const shirtRight = kitColor(right) ?? JERSEY_RIGHT_DEFAULT;
  return (
    <View style={styles.row} pointerEvents="none">
      {/* tail to head: plain segments, the dressed one, then the head */}
      {cells === 4 && <View style={[styles.cell, { backgroundColor: snakeShadeFor(skin, 4) }]} />}
      <View style={[styles.cell, { backgroundColor: snakeShadeFor(skin, 2) }]} />
      <View style={[styles.cell, { backgroundColor: snakeShadeFor(skin, 1) }]}>
        {dressed && (
          <View style={styles.shirt}>
            <View style={[styles.shirtHalf, { backgroundColor: shirtLeft }]} />
            <View style={[styles.shirtHalf, { backgroundColor: shirtRight }]} />
            <Text style={styles.shirtNum}>{num === '' ? '10' : num}</Text>
          </View>
        )}
      </View>
      <View
        style={[
          styles.cell,
          { backgroundColor: `rgb(${String(head[0])}, ${String(head[1])}, ${String(head[2])})` },
        ]}
      >
        <View style={[styles.eye, styles.eyeTop]} />
        <View style={[styles.eye, styles.eyeLow]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shirt: {
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
  // the head looks where it is going: two eyes on its leading edge
  eye: { position: 'absolute', right: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#211e1a' },
  eyeTop: { top: 5 },
  eyeLow: { bottom: 5 },
});
