/**
 * The world boards, behind the header's trophy: the page's boards sheet.
 *
 * Three chips, exactly the page's: CLASSIC and SURVIVAL are the score boards,
 * ELO is the ladder. The ladder is fetched fresh on every open, unlike the
 * FULL TIME board, because a rating moves on somebody ELSE's round as well as
 * your own. Your own standing goes in the note line rather than the list,
 * the page's reasoning verbatim: the list is who is BEST, and you are usually
 * not in the visible part of it.
 *
 * The sheet is CREAM in both themes, because the page's modals are: these are
 * paper laid over the table, not part of it.
 *
 * Must never: decide anything about a round. It reads and displays.
 *
 * @module
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GameColors } from '@/game/theme';
import { useMyRating } from '@/hooks/queries/use-my-rating';
import { useTopRated } from '@/hooks/queries/use-top-rated';
import { useTopScores } from '@/hooks/queries/use-top-scores';
import type { RuleMode } from '@/lib/modes';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';
const ANTON = 'Anton_400Regular';

type BoardTab = RuleMode | 'ladder';

const CHIPS: { label: string; tab: BoardTab }[] = [
  { label: 'CLASSIC', tab: 'classic' },
  { label: 'SURVIVAL', tab: 'survival' },
  { label: 'ELO', tab: 'ladder' },
];

/** Props: the flag renderer the screen owns, and the way out. */
export interface BoardsSheetProps {
  renderFlag: (code: string | null) => React.ReactNode;
  onClose: () => void;
}

/**
 * The sheet.
 *
 * @param props - a flag renderer and the close handler.
 */
export function BoardsSheet({ renderFlag, onClose }: BoardsSheetProps) {
  const [tab, setTab] = useState<BoardTab>('classic');
  const scores = useTopScores(tab !== 'ladder', tab === 'ladder' ? 'classic' : tab);
  const ladder = useTopRated(tab === 'ladder');
  const mine = useMyRating(tab === 'ladder');
  const board = tab === 'ladder' ? ladder : scores;

  // the page's own note under the ladder: your standing, and the one rule
  const my = mine.data ?? null;
  const ladderNote =
    my !== null ?
      `You are rated ${String(my.rating)}${my.provisional ? ' P' : ''} over ${String(my.rounds)} rated ${
        my.rounds === 1 ? 'round' : 'rounds'
      }${my.provisional ? '. P means under ten. ' : '. '}Only quick match is rated.`
    : 'Only quick match is rated. Play one to get a rating.';

  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>{tab === 'ladder' ? 'ELO · TOP 100' : 'TOP 100 WORLDWIDE'}</Text>
      <View style={styles.chips}>
        {CHIPS.map((c) => (
          <Pressable
            accessibilityRole="button"
            key={c.tab}
            onPress={() => {
              setTab(c.tab);
            }}
            style={[styles.chip, tab === c.tab && styles.chipOn]}
          >
            <Text style={[styles.chipText, tab === c.tab && styles.chipTextOn]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      {board.isPending ?
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>…</Text>
        </View>
      : board.isError ?
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void board.refetch();
          }}
          style={styles.emptyRow}
        >
          <Text style={styles.emptyText}>Could not reach the world board. Tap to retry.</Text>
        </Pressable>
      : board.data.length === 0 ?
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>
            {tab === 'ladder' ? 'No rated rounds yet' : 'No scores yet. The board has room.'}
          </Text>
        </View>
      : <ScrollView style={styles.list}>
          {tab === 'ladder' ?
            ladder.data?.map((r, i) => (
              <View key={`${r.name}-${String(i)}`} style={styles.entry}>
                <Text style={styles.rank}>{i + 1}</Text>
                {renderFlag(r.country)}
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.score}>
                  {r.rating}
                  {r.provisional && <Text style={styles.prov}> P</Text>}
                </Text>
              </View>
            ))
          : scores.data?.map((r, i) => (
              <View key={r.id} style={styles.entry}>
                <Text style={styles.rank}>{i + 1}</Text>
                {renderFlag(r.country)}
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.score}>{r.score}</Text>
              </View>
            ))
          }
        </ScrollView>
      }
      {tab === 'ladder' && !mine.isPending && <Text style={styles.note}>{ladderNote}</Text>}
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
        <Text style={styles.doneText}>DONE</Text>
      </Pressable>
    </View>
  );
}

/* The page's modal clothes: cream paper, ink text, gold accents, red DONE.
   No dark variant on purpose; the page's modals stay cream on a dark table. */
const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 14,
    padding: 18,
    gap: 12,
    alignItems: 'center',
    backgroundColor: GameColors.panel,
    borderWidth: 1.5,
    borderColor: GameColors.gold,
  },
  title: { fontFamily: ANTON, fontSize: 22, letterSpacing: 0.5, color: GameColors.ink },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(33,30,26,0.25)',
    backgroundColor: 'rgba(33,30,26,0.05)',
  },
  chipOn: { backgroundColor: GameColors.gold, borderColor: GameColors.gold },
  chipText: { fontFamily: BARLOW_BOLD, fontSize: 12, letterSpacing: 1, color: GameColors.ink },
  chipTextOn: { color: '#211e1a' },
  list: { alignSelf: 'stretch', maxHeight: 320 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rank: { fontFamily: ANTON, fontSize: 14, color: GameColors.muted, width: 22 },
  name: { flex: 1, fontFamily: BARLOW, fontSize: 14, letterSpacing: 1, color: GameColors.ink },
  score: { fontFamily: ANTON, fontSize: 15, color: GameColors.ink },
  prov: { fontFamily: BARLOW_BOLD, fontSize: 10, color: GameColors.muted },
  emptyRow: {
    alignSelf: 'stretch',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(33,30,26,0.06)',
    alignItems: 'center',
  },
  emptyText: { fontFamily: BARLOW, fontSize: 13, color: GameColors.muted, textAlign: 'center' },
  note: {
    fontFamily: BARLOW_BOLD,
    fontSize: 11,
    color: GameColors.gold,
    textAlign: 'center',
    lineHeight: 15,
  },
  done: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: GameColors.food,
    shadowColor: '#b32f1c',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  doneText: { fontFamily: BARLOW_BOLD, fontSize: 13, letterSpacing: 1.5, color: '#ffffff' },
});
