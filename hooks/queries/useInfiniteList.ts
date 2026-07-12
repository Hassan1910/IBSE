import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';

type PageFetcher<T> = (page: number) => Promise<T[]>;

/**
 * Infinite list backed by TanStack Query. Pages are 0-indexed.
 * `pageSize` is used to detect whether another page exists.
 */
export function useInfiniteList<T>(
  queryKey: readonly unknown[],
  fetchPage: PageFetcher<T>,
  pageSize: number,
  options?: { enabled?: boolean; refetchOnFocus?: boolean }
) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam as number),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.length < pageSize ? undefined : (lastPageParam as number) + 1,
    enabled,
  });

  useFocusEffect(
    useCallback(() => {
      if (!options?.refetchOnFocus || !enabled) return;
      const state = queryClient.getQueryState(queryKey as any);
      const age = state?.dataUpdatedAt ? Date.now() - state.dataUpdatedAt : Infinity;
      if (age > 30_000) {
        queryClient.invalidateQueries({ queryKey });
      }
    }, [options?.refetchOnFocus, enabled, queryClient, queryKey])
  );

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p) ?? [],
    [query.data]
  );

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [query]);

  return {
    items,
    loading: query.isLoading,
    refreshing: query.isRefetching && !query.isFetchingNextPage,
    loadingMore: query.isFetchingNextPage,
    error: query.error,
    refresh: () => query.refetch(),
    loadMore,
    hasMore: !!query.hasNextPage,
  };
}
