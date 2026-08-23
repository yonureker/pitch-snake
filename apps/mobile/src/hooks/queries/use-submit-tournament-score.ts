/**
 * TanStack Query mutation for submitting a finished round into a
 * tournament. On success that tournament's standings are invalidated.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { submitTournamentScore } from '@/lib/leaderboard';

import { tournamentTopKey } from './use-tournament-top';

/** Submit { code, name, score }; the server enforces the window and range. */
export function useSubmitTournamentScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ code, name, score }: { code: string; name: string; score: number }) =>
      submitTournamentScore(code, name, score),
    onSuccess: async (_data, { code }) => {
      await client.invalidateQueries({ queryKey: tournamentTopKey(code) });
    },
  });
}
