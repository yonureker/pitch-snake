/**
 * TanStack Query hook for the global top ten. Enabled on demand (the board
 * only shows on the FULL TIME screen), refetched after a submit lands.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { BOARD_PLACES, fetchTopScores } from '@/lib/leaderboard';
import type { RuleMode } from '@/lib/modes';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Key prefix shared with the submit mutation's invalidation; mode is appended. */
export const TOP_SCORES_KEY = ['leaderboard', 'top'] as const;

/** One rule mode's global top ten, when `enabled` and configured. */
export function useTopScores(enabled: boolean, mode: RuleMode) {
  return useQuery({
    queryKey: [...TOP_SCORES_KEY, mode],
    queryFn: () => fetchTopScores(BOARD_PLACES, mode),
    enabled: enabled && SUPABASE_CONFIGURED,
    // The FULL TIME board is a snapshot of the moment the round ended, and the
    // screen reads its tenth row to decide whether to ask for a name. A board
    // that re-shuffled on every app focus would re-judge a round already
    // decided and could take the entry form away mid-keystroke, so the fetch
    // on the whistle is the only one: enabling this query is what refreshes it.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
