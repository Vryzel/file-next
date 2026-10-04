"use client";

import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { useExplorerLabels } from "./labels";
import type { UploadQueueItem } from "./use-upload-queue";

/** Byte-weighted progress. A finished file counts in full; a failed one stays where it stopped. */
export function uploadQueuePercent(items: ReadonlyArray<UploadQueueItem>): number {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (total <= 0) return items.length === 0 ? 0 : 100;
  const loaded = items.reduce((sum, item) => {
    if (item.status === "success") return sum + item.size;
    if (item.status === "uploading" || item.status === "error") {
      return sum + (item.size * item.progress) / 100;
    }
    return sum;
  }, 0);
  return Math.min(100, Math.round((loaded / total) * 100));
}

export function ExplorerUploadStatus({
  items,
  onDismiss,
  className,
}: {
  readonly items: ReadonlyArray<UploadQueueItem>;
  readonly onDismiss: () => void;
  readonly className?: string;
}): React.ReactElement | null {
  const labels = useExplorerLabels();
  const listRef = useRef<HTMLUListElement>(null);
  const activeId = items.find((item) => item.status === "uploading")?.id;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    const row = list.querySelector<HTMLElement>(`[data-upload-id="${activeId}"]`);
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [activeId]);

  if (items.length === 0) return null;

  const done = items.filter((item) => item.status === "success").length;
  const failed = items.filter((item) => item.status === "error").length;
  const active = items.some(
    (item) => item.status === "queued" || item.status === "uploading",
  );
  const totalPercent = uploadQueuePercent(items);

  return (
    <div
      role="status"
      className={cn(
        "w-full rounded-[10px] border border-border bg-card p-3 shadow-xl",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="text-primary">
            {String(done).padStart(2, "0")}/{String(items.length).padStart(2, "0")}
          </span>{" "}
          {labels.uploadStatus}
          {failed > 0 ? (
            <span className="text-destructive"> · {failed}</span>
          ) : null}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-primary">
          {totalPercent}%
        </span>
        {!active ? (
          <button
            type="button"
            aria-label={labels.dismissUploads}
            className="inline-flex size-7 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted"
            onClick={onDismiss}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-[10px] bg-muted">
        <div className="h-full bg-primary" style={{ width: `${totalPercent}%` }} />
      </div>
      <ul ref={listRef} className="flex max-h-48 min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain">
        {items.map((item) => (
          <li key={item.id} data-upload-id={item.id} className="min-w-0 shrink-0">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
                  item.status === "error" && "text-destructive",
                  item.status === "success" && "text-primary",
                )}
              >
                {item.status === "uploading"
                  ? `${item.progress}%`
                  : item.status === "queued"
                    ? labels.uploadQueued
                    : item.status === "success"
                      ? labels.uploadDone
                      : labels.uploadFailed}
              </span>
            </div>
            {item.status === "uploading" ? (
              <div className="mt-1 h-1 overflow-hidden rounded-[10px] bg-muted">
                <div className="h-full bg-primary" style={{ width: `${item.progress}%` }} />
              </div>
            ) : null}
            {item.error ? (
              <p className="mt-0.5 truncate text-[10px] text-destructive">{item.error}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
