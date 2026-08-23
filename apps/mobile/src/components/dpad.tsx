/**
 * The on-screen directional pad, ported from the web version with its rules
 * intact (engine rule 13): every finger is tracked independently, a press is
 * a turn request even while another finger is down, and a finger sliding into
 * a new wedge fires that wedge. The zone under a finger resolves with the
 * same diagonal math the web pad paints (|u| versus |v| in pad coordinates).
 *
 * Two hard-won details live here. Zones are computed from pageX/pageY against
 * the pad's measured window origin, never locationX (which is relative to
 * whatever child the touch lands on). And the responder wiring includes
 * onResponderStart/onResponderEnd: a SECOND finger landing while the first is
 * down arrives through Start, not Grant, and each individual lift through
 * End, not Release - without them overlapping presses drop and lifted
 * fingers leave stale state, which is exactly how fast two-thumb play breaks.
 *
 * Press feedback is a wedge fill like the web pad, held for a minimum flash
 * so even the quickest tap visibly reacts.
 */
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { GameColors } from '@/game/theme';

/** A pad direction as unit deltas. */
export interface PadDirection {
  x: number;
  y: number;
}

type Zone = 'up' | 'down' | 'left' | 'right';

const ZONES: Zone[] = ['up', 'down', 'left', 'right'];

const ZONE_DIRECTION: Record<Zone, PadDirection> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** How long a press stays lit after the finger leaves, so taps read. */
const FLASH_MS = 180;

// module scope: the compiler's purity rule (rightly) refuses impure calls in
// component-body functions it cannot prove are event-only; handlers pass the
// timestamp in instead
const nowMs = (): number => performance.now();

/** Props: the pad reports turn requests and nothing else. */
export interface DpadProps {
  onDir: (x: number, y: number) => void;
}

interface TouchPoint {
  identifier: string | number;
  pageX: number;
  pageY: number;
}

// Grant events on some RN versions carry an empty changedTouches for the
// first touch; the event itself is then the touch.
function touchesOf(e: GestureResponderEvent): TouchPoint[] {
  const changed = e.nativeEvent.changedTouches;
  if (changed.length > 0) return changed;
  return [e.nativeEvent];
}

