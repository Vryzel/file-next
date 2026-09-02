"use client";

import { X } from "lucide-react";
import { cn } from "./cn";
import { useExplorerLabels } from "./labels";
import type { UploadQueueItem } from "./use-upload-queue";

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
  if (items.length === 0) return null;

  const done = items.filter((item) => item.status === "success").length;
  const failed = items.filter((item) => item.status === "error").length;
  const active = items.some(
    (item) => item.status === "queued" || item.status === "uploading",
  );
  const visible = items.slice(-6);

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
        {!active ? (
          <button
            type="button"
            aria-label={labels.dismissUploads}
            className="ml-auto inline-flex size-7 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted"
            onClick={onDismiss}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <span className="ml-auto" />
        )}
      </div>
      <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
        {visible.map((item) => (
          <li key={item.id} className="min-w-0">
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
