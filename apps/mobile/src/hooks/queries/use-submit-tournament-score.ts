/**
 * TanStack Query mutation for submitting a finished round into a
 * tournament, through the validator (the tournament code rides along with
 * the round's log). On success that tournament's standings are invalidated.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { RoundLog } from '@pitch-snake/engine';

import type { RuleMode } from '@/lib/modes';
import { validateRound } from '@/lib/validate';

import { tournamentTopKey } from './use-tournament-top';

/** Submit { code, mode, name, seedId, log }; the server enforces the window. */
export function useSubmitTournamentScore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      code,
      mode,
      name,
      seedId,
      log,
    }: {
      code: string;
      mode: RuleMode;
      name: string;
      seedId: number;
      log: RoundLog;
    }) => validateRound({ seedId, mode, name, code, log }).then(() => undefined),
    onSuccess: async (_data, { code }) => {
      await client.invalidateQueries({ queryKey: tournamentTopKey(code) });
    },
  });
}
