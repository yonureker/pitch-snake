/**
 * TanStack Query mutation for submitting a finished round's score. On
 * success the top-ten query is invalidated so the fresh row appears.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { submitScore } from '@/lib/leaderboard';
import type { RuleMode } from '@/lib/modes';

import { TOP_SCORES_KEY } from './use-top-scores';

/** Submit { name, score, mode }; resolves to the new row id for highlighting. */
export function useSubmitScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, score, mode }: { name: string; score: number; mode: RuleMode }) =>
      submitScore(name, score, mode),
    onSuccess: async () => {
      // the prefix invalidates every mode's board; only the played one refetches
      await client.invalidateQueries({ queryKey: TOP_SCORES_KEY });
    },
  });
}
