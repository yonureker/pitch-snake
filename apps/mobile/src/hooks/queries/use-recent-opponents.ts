/**
 * TanStack Query hook for who you have played, with the head-to-head record
 * against each, from pitch_snake_recent_opponents.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchRecentOpponents } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Your recent opponents and the record against each, when enabled. */
export function useRecentOpponents(enabled: boolean, limit = 3) {
  return useQuery({
    queryKey: ['stats', 'rivals', limit],
    queryFn: () => fetchRecentOpponents(limit),
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
