/**
 * TanStack Query hook for the global top ten. Enabled on demand (the board
 * only shows on the FULL TIME screen), refetched after a submit lands.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchTopScores } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Key shared with the submit mutation's invalidation. */
export const TOP_SCORES_KEY = ['leaderboard', 'top'] as const;

/** The global top ten, when `enabled` and configured. */
export function useTopScores(enabled: boolean) {
  return useQuery({
    queryKey: TOP_SCORES_KEY,
    queryFn: () => fetchTopScores(10),
    enabled: enabled && SUPABASE_CONFIGURED,
  });
}
