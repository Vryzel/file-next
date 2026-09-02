"use client";

import { FolderPlus, LayoutGrid, List as ListIcon, Search, Trash, Upload } from "lucide-react";
import { cn } from "./cn";
import { useExplorerLabels } from "./labels";
import type { ViewMode } from "@vryzel/file-next-headless";
import type { ExplorerColumn, SortDirection } from "./explorer-list-view";

export interface ExplorerToolbarProps {
  readonly view: ViewMode;
  readonly onViewChange: (v: ViewMode) => void;
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  readonly trashOpen?: boolean;
  readonly onTrashToggle?: () => void;
  readonly trashHasItems?: boolean;
  readonly onNewFolder?: () => void;
  readonly onUpload?: () => void;
  readonly uploading?: boolean;
  readonly uploadLabel?: string;
  readonly sortKey: ExplorerColumn;
  readonly sortDirection: SortDirection;
  readonly onSortChange: (key: ExplorerColumn) => void;
  readonly className?: string;
}

const SORT_KEYS: ReadonlyArray<ExplorerColumn> = ["name", "size", "modified", "kind"];

const btn =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-background px-2.5 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:h-8 sm:px-3";

export function ExplorerToolbar(props: ExplorerToolbarProps): React.ReactElement {
  const {
    view,
    onViewChange,
    query,
    onQueryChange,
    trashOpen,
    onTrashToggle,
    trashHasItems = false,
    onNewFolder,
    onUpload,
    uploading = false,
    uploadLabel,
    sortKey,
    sortDirection,
    onSortChange,
    className,
  } = props;
  const labels = useExplorerLabels();
  const sortLabel: Record<ExplorerColumn, string> = {
    name: labels.sortName,
    size: labels.sortSize,
    modified: labels.sortModified,
    kind: labels.sortKind,
  };

  const viewToggle = (
    <div
      role="toolbar"
      aria-label={labels.viewOptions}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-[10px] border border-border bg-background p-0.5"
    >
      <button
        type="button"
        aria-label={labels.listView}
        aria-pressed={view === "list"}
        onClick={() => onViewChange("list")}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7",
          view === "list"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <ListIcon aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-label={labels.gridView}
        aria-pressed={view === "grid"}
        onClick={() => onViewChange("grid")}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-[8px] outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7",
          view === "grid"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <LayoutGrid aria-hidden="true" className="size-4" />
      </button>
    </div>
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 items-center gap-2 sm:max-w-xs sm:flex-1">
        {onQueryChange ? (
          <label className="relative min-w-0 flex-1 sm:min-w-40">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query ?? ""}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={labels.search}
              aria-label={labels.search}
              className="h-10 w-full rounded-[10px] border border-border bg-background pl-9 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
            />
          </label>
        ) : null}
        <div className="sm:hidden">{viewToggle}</div>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
        {onUpload ? (
          <button type="button" onClick={onUpload} disabled={uploading} aria-label={uploadLabel ?? labels.upload} className={btn}>
            <Upload aria-hidden="true" className="size-4 sm:size-3.5" />
            <span className="hidden sm:inline">{uploadLabel ?? labels.upload}</span>
          </button>
        ) : null}
        {onNewFolder ? (
          <button type="button" onClick={onNewFolder} aria-label={labels.newFolder} className={btn}>
            <FolderPlus aria-hidden="true" className="size-4 sm:size-3.5" />
            <span className="hidden sm:inline">{labels.newFolder}</span>
          </button>
        ) : null}
        <div className="inline-flex h-10 min-w-0 flex-1 items-center rounded-[10px] border border-border sm:h-8 sm:max-w-48 sm:flex-none">
          <select
            aria-label={sortLabel[sortKey]}
            value={sortKey}
            onChange={(event) => onSortChange(event.target.value as ExplorerColumn)}
            className="h-10 min-w-0 flex-1 appearance-none bg-transparent pl-2.5 pr-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground outline-none sm:h-8"
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {sortLabel[key]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`${sortLabel[sortKey]} ${sortDirection}`}
            onClick={() => onSortChange(sortKey)}
            className="inline-flex size-10 shrink-0 items-center justify-center font-mono text-[10px] text-muted-foreground hover:bg-muted sm:size-8"
          >
            {sortDirection === "asc" ? "↑" : "↓"}
          </button>
        </div>
        {onTrashToggle ? (
          <button
            type="button"
            aria-label={labels.trash}
            aria-pressed={trashOpen === true}
            onClick={onTrashToggle}
            className={cn(
              "relative inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8",
              trashOpen
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Trash aria-hidden="true" className="size-4" />
            {trashHasItems ? (
              <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            ) : null}
          </button>
        ) : null}
        <div className="hidden sm:block">{viewToggle}</div>
      </div>
    </div>
  );
}
