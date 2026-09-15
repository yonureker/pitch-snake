/**
 * TanStack Query hook for your own multiplayer record, lifetime or one season.
 * Only rated seats count (place is filled at sealing), from pitch_snake_my_mp_stats.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchMyMpStats } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Your MP played/won/lost/delta, when `enabled` and configured. */
export function useMyMpStats(enabled: boolean, season: string | null = null) {
  return useQuery({
    queryKey: ['stats', 'mp', season ?? 'all'],
    queryFn: () => fetchMyMpStats(season),
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
