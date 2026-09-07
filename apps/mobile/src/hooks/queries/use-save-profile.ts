/**
 * Saving the profile. Names are unique case-insensitively (except the shared
 * un-name YOU), so this pre-checks with pitch_snake_name_taken to say so
 * kindly before the server's own unique index says so bluntly.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { nameTaken, saveProfile, type SaveResult } from '@/lib/profile';

/** Save name and flag; invalidates the profile so the chip refetches. */
export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { name: string; country: string | null }): Promise<SaveResult> => {
      if (await nameTaken(args.name)) return 'taken';
      return saveProfile(args.name, args.country);
    },
    onSuccess: (res) => {
      if (res === 'saved') void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
