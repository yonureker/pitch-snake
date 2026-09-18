/**
 * TanStack Query hook for your lifetime best per mode, both modes in one
 * call. Server-derived from the score rows already kept (a best is
 * max(score) on the board, never a second column), so it needs no account;
 * a signed-out caller simply reads zeroes.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchMyBests } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Your lifetime classic and survival bests, when enabled and configured. */
export function useMyBests(enabled: boolean) {
  return useQuery({
    queryKey: ['stats', 'my-bests'],
    queryFn: fetchMyBests,
    enabled: enabled && SUPABASE_CONFIGURED,
    staleTime: 0,
  });
}
