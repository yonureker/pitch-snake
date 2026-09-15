/**
 * TanStack Query hook for your own SEASON standing this month, with the net
 * move (rating - base). Concrete MyRatingSeason type so the gain reads without
 * a cast; the boards sheet's note uses useMyRating's union instead.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchMyRatingSeason } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Your season rating and gain for rooms this month, when enabled. */
export function useMyRatingSeason(enabled: boolean, season: string) {
  return useQuery({
    queryKey: ['leaderboard', 'my-rating-season', season],
    queryFn: () => fetchMyRatingSeason(season),
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