/** The four-wedge multi-touch pad. */
export function Dpad({ onDir }: DpadProps) {
  const padRef = useRef<View>(null);
  const frame = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const fingers = useRef(new Map<number, Zone>());
  const flashUntil = useRef<Record<Zone, number>>({ up: 0, down: 0, left: 0, right: 0 });
  const repaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lit, setLit] = useState<ReadonlySet<Zone>>(new Set());
  const [padSize, setPadSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    return () => {
      if (repaintTimer.current !== null) clearTimeout(repaintTimer.current);
    };
  }, []);

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

  const paint = (now: number): void => {
    const on = new Set<Zone>(fingers.current.values());
    let pendingFlash = false;
    for (const z of ZONES) {
      if (flashUntil.current[z] > now) {
        on.add(z);
        pendingFlash = true;
      }
    }
    setLit((current) => {
      if (current.size === on.size && [...on].every((z) => current.has(z))) return current;
      return on;
    });
    if (repaintTimer.current !== null) clearTimeout(repaintTimer.current);
    repaintTimer.current =
      pendingFlash ?
        setTimeout(() => {
          paint(nowMs());
        }, FLASH_MS + 20)
      : null;
  };

  const fire = (id: number, zone: Zone): void => {
    if (fingers.current.get(id) === zone) return;
    fingers.current.set(id, zone);
    const now = nowMs();
    flashUntil.current[zone] = now + FLASH_MS;
    paint(now);
    const d = ZONE_DIRECTION[zone];
    onDir(d.x, d.y);
    void Haptics.selectionAsync();
  };

  // Grant = the responder begins (first touch); Start = EVERY touch-down,
  // including additional fingers while responding. Both route through fire,
  // which de-duplicates, so double delivery of the first touch is harmless.
  const onTouchDown = (e: GestureResponderEvent): void => {
    measure(); // layout can shift; refresh for the next event at worst
    for (const t of touchesOf(e)) {
      fire(Number(t.identifier), zoneAt(t.pageX, t.pageY));
    }
  };

  const onTouchMove = (e: GestureResponderEvent): void => {
    for (const t of touchesOf(e)) {
      fire(Number(t.identifier), zoneAt(t.pageX, t.pageY));
    }
  };

  // End = each individual lift; Release = the last finger's lift;
  // Terminate = the system took the responder away. All must clean up.
  const onTouchUp = (e: GestureResponderEvent): void => {
    for (const t of touchesOf(e)) {
      fingers.current.delete(Number(t.identifier));
    }
    paint(nowMs());
  };

  const onTerminate = (): void => {
    fingers.current.clear();
    paint(nowMs());
  };

  const onLayout = (): void => {
    measure();
    padRef.current?.measure((_x, _y, w, h) => {
      if (w > 0 && h > 0) setPadSize({ w, h });
    });
  };

  // wedge triangles via the border trick, sized from the measured pad
  const half = { w: padSize.w / 2, h: padSize.h / 2 };
  const wedgeUp = {
    borderLeftWidth: half.w,
    borderRightWidth: half.w,
    borderTopWidth: half.h,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: GameColors.gold,
  };
  const wedgeDown = {
    borderLeftWidth: half.w,
    borderRightWidth: half.w,
    borderBottomWidth: half.h,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: GameColors.gold,
  };
  const wedgeLeft = {
    borderTopWidth: half.h,
    borderBottomWidth: half.h,
    borderLeftWidth: half.w,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: GameColors.gold,
  };
  const wedgeRight = {
    borderTopWidth: half.h,
    borderBottomWidth: half.h,
    borderRightWidth: half.w,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: GameColors.gold,
  };

  return (
    <View
      ref={padRef}
      style={styles.pad}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onTouchDown}
      onResponderStart={onTouchDown}
      onResponderMove={onTouchMove}
      onResponderEnd={onTouchUp}
      onResponderRelease={onTouchUp}
      onResponderTerminate={onTerminate}
    >
      {padSize.w > 0 && (
        <>
          <View
            pointerEvents="none"
            style={[styles.wedge, styles.wedgeTop, wedgeUp, lit.has('up') && styles.wedgeOn]}
          />
          <View
            pointerEvents="none"
            style={[styles.wedge, styles.wedgeBottom, wedgeDown, lit.has('down') && styles.wedgeOn]}
          />
          <View
            pointerEvents="none"
            style={[styles.wedge, styles.wedgeTop, wedgeLeft, lit.has('left') && styles.wedgeOn]}
          />
          <View
            pointerEvents="none"
            style={[styles.wedge, styles.wedgeRightPos, wedgeRight, lit.has('right') && styles.wedgeOn]}
          />
        </>
      )}
      <View pointerEvents="none" style={styles.diagA} />
      <View pointerEvents="none" style={styles.diagB} />
      <Text pointerEvents="none" style={[styles.arrow, styles.up, lit.has('up') && styles.arrowOn]}>
        ↑
      </Text>
      <Text pointerEvents="none" style={[styles.arrow, styles.down, lit.has('down') && styles.arrowOn]}>
        ↓
      </Text>
      <Text pointerEvents="none" style={[styles.arrow, styles.left, lit.has('left') && styles.arrowOn]}>
        ←
      </Text>
      <Text pointerEvents="none" style={[styles.arrow, styles.right, lit.has('right') && styles.arrowOn]}>
        →
      </Text>
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
  wedge: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
  wedgeOn: { opacity: 0.38 },
  wedgeTop: { top: 0, left: 0 },
  wedgeBottom: { bottom: 0, left: 0 },
  wedgeRightPos: { top: 0, right: 0 },
  arrow: {
    position: 'absolute',
    fontSize: 34,
    fontWeight: '700',
    color: GameColors.ink,
  },
  arrowOn: { color: GameColors.goldBright },
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
