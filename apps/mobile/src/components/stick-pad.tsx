/**
 * The pad's other shape: an analog thumbstick with a floating origin.
 *
 * The web page's stick, ported (styles/dpad-and-header-chrome.css and the
 * padMode branch in index.html, 2026-09-13). A sibling of Dpad rather than a
 * mode inside it, for two reasons: the wedge pad carries a lot of hard-won
 * machinery this shape does not want (the echo guard, the boundary assist,
 * per-wedge flash timers), and folding a second control into it would push
 * that file past its 500-line ceiling.
 *
 * What it shares with the wedges is the only thing that matters: it reports
 * turn requests through the same `onDir`, so rule 12 holds and there is still
 * exactly one place that owns the playing-state gate and the reversal filter.
 * The stick is quantised to the same four directions the engine accepts;
 * nothing here is continuous by the time it leaves.
 *
 * The origin FLOATS: the stick centres wherever the thumb lands, not in the
 * middle of the pad, because steering without looking is the only reason to
 * want one. A landing therefore fires nothing, which is the single real
 * behavioural difference from the wedges and is what a stick is.
 *
 * Must never: simulate anything, gate on the round's state (onDir's owner
 * does that), or move the knob through React state. The knob follows a thumb
 * and is redrawn on every touch move, so it rides RN Animated values and
 * never re-renders the tree. Animated rather than Reanimated deliberately:
 * a shared value is written as a property, and the React Compiler's
 * immutability rule refuses that outside an effect or a worklet, whereas
 * `setValue` is a method call and says the same thing without a disable.
 *
 * @module
 */
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { DarkShell, GameColors } from '@/game/theme';
import type { PadDirection } from '@/components/dpad';

type Zone = 'up' | 'down' | 'left' | 'right';

const ZONE_DIRECTION: Record<Zone, PadDirection> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * How far a thumb must push before the stick means anything, as a fraction of
 * the pad's shorter side. A resting thumb wanders a few points and must not
 * steer.
 */
const DEAD = 0.075;
/**
 * The band either side of the diagonal where the push is ambiguous and the
 * last direction is kept. The wedges' seam reasoning applies exactly: without
 * hysteresis a thumb held near 45 degrees chatters between two directions and
 * fills the engine's three-slot queue with turns nobody asked for. Wider than
 * the wedge pad's because a stick is held, not tapped.
 */
const SEAM = 0.16;
/** How far the knob may travel from its origin, as a fraction of that side. */
const REACH = 0.22;

const BASE_SIZE = 128;
const KNOB_SIZE = 62;

// one haptic per turn, not per move event: a thumb crossing a seam fires once
let lastHapticAt = 0;
function tick(now: number): void {
  if (now - lastHapticAt < 40) return;
  lastHapticAt = now;
  void Haptics.selectionAsync();
}

// module scope: the compiler's purity rule refuses impure calls in component
// bodies it cannot prove are event-only
const nowMs = (): number => performance.now();

interface TouchPoint {
  identifier: string | number;
  pageX: number;
  pageY: number;
}

// Some RN versions deliver the first touch with an empty changedTouches;
// the event itself is then the touch. Same quirk the wedge pad handles.
function touchesOf(e: GestureResponderEvent): TouchPoint[] {
  const changed = e.nativeEvent.changedTouches;
  if (changed.length > 0) return changed;
  return [e.nativeEvent];
}

/** Props: the stick reports turn requests, and wears the table's clothes. */
export interface StickPadProps {
  onDir: (x: number, y: number) => void;
  /** the dark table is on: the stick swaps its colours, never its geometry */
  dark?: boolean;
}

/**
 * The analog stick.
 *
 * @param props - where to report turns, and whether the dark table is on.
 */
