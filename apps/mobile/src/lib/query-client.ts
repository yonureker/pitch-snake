/**
 * One QueryClient for the app (constructed at module scope, never mid-render,
 * per @tanstack/query/stable-query-client).
 * @module
 */
import { QueryClient } from '@tanstack/react-query';

/** The app-wide client; server state lives here, UI state in components. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false },
  },
});
