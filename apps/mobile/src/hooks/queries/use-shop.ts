/**
 * The shop catalogue. Prices live in pitch_snake_items and never in a
 * client; the art is keyed by item id on this side, so an id this build has
 * never heard of still lists and simply previews as classic.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchShop } from '@/lib/economy';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** The catalogue query; the list changes by SQL, so an hour of stale is fine. */
export function useShop(open: boolean) {
  return useQuery({
    queryKey: ['shop'],
    queryFn: fetchShop,
    enabled: open && SUPABASE_CONFIGURED,
    staleTime: 3_600_000,
    refetchOnWindowFocus: false,
  });
}