export function StickPad({ onDir, dark = false }: StickPadProps) {
  const padRef = useRef<View>(null);
  const frame = useRef({ x: 0, y: 0, w: 1, h: 1 });
  /** each finger's own origin and the direction it last asked for */
  const sticks = useRef(new Map<number, { x: number; y: number; zone: Zone | null }>());

  // Animated values, created once through a state initialiser: the knob is
  // redrawn on every touch move and must never cost a React render.
  const [base] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  const [knob] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  const [shown] = useState(() => new Animated.Value(0));

  const measure = (): void => {
    padRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) frame.current = { x, y, w, h };
    });
  };

  /** Where this finger's push points, or null for "keep what you had". */
  const zoneOf = (id: number, pageX: number, pageY: number): Zone | null => {
    const s = sticks.current.get(id);
    if (!s) return null;
    const reach = Math.min(frame.current.w, frame.current.h);
    const dx = (pageX - s.x) / reach;
    const dy = (pageY - s.y) / reach;
    if (Math.hypot(dx, dy) < DEAD) return null;
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < SEAM) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  };

  /** Put the knob under the thumb, clamped inside the ring. */
  const drawKnob = (id: number, pageX: number, pageY: number): void => {
    const s = sticks.current.get(id);
    if (!s) return;
    const reach = Math.min(frame.current.w, frame.current.h) * REACH;
    let dx = pageX - s.x;
    let dy = pageY - s.y;
    const len = Math.hypot(dx, dy);
    if (len > reach) {
      dx = (dx / len) * reach;
      dy = (dy / len) * reach;
    }
    base.setValue({ x: s.x - frame.current.x - BASE_SIZE / 2, y: s.y - frame.current.y - BASE_SIZE / 2 });
    knob.setValue({ x: dx, y: dy });
    shown.setValue(1);
  };

  const onTouchStart = (e: GestureResponderEvent): void => {
    measure();
    for (const t of touchesOf(e)) {
      const id = Number(t.identifier);
      sticks.current.set(id, { x: t.pageX, y: t.pageY, zone: null });
      drawKnob(id, t.pageX, t.pageY);
    }
  };

  const onTouchMove = (e: GestureResponderEvent): void => {
    for (const t of touchesOf(e)) {
      const id = Number(t.identifier);
      const s = sticks.current.get(id);
      if (!s) continue;
      drawKnob(id, t.pageX, t.pageY);
      const zone = zoneOf(id, t.pageX, t.pageY);
      if (zone === null || zone === s.zone) continue; // ambiguous, or no change
      s.zone = zone;
      const d = ZONE_DIRECTION[zone];
      onDir(d.x, d.y);
      tick(nowMs());
    }
  };

  const onTouchEnd = (e: GestureResponderEvent): void => {
    for (const t of touchesOf(e)) sticks.current.delete(Number(t.identifier));
    if (sticks.current.size === 0) shown.setValue(0); // another thumb may still hold it
  };

  const onTouchCancel = (): void => {
    sticks.current.clear();
    shown.setValue(0);
  };

  return (
    <View
      ref={padRef}
      style={[styles.pad, dark && darkStyles.pad]}
      onLayout={measure}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      {/* The arrows stay, at a whisper. Blanking them leaves a slab that reads
          as a broken control before the first touch, and they are also true:
          this stick is quantised to the same four directions, so the pad
          should still say which four. */}
      <View pointerEvents="none" style={styles.hintUp}>
        <Text style={[styles.hint, dark && darkStyles.hint]}>↑</Text>
      </View>
      <View pointerEvents="none" style={styles.hintDown}>
        <Text style={[styles.hint, dark && darkStyles.hint]}>↓</Text>
      </View>
      <View pointerEvents="none" style={styles.hintLeft}>
        <Text style={[styles.hint, dark && darkStyles.hint]}>←</Text>
      </View>
      <View pointerEvents="none" style={styles.hintRight}>
        <Text style={[styles.hint, dark && darkStyles.hint]}>→</Text>
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.base,
          dark && darkStyles.base,
          { opacity: shown, transform: base.getTranslateTransform() },
        ]}
      >
        <Animated.View
          style={[styles.knob, dark && darkStyles.knob, { transform: knob.getTranslateTransform() }]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    flex: 1,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: GameColors.panel,
    borderWidth: 2,
    borderColor: 'rgba(194,162,90,0.55)',
  },
  hint: { fontSize: 26, color: GameColors.ink, opacity: 0.2 },
  /* Each arrow gets its own full-bleed cell and is placed by FLEX, not by
     textAlignVertical, which is an Android-only style: on iOS and on web the
     side arrows simply stayed at the top of the pad. */
  hintUp: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 10,
  },
  hintDown: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  hintLeft: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 16,
  },
  hintRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 16,
  },
  base: {
    position: 'absolute',
    width: BASE_SIZE,
    height: BASE_SIZE,
    borderRadius: BASE_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(194,162,90,0.55)',
    backgroundColor: 'rgba(33,30,26,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: GameColors.gold,
    borderWidth: 2,
    borderColor: 'rgba(194,162,90,0.85)',
    opacity: 0.92,
  },
});

const darkStyles = StyleSheet.create({
  pad: { backgroundColor: DarkShell.padBg, borderColor: DarkShell.padRing },
  hint: { color: DarkShell.padInk },
  base: { borderColor: DarkShell.padRing, backgroundColor: 'rgba(0,0,0,0.18)' },
  knob: { borderColor: DarkShell.padRing },
});
