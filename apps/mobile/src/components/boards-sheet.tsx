/**
 * The world boards, behind the header's trophy.
 *
 * The page's boards sheet ported: the death screen only ever shows a board
 * when your own round placed on one, so browsing them needed its own door,
 * and on the page that door is the trophy in the header tray. The app had the
 * trophy's data (useTopScores) and no way in.
 *
 * Fetched fresh on every open rather than cached like the FULL TIME board,
 * and for the same reason that one is not: the death screen's board is a
 * snapshot of the moment a round ended and decides whether to ask for a name,
 * so it must not move. This one answers "where do I stand", which is a
 * question about right now.
 *
 * Must never: decide anything about a round. It reads and displays.
 *
 * @module
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DarkShell, GameColors } from '@/game/theme';
import { useTopScores } from '@/hooks/queries/use-top-scores';
import type { RuleMode } from '@/lib/modes';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';
const ANTON = 'Anton_400Regular';

const BOARDS: { label: string; mode: RuleMode }[] = [
  { label: 'CLASSIC', mode: 'classic' },
  { label: 'SURVIVAL', mode: 'survival' },
];

/** Props: the country flag renderer the screen already owns, and the way out. */
export interface BoardsSheetProps {
  dark: boolean;
  /** the screen's Flag component, passed in so the sprite lives in one place */
  renderFlag: (code: string | null) => React.ReactNode;
  onClose: () => void;
}

/**
 * The sheet.
 *
 * @param props - theming, a flag renderer, and the close handler.
 */
export function BoardsSheet({ dark, renderFlag, onClose }: BoardsSheetProps) {
  const [mode, setMode] = useState<RuleMode>('classic');
  const board = useTopScores(true, mode);
  const chip = (on: boolean) => [styles.chip, dark && darkStyles.chip, on && styles.chipOn];
  const chipText = (on: boolean) => [styles.chipText, dark && darkStyles.chipText, on && styles.chipTextOn];
  return (
    <View style={[styles.sheet, dark && darkStyles.sheet]}>
      <Text style={[styles.title, dark && darkStyles.title]}>TOP 10 WORLDWIDE</Text>
      <View style={styles.row}>
        {BOARDS.map((b) => (
          <Pressable
            accessibilityRole="button"
            key={b.mode}
            onPress={() => {
              setMode(b.mode);
            }}
            style={chip(mode === b.mode)}
          >
            <Text style={chipText(mode === b.mode)}>{b.label}</Text>
          </Pressable>
        ))}
      </View>
      {board.isPending ?
        <Text style={styles.empty}>Loading…</Text>
      : board.isError ?
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void board.refetch();
          }}
        >
          <Text style={styles.empty}>Could not reach the board. Tap to retry.</Text>
        </Pressable>
      : board.data.length === 0 ?
        <Text style={styles.empty}>No scores yet</Text>
      : <ScrollView style={styles.list}>
          {board.data.map((r, i) => (
            <View key={r.id} style={styles.entry}>
              <Text style={styles.rank}>{i + 1}</Text>
              {renderFlag(r.country)}
              <Text style={styles.name} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={styles.score}>{r.score}</Text>
            </View>
          ))}
        </ScrollView>
      }
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
        <Text style={styles.doneText}>DONE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    backgroundColor: GameColors.panel,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  title: { fontFamily: ANTON, fontSize: 20, letterSpacing: 1, color: GameColors.ink },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  chipOn: { backgroundColor: GameColors.gold },
  chipText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1, color: GameColors.ink },
  chipTextOn: { color: '#211e1a' },
  list: { maxHeight: 320 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rank: { fontFamily: ANTON, fontSize: 14, color: GameColors.muted, width: 22 },
  name: { flex: 1, fontFamily: BARLOW, fontSize: 14, letterSpacing: 1, color: GameColors.ink },
  score: { fontFamily: ANTON, fontSize: 15, color: GameColors.ink },
  empty: { fontFamily: BARLOW, fontSize: 13, color: GameColors.muted, paddingVertical: 18 },
  done: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  doneText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1.4, color: GameColors.ink },
});

const darkStyles = StyleSheet.create({
  sheet: { backgroundColor: DarkShell.sheet, borderColor: DarkShell.padRing },
  title: { color: DarkShell.ink },
  chip: { borderColor: DarkShell.padRing },
  chipText: { color: DarkShell.ink },
});
