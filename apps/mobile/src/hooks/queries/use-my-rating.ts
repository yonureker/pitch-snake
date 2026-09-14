/**
 * TanStack Query hook for your own ladder standing, shown in the boards
 * sheet's note line rather than the list, because the list is who is BEST
 * and you are usually not in the visible part of it.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchMyRating } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Your rooms rating, null when never rated, when `enabled` and configured. */
export function useMyRating(enabled: boolean) {
  return useQuery({
    queryKey: ['leaderboard', 'my-rating'],
    queryFn: fetchMyRating,
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
