/**
 * YOUR RECORD, minimal since 2026-09-18: three owned numbers in one dialect.
 * The seven-row block it replaces (games/avg per mode, a W/L that booked
 * 2nd-of-5 as a loss, rivalry rows that showed anonymous strangers as "VS
 * YOU") was rejected by the owner outright; what a record shows now is the
 * lifetime best per mode, survival's in M:SS because its number is TIME, and
 * the season rating with its net move. A provisional rating shows nothing at
 * all, honouring the ladder's own "hidden until ten rounds" contract.
 *
 * Rendered inside the profile sheet, which only mounts while open, so its
 * two queries fire on open and never in the background. Hidden entirely
 * until there is at least one row worth showing, so a first-time player is
 * not met with a wall of zeroes.
 *
 * Must never: decide anything about a round. It reads and displays.
 *
 * @module
 */
import { StyleSheet, Text, View } from 'react-native';

import { GameColors } from '@/game/theme';
import { useMyBests } from '@/hooks/queries/use-my-bests';
import { useMyRatingSeason } from '@/hooks/queries/use-my-rating-season';
import { currentSeason } from '@/lib/season';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';

// survival's best is seconds survived; a time wears a clock face, not a score
function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(m)}:${String(ss).padStart(2, '0')}`;
}

/** One label + value row. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={styles.rowVal}>{v}</Text>
    </View>
  );
}

/**
 * The record: lifetime bests and the season rating, nothing else. Fetches on
 * mount (open) and shows nothing until a row has something to say.
 */
export function StatsPanel() {
  const bests = useMyBests(true);
  const rating = useMyRatingSeason(true, currentSeason());

  const rows: { k: string; v: string }[] = [];
  const b = bests.data;
  if (b && b.classic > 0) rows.push({ k: 'Classic', v: `best ${String(b.classic)}` });
  if (b && b.survival > 0) rows.push({ k: 'Survival', v: `best ${mmss(b.survival)}` });
  const r = rating.data;
  if (r && !r.provisional) {
    const sign = r.gain >= 0 ? '+' : '';
    rows.push({ k: 'ELO', v: `${String(r.rating)} (${sign}${String(r.gain)})` });
  }

  if (rows.length === 0) return null;

  return (
    <View style={styles.panel}>
      <Text style={styles.head}>YOUR RECORD</Text>
      <View style={styles.rows}>
        {rows.map((row) => (
          <Row k={row.k} key={row.k} v={row.v} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: '100%', gap: 6 },
  head: {
    fontFamily: BARLOW_BOLD,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GameColors.ink,
  },
  rows: { gap: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: 'rgba(33,30,26,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(33,30,26,0.12)',
  },
  rowKey: {
    fontFamily: BARLOW_BOLD,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GameColors.gold,
  },
  rowVal: { fontFamily: BARLOW, fontSize: 12, color: GameColors.ink, textAlign: 'right' },
});
