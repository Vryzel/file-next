"use client";

import { useEffect } from "react";

export function shouldLoadMore(input: {
  lastIndex: number | undefined;
  loaded: number;
  hasMore: boolean;
  loading: boolean;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? 8;
  if (!input.hasMore || input.loading || input.loaded === 0) return false;
  if (input.lastIndex === undefined) return false;
  return input.lastIndex >= input.loaded - 1 - threshold;
}

/** Container width breakpoints: <640 → 3, <768 → 5, <1024 → 6, else 8. */
export function gridColumnCount(width: number): number {
  if (width < 640) return 3;
  if (width < 768) return 5;
  if (width < 1024) return 6;
  return 8;
}

/** Index to reveal when the selection grows. -1 if nothing new was selected. */
export function selectionEdgeIndex(
  files: ReadonlyArray<{ readonly id: string }>,
  selectedIds: ReadonlySet<string>,
  previous: ReadonlySet<string>,
): number {
  let minPrev = Number.POSITIVE_INFINITY;
  const added: number[] = [];
  for (let i = 0; i < files.length; i++) {
    const id = files[i]?.id;
    if (!id) continue;
    if (previous.has(id) && i < minPrev) minPrev = i;
    if (selectedIds.has(id) && !previous.has(id)) added.push(i);
  }
  const minAdded = added[0];
  const maxAdded = added[added.length - 1];
  if (minAdded === undefined || maxAdded === undefined) return -1;
  return minAdded < minPrev ? minAdded : maxAdded;
}

export function useLoadMoreOnEnd(input: {
  lastIndex: number | undefined;
  loaded: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore?: () => void;
}): void {
  const { lastIndex, loaded, hasMore, loading, onLoadMore } = input;
  useEffect(() => {
    if (!onLoadMore) return;
    if (shouldLoadMore({ lastIndex, loaded, hasMore, loading })) onLoadMore();
  }, [hasMore, lastIndex, loaded, loading, onLoadMore]);
}
