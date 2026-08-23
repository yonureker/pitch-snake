/**
 * TanStack Query mutation for submitting a finished round's score. On
 * success the top-ten query is invalidated so the fresh row appears.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { submitScore } from '@/lib/leaderboard';

import { TOP_SCORES_KEY } from './use-top-scores';

/** Submit { name, score }; resolves to the new row id for highlighting. */
export function useSubmitScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, score }: { name: string; score: number }) => submitScore(name, score),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: TOP_SCORES_KEY });
    },
  });
}
