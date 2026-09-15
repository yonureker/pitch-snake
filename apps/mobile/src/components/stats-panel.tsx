/**
 * YOUR RECORD: the player's own stats, the page's profile-sheet stats block
 * ported. All server-derived from rows already kept (every validated round
 * writes a score row, every rated seat carries place and delta), so it needs
 * no account and no new storage; a signed-out player still sees solo stats.
 *
 * Rendered inside the profile sheet, which only mounts while open, so its
 * queries fire on open and never in the background. Hidden entirely until
 * there is at least one row worth showing, so a first-time player is not met
 * with a wall of zeroes.
 *
 * Must never: decide anything about a round. It reads and displays.
 *
 * @module
 */
import { StyleSheet, Text, View } from 'react-native';

import { GameColors } from '@/game/theme';
import { useMyMpStats } from '@/hooks/queries/use-my-mp-stats';
import { useMyRatingSeason } from '@/hooks/queries/use-my-rating-season';
import { useMyStats } from '@/hooks/queries/use-my-stats';
import { useRecentOpponents } from '@/hooks/queries/use-recent-opponents';
import { currentSeason } from '@/lib/season';

const BARLOW = 'Barlow_600SemiBold';
const BARLOW_BOLD = 'Barlow_700Bold';

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
 * The stats block. Fetches on mount (open) and shows nothing until a row has
 * something to say.
 */
export function StatsPanel() {
  const season = currentSeason();
  const classic = useMyStats(true, 'classic');
  const survival = useMyStats(true, 'survival');
  const mp = useMyMpStats(true);
  const rating = useMyRatingSeason(true, season);
  const rivals = useRecentOpponents(true, 3);

  const rows: { k: string; v: string }[] = [];
  const solo = (label: string, s: { games: number; avg: number; best: number } | undefined) => {
    if (!s || s.games === 0) return;
    rows.push({ k: label, v: `${String(s.games)} games · avg ${String(s.avg)} · best ${String(s.best)}` });
  };
  solo('Classic', classic.data);
  solo('Survival', survival.data);

  const m = mp.data;
  if (m && m.played > 0) {
    rows.push({ k: 'Multiplayer', v: `${String(m.played)} played · ${String(m.won)}W / ${String(m.lost)}L` });
  }

  const r = rating.data;
  if (r) {
    const sign = r.gain >= 0 ? '+' : '';
    rows.push({
      k: 'ELO this season',
      v: `${String(r.rating)} (${sign}${String(r.gain)})${r.provisional ? ' P' : ''}`,
    });
  }

  for (const rv of rivals.data ?? []) {
    if (rv.games === 0) continue;
    rows.push({
      k: `vs ${rv.name}`,
      v: `${String(rv.myWins)}-${String(rv.theirWins)} of ${String(rv.games)}`,
    });
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
