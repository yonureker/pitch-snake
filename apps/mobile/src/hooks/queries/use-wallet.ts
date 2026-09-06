/**
 * The player's wallet: balance, owned items, what is worn. One fetch at
 * mount and after any purchase or equip; the balance is the ledger's sum
 * server-side, so there is nothing to compute here.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchWallet } from '@/lib/economy';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** The wallet query; disabled entirely when the backend is not configured. */
export function useWallet() {
  return useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    enabled: SUPABASE_CONFIGURED,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
