/**
 * TanStack Query mutation that resolves a 6-character code to a tournament.
 * A mutation rather than a query because it runs on a button press with
 * user-typed input, and its result becomes screen state, not cache.
 * @module
 */
import { useMutation } from '@tanstack/react-query';

import { fetchTournament } from '@/lib/leaderboard';

/** Look up a code; resolves to the tournament or null when there is none. */
export function useJoinTournament() {
  return useMutation({
    mutationFn: (code: string) => fetchTournament(code),
  });
}
