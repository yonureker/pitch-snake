/**
 * The settings sheet: speed and the crowd, behind the header's gear.
 *
 * The page's twin (its gear modal), and the reason these chips left the
 * kick-off card: the card sells the round (the legend, START, MODES), and
 * the web moved every knob behind the gear long ago, so the two clients now
 * agree on where a setting lives. The gear only shows on menu screens, so
 * nothing here can change under a live round: speed applies to the next
 * kickoff exactly as it always did.
 *
 * @module
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SPEEDS } from '@pitch-snake/engine';
import { GameColors } from '@/game/theme';

const BARLOW_BOLD = 'Barlow_700Bold';
const ANTON = 'Anton_400Regular';

const SPEED_LABELS = [
  { label: 'SLOW', ms: SPEEDS.slow },
  { label: 'NORMAL', ms: SPEEDS.normal },
  { label: 'FAST', ms: SPEEDS.fast },
] as const;

/** Props: the two knobs, and the way out. */
export interface SettingsSheetProps {
  tickMs: number;
  onTickMs: (ms: number) => void;
  crowdOn: boolean;
  onCrowd: (on: boolean) => void;
  onClose: () => void;
}

/** The sheet. */
export function SettingsSheet({ tickMs, onTickMs, crowdOn, onCrowd, onClose }: SettingsSheetProps) {
  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>SETTINGS</Text>
      <View style={styles.row}>
        <Text style={styles.label}>SPEED</Text>
        {SPEED_LABELS.map((s) => (
          <Pressable
            accessibilityRole="button"
            key={s.label}
            onPress={() => {
              onTickMs(s.ms);
            }}
            style={[styles.chip, tickMs === s.ms && styles.chipOn]}
          >
            <Text style={styles.chipText}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>CROWD</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onCrowd(!crowdOn);
          }}
          style={[styles.chip, crowdOn && styles.chipOn]}
        >
          <Text style={styles.chipText}>{crowdOn ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
        <Text style={styles.doneText}>DONE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 380,
    gap: 14,
    padding: 16,
    borderRadius: 14,
    backgroundColor: GameColors.panel,
    borderWidth: 2,
    borderColor: GameColors.gold,
  },
  title: {
    fontFamily: ANTON,
    fontSize: 20,
    letterSpacing: 1.5,
    color: GameColors.ink,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    fontFamily: BARLOW_BOLD,
    fontSize: 12,
    letterSpacing: 1.5,
    color: GameColors.muted,
    width: 62,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  chipOn: { backgroundColor: GameColors.gold },
  chipText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1, color: GameColors.ink },
  done: {
    alignSelf: 'center',
    marginTop: 4,
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: GameColors.food,
  },
  doneText: { fontFamily: ANTON, fontSize: 15, letterSpacing: 1.2, color: '#ffffff' },
});
