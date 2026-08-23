/**
 * TanStack Query hook for one tournament's standings (best per name,
 * ranked). Enabled on demand, invalidated by the tournament submit hook.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchTournamentTop } from '@/lib/leaderboard';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** Key builder shared with the tournament submit mutation's invalidation. */
export const tournamentTopKey = (code: string) => ['tournament', 'top', code] as const;

/** A tournament's top ten, when `enabled`, configured, and a code exists. */
export function useTournamentTop(code: string | null, enabled: boolean) {
  return useQuery({
    queryKey: tournamentTopKey(code ?? ''),
    queryFn: () => fetchTournamentTop(code ?? '', 10),
    enabled: enabled && code !== null && SUPABASE_CONFIGURED,
  });
}
