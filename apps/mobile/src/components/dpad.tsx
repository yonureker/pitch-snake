/**
 * The on-screen directional pad, ported from the web version with its rules
 * intact (engine rule 13): every finger is tracked independently, a press is
 * a turn request even while another finger is down, and a finger sliding into
 * a new wedge fires that wedge. The zone under a finger resolves with the
 * same diagonal math the web pad paints (|u| versus |v| in pad coordinates).
 *
 * Hard-won details. Zones compute from pageX/pageY against the pad's
 * measured window origin, never locationX (relative to whatever child the
 * touch lands on). Input comes from the RAW touch events (onTouchStart and
 * friends) as the ONLY source: they carry every finger independently, and a
 * second simultaneous pipeline (the responder system) once delivered echo
 * duplicates whose interleaving could slip the engine's repeat filter, fill
 * the turn queue with a phantom, and drop the player's real next press. One
 * source, plus an echo guard in fireDown, is the rule.
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

const ZONE_GLYPH: Record<Zone, string> = { up: '↑', down: '↓', left: '←', right: '→' };

// module-scope DEV trace buffer (not a ref: it is diagnostics, not UI state,
// and the compiler's ref rules rightly stay out of module scope)
const traceBuffer: string[] = [];
function pushTrace(tag: string): string {
  traceBuffer.push(tag);
  if (traceBuffer.length > 12) traceBuffer.shift();
  return traceBuffer.join(' ');
}

// one haptic per press-moment: a two-thumb chord lands as two downs a few
// ms apart, and two selection ticks that close together feel like a buzz
let lastHapticAt = 0;
function hapticOncePerPress(now: number): void {
  if (now - lastHapticAt < 40) return;
  lastHapticAt = now;
  void Haptics.selectionAsync();
}

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

// Some RN versions deliver the first touch with an empty changedTouches;
// the event itself is then the touch.
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
  const lastDownAt = useRef(new Map<number, number>());
  const flashUntil = useRef<Record<Zone, number>>({ up: 0, down: 0, left: 0, right: 0 });
  const repaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lit, setLit] = useState<ReadonlySet<Zone>>(new Set());
  const [padSize, setPadSize] = useState({ w: 0, h: 0 });
  // DEV-only delivery trace: what actually arrived (t down, m slide-fire,
  // e lift, x swallowed echo), with the finger id and wedge, so a dropped
  // press is distinguishable from one that never reached JS, a fat-finger
  // wrong-wedge press shows its real glyph, and an x proves the echo guard
  // caught a double delivery
  const [trace, setTrace] = useState('');
  const note = (tag: string): void => {
    if (!__DEV__) return;
    setTrace(pushTrace(tag));
  };

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

  // A DOWN always fires - iOS reuses touch identifiers, so equality-bailing
  // on downs eats genuine re-presses - EXCEPT for a delivery echo: the same
  // finger, the same zone, within an eyeblink, with no lift in between, is
  // one physical press delivered twice, never two presses. It must not reach
  // the engine, because a non-adjacent duplicate slips the engine's repeat
  // filter and can fill the 3-deep queue with a phantom turn while the real
  // next press drops off the end. (A deliberate down-left-down staircase is
  // legitimate input, so the engine cannot dedupe this; only the pad knows
  // what was one touch.)
  const ECHO_MS = 60;
  const fireDown = (id: number, zone: Zone, tag: string): void => {
    const now = nowMs();
    const last = lastDownAt.current.get(id) ?? -1e9;
    if (fingers.current.get(id) === zone && now - last < ECHO_MS) {
      note(`x${String(id)}`);
      lastDownAt.current.set(id, now);
      return;
    }
    note(`${tag}${String(id)}${ZONE_GLYPH[zone]}`);
    fingers.current.set(id, zone);
    lastDownAt.current.set(id, now);
    flashUntil.current[zone] = now + FLASH_MS;
    paint(now);
    const d = ZONE_DIRECTION[zone];
    onDir(d.x, d.y);
    hapticOncePerPress(now);
  };

  // a MOVE fires only on zone change: a finger resting in a wedge is one
  // press, not a stream of them
  const fireMove = (id: number, zone: Zone): void => {
    if (fingers.current.get(id) === zone) return;
    fireDown(id, zone, 'm');
  };

  // onTouchStart fires per changed touch, second and third fingers included,
  // with no responder negotiation involved
  const handleDown = (e: GestureResponderEvent, tag: string): void => {
    measure(); // layout can shift; refresh for the next event at worst
    for (const t of touchesOf(e)) {
      fireDown(Number(t.identifier), zoneAt(t.pageX, t.pageY), tag);
    }
  };
  const onDownRaw = (e: GestureResponderEvent): void => {
    handleDown(e, 't');
  };

  const onTouchMove = (e: GestureResponderEvent): void => {
    for (const t of touchesOf(e)) {
      fireMove(Number(t.identifier), zoneAt(t.pageX, t.pageY));
    }
  };

  // onTouchEnd = each individual lift; onTouchCancel = the system swallowed
  // the gesture (incoming call, control center). Both must clean up.
  const onTouchUp = (e: GestureResponderEvent): void => {
    for (const t of touchesOf(e)) {
      if (fingers.current.delete(Number(t.identifier))) note(`e${String(t.identifier)}`);
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
      onTouchStart={onDownRaw}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchUp}
      onTouchCancel={onTerminate}
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
      {__DEV__ && trace !== '' && (
        <Text pointerEvents="none" style={styles.trace}>
          {trace}
        </Text>
      )}
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
  trace: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 10,
    color: GameColors.muted,
  },
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
