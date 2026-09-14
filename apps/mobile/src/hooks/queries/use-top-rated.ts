/**
 * TanStack Query hook for the world ladder, the boards sheet's ELO chip.
 * Fetched fresh on every open, unlike the FULL TIME board, because a rating
 * moves on somebody ELSE's round as well as your own.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchTopRated } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** The top rated players for rooms, when `enabled` and configured. */
export function useTopRated(enabled: boolean) {
  return useQuery({
    queryKey: ['leaderboard', 'rated'],
    queryFn: () => fetchTopRated(100),
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
