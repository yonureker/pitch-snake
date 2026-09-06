/**
 * Spending coins on one item. The server holds the balance under a per-user
 * lock, so the only client duty is to refetch the wallet afterwards.
 * @module
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { buyItem } from '@/lib/economy';

/** Buy one item by id; invalidates the wallet on success. */
export function useBuyItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: buyItem,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}
