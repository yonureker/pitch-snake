/**
 * The settings sheet: theme and the crowd, behind the header's gear.
 *
 * The page's twin (its gear modal), and the reason these chips left the
 * kick-off card: the card sells the round (the legend, START, MODES), and
 * the web moved every knob behind the gear long ago, so the two clients now
 * agree on where a setting lives. The gear only shows on menu screens, so
 * nothing here can change under a live round.
 *
 * Theming pattern, used by every sheet: the light StyleSheet is the base and
 * a second sheet carries only the colors the dark table swaps, applied as
 * `[styles.x, dark && darkStyles.x]`. Two static sheets rather than inline
 * colors, so the no-inline-styles rule keeps its teeth.
 *
 * @module
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DarkShell, GameColors } from '@/game/theme';
import type { ThemePref } from '@/lib/theme-prefs';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';
const ANTON = 'Anton_400Regular';

const THEME_LABELS: { label: string; pref: ThemePref }[] = [
  { label: 'AUTO', pref: 'auto' },
  { label: 'LIGHT', pref: 'light' },
  { label: 'DARK', pref: 'dark' },
];

/** Props: the two knobs, whether the dark table is on, and the way out. */
export interface SettingsSheetProps {
  themePref: ThemePref;
  onThemePref: (pref: ThemePref) => void;
  crowdOn: boolean;
  onCrowd: (on: boolean) => void;
  /** walls on the next round; the page's WALLS toggle, ON by default */
  wallsOn: boolean;
  onWalls: (on: boolean) => void;
  /** locked while a round is live, because walls reach the engine */
  wallsLocked: boolean;
  /** the sfx layer; the page's SOUND toggle, free to change any time */
  soundOn: boolean;
  onSound: (on: boolean) => void;
  dark: boolean;
  onClose: () => void;
}

/** The sheet. */
export function SettingsSheet({
  themePref,
  onThemePref,
  crowdOn,
  onCrowd,
  wallsOn,
  onWalls,
  wallsLocked,
  soundOn,
  onSound,
  dark,
  onClose,
}: SettingsSheetProps) {
  const chip = (on: boolean) => [styles.chip, dark && darkStyles.chip, on && styles.chipOn];
  const chipText = (on: boolean) => [styles.chipText, dark && darkStyles.chipText, on && styles.chipTextOn];
  return (
    <View style={[styles.sheet, dark && darkStyles.sheet]}>
      <Text style={[styles.title, dark && darkStyles.title]}>SETTINGS</Text>
      <View style={styles.row}>
        <Text style={[styles.label, dark && darkStyles.label]}>THEME</Text>
        {THEME_LABELS.map((t) => (
          <Pressable
            accessibilityRole="button"
            key={t.pref}
            onPress={() => {
              onThemePref(t.pref);
            }}
            style={chip(themePref === t.pref)}
          >
            <Text style={chipText(themePref === t.pref)}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, dark && darkStyles.label]}>WALLS</Text>
        <Pressable
          accessibilityRole="button"
          disabled={wallsLocked}
          onPress={() => {
            onWalls(!wallsOn);
          }}
          style={[chip(wallsOn), wallsLocked && styles.chipLocked]}
        >
          <Text style={chipText(wallsOn)}>{wallsOn ? 'ON' : 'OFF'}</Text>
        </Pressable>
        {wallsLocked && (
          <Text style={[styles.lockHint, dark && darkStyles.label]}>Finish the round to change.</Text>
        )}
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, dark && darkStyles.label]}>SOUND</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onSound(!soundOn);
          }}
          style={chip(soundOn)}
        >
          <Text style={chipText(soundOn)}>{soundOn ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, dark && darkStyles.label]}>CROWD</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onCrowd(!crowdOn);
          }}
          style={chip(crowdOn)}
        >
          <Text style={chipText(crowdOn)}>{crowdOn ? 'ON' : 'OFF'}</Text>
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
  chipLocked: { opacity: 0.4 },
  lockHint: { fontFamily: BARLOW, fontSize: 10, letterSpacing: 0.5, color: GameColors.muted, flexShrink: 1 },
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
  // the active chip is gold in both themes, so its label is dark ink in both
  chipTextOn: { color: GameColors.ink },
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

const darkStyles = StyleSheet.create({
  sheet: { backgroundColor: DarkShell.sheet },
  title: { color: DarkShell.sheetInk },
  label: { color: DarkShell.sheetMuted },
  chip: { borderColor: DarkShell.sheetGold },
  chipText: { color: DarkShell.sheetInk },
});
