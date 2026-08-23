/**
 * TanStack Query hook for the global top ten. Enabled on demand (the board
 * only shows on the FULL TIME screen), refetched after a submit lands.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchTopScores } from '@/lib/leaderboard';
import type { RuleMode } from '@/lib/modes';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Key prefix shared with the submit mutation's invalidation; mode is appended. */
export const TOP_SCORES_KEY = ['leaderboard', 'top'] as const;

/** One rule mode's global top ten, when `enabled` and configured. */
export function useTopScores(enabled: boolean, mode: RuleMode) {
  return useQuery({
    queryKey: [...TOP_SCORES_KEY, mode],
    queryFn: () => fetchTopScores(10, mode),
    enabled: enabled && SUPABASE_CONFIGURED,
  });
}
