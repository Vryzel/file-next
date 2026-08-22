"use client";

/**
 * `<FileExplorer />` — full file-browser orchestrator.
 *
 * Imports + configuration only; no app-level state. Wires:
 *   - `useFileExplorer` (view mode + selection + drag state)
 *   - `<ExplorerListView />` / `<ExplorerGridView />` based on `view`
 *   - `<ExplorerToolbar />` for the view-mode toggle
 *   - `<ExplorerContextMenu />` for right-click actions
 *   - `<Breadcrumbs />` for folder navigation
 *   - `<EmptyState />` / `<ErrorState />` for the hook's branches
 *
 * "Import + configure" model: consumers supply the tenant, the
 * server-action callbacks, and the listFiles adapter. The
 * explorer handles state, drag-drop, sorting, and rendering.
 *
 * Architecture:
 *   - The shell is a client component — every interactive piece
 *     uses hooks.
 *   - All callbacks go through the headless layer; this file
 *     never imports `file-next/server` or `file-next/sync` (those
 *     would pull server-only modules into the client bundle).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { useFileExplorer } from "@file-next/headless";
import type {
  FileNode,
  FileSystemError,
  Result,
  TenantId,
} from "file-next";
import { Breadcrumbs } from "./breadcrumbs";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { cn } from "@/lib/cn";
import { ExplorerListView, EXPLORER_DRAG_MIME } from "./explorer-list-view";
import { ExplorerGridView } from "./explorer-grid-view";
import { ExplorerToolbar } from "./explorer-toolbar";
import { ExplorerContextMenu } from "./explorer-context-menu";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExplorerColumn = "name" | "size" | "modified" | "kind";
export type SortDirection = "asc" | "desc";

/**
 * Server-action callbacks. The shape mirrors
 * `useFileActions["actions"]` so consumers can reuse the same
 * callbacks across components.
 */
export interface FileExplorerActions {
  readonly deleteFile: (input: { id: string }) => Promise<unknown>;
  readonly moveFile: (input: { id: string; newParentId: string | null; newName?: string }) => Promise<unknown>;
  readonly copyFile: (input: { id: string; newParentId: string | null; newName?: string }) => Promise<unknown>;
  readonly renameFile: (id: string, newName: string) => Promise<void>;
  readonly restoreNode?: (input: { id: string }) => Promise<unknown>;
}

type OverlayQuery = (
  input: { query?: string },
) => Promise<Result<{ items: ReadonlyArray<FileNode> }, FileSystemError>>;

