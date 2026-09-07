/**
 * The player's profile: the five-character name the boards show and the flag
 * beside it. One row per user, keyed by the user id and never by the name.
 * @module
 */
import { useQuery } from '@tanstack/react-query';

import { fetchProfile } from '@/lib/profile';
import { SUPABASE_CONFIGURED } from '@/lib/supabase-config';

/** The profile query; disabled entirely when the backend is not configured. */
export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    enabled: SUPABASE_CONFIGURED,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
