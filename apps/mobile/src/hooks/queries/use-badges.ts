/**
 * The badge shelf: the whole catalogue with this player's earned marks.
 * Refetched after a submit, since the validator is the only granter.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchBadges } from '@/lib/economy';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** The shelf query, fetched only while the shelf is on screen. */
export function useBadges(open: boolean) {
  return useQuery({
    queryKey: ['badges'],
    queryFn: fetchBadges,
    enabled: open && SUPABASE_CONFIGURED,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
