/**
 * TanStack Query hook for your own solo record in one mode, lifetime or one
 * season. Server-derived from the score rows already kept, so it needs no
 * account; a signed-out caller simply gets zeroes.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchMyStats } from '@/lib/leaderboard';
import type { RuleMode } from '@/lib/modes';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Your games/avg/best for a mode, when `enabled` and configured. */
export function useMyStats(enabled: boolean, mode: RuleMode, season: string | null = null) {
  return useQuery({
    queryKey: ['stats', 'solo', mode, season ?? 'all'],
    queryFn: () => fetchMyStats(mode, season),
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