export interface FileExplorerProps {
  /** Tenant scope. */
  readonly tenantId: TenantId | string;
  /** Current folder (null = root). */
  readonly parentId: string | null;
  /**
   * Injected callback that fetches the file list for a folder.
   * Typically wraps the `listFilesAction` server action.
   */
  readonly listFiles: Parameters<typeof useFileExplorer>[0]["listFiles"];
  /** Server-action callbacks. */
  readonly actions: FileExplorerActions;
  /** Optional breadcrumb segments (root + trail). */
  readonly breadcrumbs?: ReadonlyArray<{ id: string; name: string }>;
  /** Called when the user clicks a breadcrumb segment. */
  readonly onBreadcrumbNavigate?: (seg: { id: string; name: string }) => void;
  /** Initial view mode. Default: "list". */
  readonly initialView?: "list" | "grid";
  /** Columns to show in list view. Default: all four. */
  readonly columns?: ReadonlyArray<ExplorerColumn>;
  /** Auto-fetch on mount. Default: true. */
  readonly autoFetch?: boolean;
  /** Called when a file is activated (double-click / Enter). */
  readonly onActivate?: (file: FileNode) => void;
  /** Called when a folder is activated (double-click / Enter). */
  readonly onOpenFolder?: (folder: FileNode) => void;
  /** Called when the user invokes "Open in new tab" on a file. */
  readonly onOpenInNewTab?: (file: FileNode) => Promise<void> | void;
  /** Called when files are dropped onto a folder. */
  readonly searchFiles?: OverlayQuery;
  readonly listTrash?: OverlayQuery;
  readonly onMove?: (input: {
    itemIds: ReadonlyArray<string>;
    destinationFolderId: string;
  }) => Promise<void> | void;
  /** Optional refetch trigger — incremented externally to force re-fetch. */
  readonly refreshKey?: number;
  /** Optional className for the outer wrapper. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

const compareFiles = (
  a: FileNode,
  b: FileNode,
  key: ExplorerColumn,
  dir: SortDirection,
): number => {
  // Folders always come first, regardless of sort direction —
  // mirrors Finder / Explorer behavior.
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  let cmp = 0;
  switch (key) {
    case "name":
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      break;
    case "size":
      cmp = a.size - b.size;
      break;
    case "modified":
      cmp = a.updatedAt.getTime() - b.updatedAt.getTime();
      break;
    case "kind":
      cmp = a.kind.localeCompare(b.kind);
      break;
  }
  return dir === "asc" ? cmp : -cmp;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileExplorer(props: FileExplorerProps): React.ReactElement {
  const {
    tenantId,
    parentId,
    listFiles,
    actions,
    breadcrumbs,
    onBreadcrumbNavigate,
    initialView = "list",
    columns,
    autoFetch = true,
    onActivate,
    onOpenFolder,
    onOpenInNewTab,
    searchFiles,
    listTrash,
    onMove = () => undefined,
    refreshKey,
    className,
  } = props;

  const explorer = useFileExplorer({
    listFiles,
    tenantId: tenantId as TenantId,
    parentId,
    initialView,
    autoFetch,
    onMove,
    onActivate: (file) => {
      if (file.kind === "folder" && onOpenFolder) onOpenFolder(file);
      else if (onActivate) onActivate(file);
    },
  });

  // Local sort state — kept here, not in the hook, because it's
  // presentation-only.
  const [query, setQuery] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [overlayFiles, setOverlayFiles] = useState<ReadonlyArray<FileNode> | null>(
    null,
  );
  const [overlayError, setOverlayError] = useState<FileSystemError | null>(null);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [sortKey, setSortKey] = useState<ExplorerColumn>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const handleSortChange = useCallback(
    (key: ExplorerColumn) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const loadOverlay = useCallback(async () => {
    if (trashOpen && listTrash) {
      setOverlayLoading(true);
      const result = await listTrash({});
      setOverlayLoading(false);
      if (result.ok) {
        setOverlayFiles(result.value.items);
        setOverlayError(null);
      } else {
        setOverlayError(result.error);
      }
      return;
    }
    const trimmed = query.trim();
    if (trimmed && searchFiles) {
      setOverlayLoading(true);
      const result = await searchFiles({ query: trimmed });
      setOverlayLoading(false);
      if (result.ok) {
        setOverlayFiles(result.value.items);
        setOverlayError(null);
      } else {
        setOverlayError(result.error);
      }
      return;
    }
    setOverlayFiles(null);
    setOverlayError(null);
    setOverlayLoading(false);
  }, [listTrash, query, searchFiles, trashOpen]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadOverlay();
    }, trashOpen ? 0 : 250);
    return () => window.clearTimeout(handle);
  }, [loadOverlay, trashOpen]);

  const sourceFiles = overlayFiles ?? explorer.files;
  const sortedFiles = useMemo(
    () =>
      [...sourceFiles].sort((a, b) => compareFiles(a, b, sortKey, sortDir)),
    [sourceFiles, sortKey, sortDir],
  );

  // External refresh trigger: when refreshKey changes, refetch.
  // Use useEffect (not useMemo) — useMemo shouldn't have side effects.
  const lastRefreshKey = explorer.files.length; // just a stable dep
  useEffect(() => {
    if (refreshKey === undefined) return;
    void explorer.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Drop handler on the wrapper itself — used to drop files into
  // the current folder (vs dropping on a specific folder row, which
  // the views handle themselves).
  const onDropToCurrentFolder = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Browser file drop (upload) — handled by the consumer's
      // own dropzone. We only handle internal drops here.
      const draggedId = e.dataTransfer.getData(EXPLORER_DRAG_MIME);
      if (!draggedId) return;
      e.preventDefault();
      // Drop target was set on a row; the view's onDrop already
      // called endDrag. Nothing else to do here — the orchestrator
      // just needs to make sure the dropEffect is honored.
    },
    [],
  );

  // Shared handlers for the views.
  const handleContextMenu = useCallback(
    (file: FileNode) => {
      explorer.setSelected(file.id);
      explorer.openContextMenu(file);
    },
    [explorer],
  );

  // Sort-aware activation: when a folder is double-clicked, we
  // call onOpenFolder. The hook's onActivate also fires; we
  // already routed that in the useFileExplorer options above.
  const handleActivate = useCallback(
    (file: FileNode) => {
      if (file.kind === "folder" && onOpenFolder) {
        onOpenFolder(file);
      } else if (file.kind === "file") {
        // For files, double-click = download via "open in new tab"
        // (which is what Finder/Explorer do — they preview/open).
        if (onOpenInNewTab) void onOpenInNewTab(file);
        else if (onActivate) onActivate(file);
      }
    },
    [onOpenFolder, onOpenInNewTab, onActivate],
  );

  // Default columns.
  const viewColumns = columns ?? ["name", "size", "modified", "kind"];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && onBreadcrumbNavigate ? (
        <Breadcrumbs
          segments={breadcrumbs}
          onNavigate={onBreadcrumbNavigate}
        />
      ) : null}

      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-3"
        onDragOver={(e) => {
          if (explorer.draggingId) e.preventDefault();
        }}
        onDrop={onDropToCurrentFolder}
      >
        <span className="text-sm text-muted-foreground">
          {sortedFiles.length} item{sortedFiles.length === 1 ? "" : "s"}
          {trashOpen ? " in trash" : ""}
        </span>
        <ExplorerToolbar
          view={explorer.view}
          onViewChange={explorer.setView}
          query={query}
          onQueryChange={
            searchFiles
              ? (next) => {
                  setTrashOpen(false);
                  setQuery(next);
                }
              : undefined
          }
          trashOpen={trashOpen}
          onTrashToggle={
            listTrash
              ? () => {
                  setQuery("");
                  setTrashOpen((open) => !open);
                }
              : undefined
          }
        />
      </div>

      {/* Body */}
      {(overlayLoading || explorer.status === "loading") &&
      sortedFiles.length === 0 ? (
        <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : overlayError || (explorer.status === "error" && explorer.error) ? (
        <ErrorState error={overlayError ?? explorer.error!} />
      ) : explorer.status === "success" && sortedFiles.length === 0 ? (
        <EmptyState
          title={trashOpen ? "Trash is empty" : query.trim() ? "No matches" : "Empty folder"}
          description={
            trashOpen
              ? "Deleted files will show up here."
              : query.trim()
                ? "Try another name."
                : "Drop files here or use the New Folder button to get started."
          }
        />
      ) : explorer.view === "list" ? (
        <ExplorerListView
          files={sortedFiles}
          selectedId={explorer.selectedId}
          onSelect={explorer.setSelected}
          onActivate={handleActivate}
          onContextMenu={handleContextMenu}
          onDragStart={explorer.beginDrag}
          onDragEnd={explorer.endDrag}
          onDrop={explorer.commitDrop}
          draggingId={explorer.draggingId}
          dropTargetId={explorer.dropTargetId}
          onDragOverRow={explorer.setDropTarget}
          columns={viewColumns}
          sortKey={sortKey}
          sortDirection={sortDir}
          onSortChange={handleSortChange}
        />
      ) : (
        <ExplorerGridView
          files={sortedFiles}
          selectedId={explorer.selectedId}
          onSelect={explorer.setSelected}
          onActivate={handleActivate}
          onContextMenu={handleContextMenu}
          onDragStart={explorer.beginDrag}
          onDragEnd={explorer.endDrag}
          onDrop={explorer.commitDrop}
          draggingId={explorer.draggingId}
          dropTargetId={explorer.dropTargetId}
          onDragOverRow={explorer.setDropTarget}
        />
      )}

      {/* Context menu — rendered at the bottom but portaled
          (positioned at the cursor via Radix). Wires the same
          actions as the row-level FileActions, but also picks up
          the contextTarget from the hook. */}
      {explorer.contextTarget ? (
        <ExplorerContextMenu
          file={explorer.contextTarget}
          mode={trashOpen ? "trash" : "browse"}
          actions={{
            ...actions,
            restoreNode: actions.restoreNode
              ? async (input) => {
                  await actions.restoreNode?.(input);
                  await loadOverlay();
                  await explorer.refetch();
                }
              : undefined,
          }}
          onOpen={handleActivate}
          onOpenInNewTab={
            onOpenInNewTab
              ? (f) => {
                  void onOpenInNewTab(f);
                }
              : undefined
          }
          currentFolderId={parentId}
        >
          {/* Placeholder trigger — Radix handles positioning via
              the trigger's onContextMenu. We don't render a
              visible element; the menu is opened programmatically
              from the views. This is a workaround for Radix
              requiring a trigger element. In v2 we'll wire a
              proper onContextMenuItem handler. */}
          <span className="hidden" />
        </ExplorerContextMenu>
      ) : null}
    </div>
  );
}
