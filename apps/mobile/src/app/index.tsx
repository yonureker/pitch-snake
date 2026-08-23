import { StyleSheet, Text, View } from 'react-native';
import { createGame, replay, ENGINE_VERSION, SPEEDS } from '@pitch-snake/engine';

/** One scripted input: [quantum, dirX, dirY]. */
type ScriptedInput = [number, number, number];

/**
 * Simulates one deterministic round through the shared engine and verifies
 * its own score by replaying the recorded log - the exact property the
 * monorepo exists for, exercised on-device.
 */
function runHeadlessRound() {
  const game = createGame({ seed: 20260822, tickMs: SPEEDS.normal });
  // steer a fixed little script, then let the seeded hazards end it
  const script: ScriptedInput[] = [
    [40, 0, -1],
    [90, -1, 0],
    [140, 0, 1],
    [400, 1, 0],
  ];
  let next = 0;
  for (let quantum = 0; quantum < 60000 && game.alive; quantum++) {
    let input = script[next];
    while (input?.[0] === quantum) {
      game.setDir(input[1], input[2]);
      next++;
      input = script[next];
    }
    game.advanceQuanta(1);
  }
  const verified = replay(game.log).score === game.score;
  return { score: game.score, reason: game.deadReason, quanta: game.quanta, verified };
}

/**
 * Proof-of-life screen: the shared engine running inside React Native.
 * The Skia renderer replaces this screen next. (React Compiler memoizes the
 * simulation call; no manual memo needed.)
 */
export default function Index() {
  const round = runHeadlessRound();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>PITCH SNAKE</Text>
      <Text style={styles.line}>engine v{ENGINE_VERSION} is alive in React Native</Text>
      <Text style={styles.line}>
        headless round: score {round.score}, died to {round.reason} after {round.quanta} quanta
      </Text>
      <Text style={[styles.line, round.verified ? styles.good : styles.bad]}>
        replay verification: {round.verified ? 'score reproduced exactly' : 'MISMATCH'}
      </Text>
      <Text style={styles.hint}>Skia renderer goes here next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#efe6d0',
    padding: 24,
  },
  title: { fontSize: 34, fontWeight: '900', letterSpacing: 1, color: '#211e1a' },
  line: { fontSize: 15, color: '#211e1a', textAlign: 'center' },
  good: { color: '#1f7a33', fontWeight: '700' },
  bad: { color: '#cf3620', fontWeight: '700' },
  hint: { marginTop: 14, fontSize: 12, color: '#6b6553' },
});
