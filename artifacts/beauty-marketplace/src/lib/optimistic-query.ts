import type { QueryClient, QueryFilters, QueryKey } from "@tanstack/react-query";

export type QuerySnapshot<T> = {
  queryKey: QueryKey;
  value: T | undefined;
};

export async function updateQueryOptimistically<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  update: (current: T | undefined) => T | undefined,
): Promise<QuerySnapshot<T>> {
  await queryClient.cancelQueries({ queryKey, exact: true });
  const snapshot = { queryKey, value: queryClient.getQueryData<T>(queryKey) };
  queryClient.setQueryData<T>(queryKey, update);
  return snapshot;
}

export async function updateMatchingQueriesOptimistically<T>(
  queryClient: QueryClient,
  filters: QueryFilters,
  update: (current: T | undefined) => T | undefined,
): Promise<QuerySnapshot<T>[]> {
  await queryClient.cancelQueries(filters);
  const snapshots = queryClient.getQueriesData<T>(filters).map(([queryKey, value]) => ({ queryKey, value }));
  queryClient.setQueriesData<T>(filters, update);
  return snapshots;
}

export function rollbackQueries(
  queryClient: QueryClient,
  snapshots: QuerySnapshot<unknown>[] | undefined,
): void {
  snapshots?.forEach(({ queryKey, value }) => queryClient.setQueryData(queryKey, value));
}