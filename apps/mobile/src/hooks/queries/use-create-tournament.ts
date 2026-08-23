/**
 * TanStack Query mutation for creating a tournament. The server generates
 * the code and both timestamps; the client only names it and sizes the
 * window.
 * @module
 */
import { useMutation } from '@tanstack/react-query';

import { createTournament } from '@/lib/leaderboard';
import type { RuleMode } from '@/lib/modes';

/** Create a tournament opening now; resolves to the full row, code included. */
export function useCreateTournament() {
  return useMutation({
    mutationFn: (args: { title: string; mode: RuleMode; durationMinutes: number }) => createTournament(args),
  });
}
