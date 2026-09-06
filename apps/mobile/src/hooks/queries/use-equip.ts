/**
 * Wearing an outfit. pitch_snake_equip UPSERTS the profile row, which is
 * what lets an anonymous player dress before ever typing a name.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { equipOutfit } from '@/lib/economy';

/** Equip a skin/hat pair; invalidates the wallet so worn state refetches. */
export function useEquip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { skin: string | null; hat: string | null }) => equipOutfit(args.skin, args.hat),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}
