/**
 * The on-screen directional pad, ported from the web version with its rules
 * intact (engine rule 13): every finger is tracked independently, a press is
 * a turn request even while another finger is down, and a finger sliding into
 * a new wedge fires that wedge. The zone under a finger resolves with the
 * same diagonal math the web pad paints (|u| versus |v| in pad coordinates).
 *
 * Zones are computed from pageX/pageY against the pad's measured window
 * origin, never from locationX: a touch that lands on a child (an arrow
 * glyph) reports location relative to that child, which is how the first
 * build misread presses. Children are also pointerEvents="none" so the pad
 * view owns every touch. The engine's setDir filters what is genuinely
 * invalid (reversals, repeats).
 */
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { GameColors } from '@/game/theme';

/** A pad direction as unit deltas. */
export interface PadDirection {
  x: number;
  y: number;
}

type Zone = 'up' | 'down' | 'left' | 'right';

const ZONE_DIRECTION: Record<Zone, PadDirection> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Props: the pad reports turn requests and nothing else. */
export interface DpadProps {
  onDir: (x: number, y: number) => void;
}

/** The four-wedge multi-touch pad. */
export function Dpad({ onDir }: DpadProps) {
  const padRef = useRef<View>(null);
  const frame = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const fingers = useRef(new Map<number, Zone>());
  const [pressed, setPressed] = useState<ReadonlySet<Zone>>(new Set());

  const measure = (): void => {
    padRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) frame.current = { x, y, w, h };
    });
  };

  const zoneAt = (pageX: number, pageY: number): Zone => {
    const u = (pageX - frame.current.x) / frame.current.w - 0.5;
    const v = (pageY - frame.current.y) / frame.current.h - 0.5;
    if (Math.abs(u) > Math.abs(v)) return u > 0 ? 'right' : 'left';
    return v > 0 ? 'down' : 'up';
  };

  const paint = (): void => {
    setPressed(new Set(fingers.current.values()));
  };

  const fire = (id: number, zone: Zone): void => {
    if (fingers.current.get(id) === zone) return;
    fingers.current.set(id, zone);
    paint();
    const d = ZONE_DIRECTION[zone];
    onDir(d.x, d.y);
    void Haptics.selectionAsync();
  };

  const onGrant = (e: GestureResponderEvent): void => {
    measure(); // layout may have shifted; refresh for the NEXT event at worst
    for (const t of e.nativeEvent.changedTouches) {
      fire(Number(t.identifier), zoneAt(t.pageX, t.pageY));
    }
  };

  const onMove = (e: GestureResponderEvent): void => {
    for (const t of e.nativeEvent.changedTouches) {
      fire(Number(t.identifier), zoneAt(t.pageX, t.pageY));
    }
  };

  const onEnd = (e: GestureResponderEvent): void => {
    for (const t of e.nativeEvent.changedTouches) {
      fingers.current.delete(Number(t.identifier));
    }
    paint();
  };

  return (
    <View
      ref={padRef}
      style={styles.pad}
      onLayout={measure}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onEnd}
      onResponderTerminate={onEnd}
    >
      <Text pointerEvents="none" style={[styles.arrow, styles.up, pressed.has('up') && styles.on]}>
        ↑
      </Text>
      <Text pointerEvents="none" style={[styles.arrow, styles.down, pressed.has('down') && styles.on]}>
        ↓
      </Text>
      <Text pointerEvents="none" style={[styles.arrow, styles.left, pressed.has('left') && styles.on]}>
        ←
      </Text>
      <Text pointerEvents="none" style={[styles.arrow, styles.right, pressed.has('right') && styles.on]}>
        →
      </Text>
      <View style={styles.diagA} pointerEvents="none" />
      <View style={styles.diagB} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: GameColors.panel,
    borderWidth: 2,
    borderColor: 'rgba(33,30,26,0.28)',
    overflow: 'hidden',
  },
  arrow: {
    position: 'absolute',
    fontSize: 34,
    fontWeight: '700',
    color: GameColors.ink,
  },
  on: { color: GameColors.gold },
  up: { top: '8%', left: '50%', transform: [{ translateX: '-50%' }] },
  down: { bottom: '8%', left: '50%', transform: [{ translateX: '-50%' }] },
  left: { left: '5%', top: '50%', transform: [{ translateY: '-50%' }] },
  right: { right: '5%', top: '50%', transform: [{ translateY: '-50%' }] },
  diagA: {
    position: 'absolute',
    left: '-25%',
    top: '50%',
    width: '150%',
    height: 1,
    backgroundColor: 'rgba(33,30,26,0.18)',
    transform: [{ rotate: '37deg' }],
  },
  diagB: {
    position: 'absolute',
    left: '-25%',
    top: '50%',
    width: '150%',
    height: 1,
    backgroundColor: 'rgba(33,30,26,0.18)',
    transform: [{ rotate: '-37deg' }],
  },
});
