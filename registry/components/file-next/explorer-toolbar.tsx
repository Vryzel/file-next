"use client";

/**
 * `<ExplorerToolbar />` — the row above the file list with the
 * view-mode toggle (list | grid). Designed to be slotted into the
 * orchestrator's header area.
 *
 * Spec:
 *   - Two icon buttons with aria-pressed states.
 *   - Keyboard accessible: focus ring + Enter / Space activates.
 */
import { FolderPlus, LayoutGrid, List as ListIcon, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ViewMode } from "@file-next/headless";

export interface ExplorerToolbarProps {
  readonly view: ViewMode;
  readonly onViewChange: (v: ViewMode) => void;
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  readonly trashOpen?: boolean;
  readonly onTrashToggle?: () => void;
  readonly onNewFolder?: () => void;
  readonly usedBytes?: number;
  readonly quotaBytes?: number;
  /** Optional className for the wrapper. */
  readonly className?: string;
}

export function ExplorerToolbar(
  props: ExplorerToolbarProps,
): React.ReactElement {
  const {
    view,
    onViewChange,
    query,
    onQueryChange,
    trashOpen,
    onTrashToggle,
    onNewFolder,
    usedBytes,
    quotaBytes,
    className,
  } = props;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {quotaBytes != null ? (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {formatBytes(usedBytes ?? 0)} / {formatBytes(quotaBytes)}
        </span>
      ) : null}
      {onNewFolder ? (
        <button
          type="button"
          aria-label="New folder"
          onClick={onNewFolder}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderPlus aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      {onQueryChange ? (
        <label className="relative min-w-40 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query ?? ""}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      ) : null}
      {onTrashToggle ? (
        <button
          type="button"
          aria-label="Trash"
          aria-pressed={trashOpen === true}
          onClick={onTrashToggle}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring",
            trashOpen
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      <div
        role="toolbar"
        aria-label="View options"
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5"
      >
        <button
          type="button"
          aria-label="List view"
          aria-pressed={view === "list"}
          onClick={() => onViewChange("list")}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view === "list"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ListIcon aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          onClick={() => onViewChange("grid")}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view === "grid"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <LayoutGrid aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
