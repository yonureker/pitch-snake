/**
 * TanStack Query mutation for submitting a finished round. The round goes
 * to the validator as its LOG against the server ticket that seeded it; the
 * server replays it and computes the score itself. On success the top-ten
 * query is invalidated so the fresh row appears.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RoundLog } from '@pitch-snake/engine';

import type { RuleMode } from '@/lib/modes';
import { validateRound } from '@/lib/validate';

import { TOP_SCORES_KEY } from './use-top-scores';

/**
 * Submit { name, mode, seedId, log }; resolves to the new row id for
 * highlighting plus the badges and coins the validator granted, so the
 * whistle can announce them the way the web page does.
 */
export function useSubmitScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      mode,
      seedId,
      log,
    }: {
      name: string;
      mode: RuleMode;
      seedId: number;
      log: RoundLog;
    }) => validateRound({ seedId, mode, name, log }),
    onSuccess: async () => {
      // the prefix invalidates every mode's board; only the played one
      // refetches. The wallet and the shelf move with every validated
      // round, since the validator is the only minter and granter.
      await client.invalidateQueries({ queryKey: TOP_SCORES_KEY });
      await client.invalidateQueries({ queryKey: ['wallet'] });
      await client.invalidateQueries({ queryKey: ['badges'] });
    },
  });
}
