import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** FlatList tuning for image-heavy property cards */
export const LIST_PERF = {
  initialNumToRender: 8,
  windowSize: 7,
  maxToRenderPerBatch: 8,
} as const;

export const PAGE_SIZE = {
  properties: 20,
  tables: 30,
  queues: 50,
} as const;
