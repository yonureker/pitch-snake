// Proof-of-life screen: the shared engine running inside React Native.
// It simulates a deterministic headless round on mount and shows the result,
// which exercises the exact property the monorepo exists for — the same
// packages/engine module driving web, mobile and the server validator.
// The Skia renderer replaces this screen next.
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createGame, replay, ENGINE_VERSION, SPEEDS } from '@pitch-snake/engine';

function runHeadlessRound() {
  const g = createGame({ seed: 20260822, tickMs: SPEEDS.normal });
  // steer a fixed little script, then let the seeded hazards end it
  const script: [number, number, number][] = [[40, 0, -1], [90, -1, 0], [140, 0, 1], [400, 1, 0]];
  let s = 0;
  for (let q = 0; q < 60000 && g.alive; q++) {
    while (s < script.length && script[s][0] === q) { g.setDir(script[s][1], script[s][2]); s++; }
    g.advanceQuanta(1);
  }
  const verified = replay(g.log).score === g.score;
  return { score: g.score, reason: g.deadReason, quanta: g.quanta, verified };
}

export default function Index() {
  const r = useMemo(runHeadlessRound, []);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>PITCH SNAKE</Text>
      <Text style={styles.line}>engine v{ENGINE_VERSION} is alive in React Native</Text>
      <Text style={styles.line}>
        headless round: score {r.score}, died to {r.reason} after {r.quanta} quanta
      </Text>
      <Text style={[styles.line, r.verified ? styles.good : styles.bad]}>
        replay verification: {r.verified ? 'score reproduced exactly' : 'MISMATCH'}
      </Text>
      <Text style={styles.hint}>Skia renderer goes here next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#efe6d0', padding: 24 },
  title: { fontSize: 34, fontWeight: '900', letterSpacing: 1, color: '#211e1a' },
  line: { fontSize: 15, color: '#211e1a', textAlign: 'center' },
  good: { color: '#1f7a33', fontWeight: '700' },
  bad: { color: '#cf3620', fontWeight: '700' },
  hint: { marginTop: 14, fontSize: 12, color: '#6b6553' },
});
