"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useFileExplorer } from "@vryzel/file-next-headless";
import type { RequestUploadResult } from "@vryzel/file-next-headless";
import type { TenantId as BrandedTenantId } from "@vryzel/file-next";
import type { FileNode, FileSystemError, Result } from "./types";
import { Breadcrumbs } from "./breadcrumbs";
import { ExplorerListView, type ExplorerColumn, type SortDirection } from "./explorer-list-view";
import { ExplorerGridView } from "./explorer-grid-view";
import { ExplorerToolbar } from "./explorer-toolbar";
import { ExplorerContextMenu, type ExplorerContextTarget } from "./explorer-context-menu";
import { CreateFolderDialog } from "./create-folder-dialog";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { ExplorerClipboardToast, ExplorerSelectionToast } from "./explorer-selection-toast";
import { UploadQueueProvider, useUploadEnqueue } from "./upload-queue";
import { ExplorerLabelsProvider, useExplorerLabels, type ExplorerLabels } from "./labels";
import { cn } from "./cn";
import { absoluteShareUrl } from "./share-url";

export type { ExplorerColumn, SortDirection };

export interface FileExplorerActions {
  readonly deleteFile: (input: { id: string }) => Promise<unknown>;
  readonly moveFile: (input: {
    id: string;
    newParentId: string | null;
    newName?: string;
  }) => Promise<unknown>;
  readonly copyFile: (input: {
    id: string;
    newParentId: string | null;
    newName?: string;
  }) => Promise<unknown>;
  readonly renameFile: (id: string, newName: string) => Promise<void>;
  readonly restoreNode?: (input: { id: string }) => Promise<unknown>;
  readonly purgeNode?: (input: { id: string }) => Promise<unknown>;
  /** Return the openable URL to copy (presigned GET). */
  readonly createShare?: (input: { id: string }) => Promise<string>;
  readonly createFolder?: (input: {
    name: string;
    parentId: string | null;
  }) => Promise<unknown>;
}

const PAGE_SIZE = 50;

type ListPageResult = Result<
  { items: ReadonlyArray<FileNode>; nextCursor?: string },
  FileSystemError
>;

type OverlayQuery = (input: {
  query?: string;
  cursor?: string;
  limit?: number;
  trash?: boolean;
}) => Promise<ListPageResult>;

export interface FileExplorerProps {
  readonly tenantId: string;
  readonly parentId: string | null;
  readonly listFiles: (input: {
    parentId: string | null;
    cursor?: string;
    limit?: number;
  }) => Promise<ListPageResult>;
  readonly actions: FileExplorerActions;
  readonly breadcrumbs?: ReadonlyArray<{ id: string; name: string }>;
  readonly onBreadcrumbNavigate?: (seg: { id: string; name: string }) => void;
  readonly initialView?: "list" | "grid";
  readonly autoFetch?: boolean;
  readonly onActivate?: (file: FileNode) => void;
  readonly onOpenFolder?: (folder: FileNode) => void;
  readonly searchFiles?: OverlayQuery;
  readonly listTrash?: OverlayQuery;
  readonly requestUpload?: (file: {
    name: string;
    size: number;
    type: string;
    content: Blob;
    parentId: string | null;
  }) => Promise<RequestUploadResult>;
  readonly confirmUpload?: () => Promise<void> | void;
  readonly usedBytes?: number;
  readonly quotaBytes?: number;
  readonly onMove?: (input: {
    itemIds: ReadonlyArray<string>;
    destinationFolderId: string;
  }) => Promise<void> | void;
  readonly refreshKey?: number;
  readonly className?: string;
  readonly persistViewKey?: string;
  readonly onPreview?: (file: FileNode) => void;
  readonly onDownload?: (file: FileNode) => void;
  readonly extraFileAction?: { label: string; onSelect: (file: FileNode) => void };
  readonly protectedIds?: ReadonlyArray<string>;
  readonly labels?: Partial<ExplorerLabels>;
}

type ExplorerPrefs = {
  view: "list" | "grid";
  sortKey: ExplorerColumn;
  sortDir: SortDirection;
};

const DEFAULT_PREFS: ExplorerPrefs = { view: "list", sortKey: "name", sortDir: "asc" };

function reviveFile(node: FileNode): FileNode {
  const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));
  return {
    ...node,
    createdAt: asDate(node.createdAt),
    updatedAt: asDate(node.updatedAt),
    deletedAt: node.deletedAt ? asDate(node.deletedAt) : null,
  };
}

function readPrefs(key: string): ExplorerPrefs {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_PREFS;
    if (raw === "list" || raw === "grid") return { ...DEFAULT_PREFS, view: raw };
    const parsed = JSON.parse(raw) as Partial<ExplorerPrefs>;
    const view = parsed.view === "grid" ? "grid" : "list";
    const sortKey: ExplorerColumn =
      parsed.sortKey === "size" || parsed.sortKey === "modified" || parsed.sortKey === "kind"
        ? parsed.sortKey
        : "name";
    const sortDir: SortDirection = parsed.sortDir === "desc" ? "desc" : "asc";
    return { view, sortKey, sortDir };
  } catch {
    return DEFAULT_PREFS;
  }
}

const compareFiles = (
  a: FileNode,
  b: FileNode,
  key: ExplorerColumn,
  dir: SortDirection,
): number => {
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

function formatExplorerBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileExplorer(props: FileExplorerProps): React.ReactElement {
  const outerEnqueue = useUploadEnqueue();
  const tree = (
    <ExplorerLabelsProvider labels={props.labels}>
      <FileExplorerInner {...props} />
    </ExplorerLabelsProvider>
  );
  if (props.requestUpload && !outerEnqueue) {
    return (
      <UploadQueueProvider
        requestUpload={props.requestUpload}
        confirmUpload={
          props.confirmUpload
            ? async () => {
                await props.confirmUpload?.();
              }
            : undefined
        }
      >
        {tree}
      </UploadQueueProvider>
    );
  }
  return tree;
}

function FileExplorerInner(props: FileExplorerProps): React.ReactElement {
  const {
    tenantId,
    parentId,
    listFiles,
    actions,
    breadcrumbs,
    onBreadcrumbNavigate,
    initialView = "list",
    onActivate,
    onOpenFolder,
    searchFiles,
    listTrash,
    requestUpload,
    confirmUpload,
    usedBytes,
    quotaBytes,
    onMove = () => undefined,
    refreshKey,
    className,
    persistViewKey,
    onPreview,
    onDownload,
    extraFileAction,
    protectedIds,
  } = props;
  const labels = useExplorerLabels();
  const protectedSet = useMemo(() => new Set(protectedIds ?? []), [protectedIds]);

  const explorer = useFileExplorer({
    listFiles: ((input: { parentId: string | null }) =>
      listFiles({ parentId: input.parentId, limit: PAGE_SIZE })) as never,
    tenantId: tenantId as BrandedTenantId,
    parentId,
    initialView,
    autoFetch: false,
    onMove,
  });

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [pageItems, setPageItems] = useState<ReadonlyArray<FileNode>>([]);
  const [pageStatus, setPageStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [pageError, setPageError] = useState<FileSystemError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [overlayHasMore, setOverlayHasMore] = useState(false);
  const browseCursor = useRef<string | undefined>(undefined);
  const overlayCursor = useRef<string | undefined>(undefined);
  const loadingMoreRef = useRef(false);
  const overlayMoreRef = useRef(false);
  const browseGen = useRef(0);
  const [overlayFiles, setOverlayFiles] = useState<ReadonlyArray<FileNode> | null>(null);
  const [overlayError, setOverlayError] = useState<FileSystemError | null>(null);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [overlayMore, setOverlayMore] = useState(false);
  const [sortKey, setSortKey] = useState<ExplorerColumn>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [prefsReady, setPrefsReady] = useState(!persistViewKey);
  const skipPrefsWrite = useRef(!persistViewKey);
  const [menu, setMenu] = useState<ExplorerContextTarget | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileNode | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ReadonlyArray<FileNode>>([]);
  const [purgeTargets, setPurgeTargets] = useState<ReadonlyArray<FileNode>>([]);
  const [trashHasItems, setTrashHasItems] = useState(false);
  const [clipboard, setClipboard] = useState<ReadonlyArray<FileNode>>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchorId = useRef<string | null>(null);

  useEffect(() => {
    if (!persistViewKey) return;
    const prefs = readPrefs(persistViewKey);
    explorer.setView(prefs.view);
    setSortKey(prefs.sortKey);
    setSortDir(prefs.sortDir);
    skipPrefsWrite.current = true;
    setPrefsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistViewKey]);

  useEffect(() => {
    if (!persistViewKey || !prefsReady) return;
    if (skipPrefsWrite.current) {
      skipPrefsWrite.current = false;
      return;
    }
    window.localStorage.setItem(
      persistViewKey,
      JSON.stringify({ view: explorer.view, sortKey, sortDir } satisfies ExplorerPrefs),
    );
  }, [explorer.view, persistViewKey, prefsReady, sortDir, sortKey]);

  const handleSortChange = useCallback(
    (key: ExplorerColumn) => {
      if (key === sortKey) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDir(key === "modified" ? "desc" : "asc");
    },
    [sortKey],
  );

  const loadBrowse = useCallback(
    async (mode: "reset" | "more") => {
      const gen = mode === "reset" ? ++browseGen.current : browseGen.current;
      if (mode === "more") {
        if (!browseCursor.current || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setPageStatus("loading");
        browseCursor.current = undefined;
        setBrowseHasMore(false);
      }
      const result = await listFiles({
        parentId,
        limit: PAGE_SIZE,
        cursor: mode === "more" ? browseCursor.current : undefined,
      });
      if (gen !== browseGen.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        return;
      }
      if (result.ok) {
        browseCursor.current = result.value.nextCursor;
        setBrowseHasMore(Boolean(result.value.nextCursor));
        const items = result.value.items.map(reviveFile);
        setPageItems((current) => (mode === "more" ? [...current, ...items] : items));
        setPageError(null);
        setPageStatus("success");
      } else if (mode === "reset") {
        setPageItems([]);
        setPageError(result.error);
        setPageStatus("error");
      }
      loadingMoreRef.current = false;
      setLoadingMore(false);
    },
    [listFiles, parentId],
  );

  const loadOverlay = useCallback(
    async (mode: "reset" | "more" = "reset") => {
      if (trashOpen && listTrash) {
        const trimmed = query.trim();
        if (trimmed && searchFiles) {
          setOverlayLoading(true);
          const result = await searchFiles({ query: trimmed, limit: PAGE_SIZE, trash: true });
          setOverlayLoading(false);
          if (result.ok) {
            setOverlayFiles(result.value.items.map(reviveFile));
            setOverlayError(null);
          } else setOverlayError(result.error);
          return;
        }
        if (mode === "more") {
          if (!overlayCursor.current || overlayMoreRef.current) return;
          overlayMoreRef.current = true;
          setOverlayMore(true);
        } else {
          setOverlayLoading(true);
          overlayCursor.current = undefined;
          setOverlayHasMore(false);
        }
        const result = await listTrash({
          limit: PAGE_SIZE,
          cursor: mode === "more" ? overlayCursor.current : undefined,
        });
        if (result.ok) {
          overlayCursor.current = result.value.nextCursor;
          setOverlayHasMore(Boolean(result.value.nextCursor));
          const items = result.value.items.map(reviveFile);
          setOverlayFiles((current) => (mode === "more" && current ? [...current, ...items] : items));
          setOverlayError(null);
        } else if (mode === "reset") setOverlayError(result.error);
        overlayMoreRef.current = false;
        setOverlayLoading(false);
        setOverlayMore(false);
        return;
      }
      const trimmed = query.trim();
      if (trimmed && searchFiles) {
        setOverlayLoading(true);
        const result = await searchFiles({ query: trimmed, limit: PAGE_SIZE });
        setOverlayLoading(false);
        if (result.ok) {
          setOverlayFiles(result.value.items.map(reviveFile));
          setOverlayError(null);
        } else setOverlayError(result.error);
        return;
      }
      overlayCursor.current = undefined;
      setOverlayHasMore(false);
      setOverlayFiles(null);
      setOverlayError(null);
      setOverlayLoading(false);
    },
    [listTrash, query, searchFiles, trashOpen],
  );

  const refreshTrashFlag = useCallback(async () => {
    if (!listTrash) {
      setTrashHasItems(false);
      return;
    }
    const result = await listTrash({ limit: 1 });
    setTrashHasItems(result.ok && result.value.items.length > 0);
  }, [listTrash]);

  const reload = useCallback(async () => {
    await loadBrowse("reset");
    await loadOverlay("reset");
    await refreshTrashFlag();
  }, [loadBrowse, loadOverlay, refreshTrashFlag]);

  const enqueueUploads = useUploadEnqueue();

  useEffect(() => {
    const onUploaded = () => {
      void reload();
      void confirmUpload?.();
    };
    window.addEventListener("file-next-uploaded", onUploaded);
    return () => window.removeEventListener("file-next-uploaded", onUploaded);
  }, [confirmUpload, reload]);

  useEffect(() => {
    void loadBrowse("reset");
  }, [loadBrowse]);

  useEffect(() => {
    void refreshTrashFlag();
  }, [refreshTrashFlag]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadOverlay("reset");
    }, trashOpen ? 0 : 250);
    return () => window.clearTimeout(handle);
  }, [loadOverlay, trashOpen]);

  const sourceFiles = overlayFiles ?? pageItems;
  const hasMore = overlayFiles ? overlayHasMore : browseHasMore;
  const sortedFiles = useMemo(
    () => [...sourceFiles].sort((a, b) => compareFiles(a, b, sortKey, sortDir)),
    [sourceFiles, sortKey, sortDir],
  );

  useEffect(() => {
    if (refreshKey === undefined) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleActivate = useCallback(
    (file: FileNode) => {
      if (file.kind === "folder") {
        onOpenFolder?.(file);
        return;
      }
      if (onPreview) onPreview(file);
      else if (onDownload) onDownload(file);
      else onActivate?.(file);
    },
    [onActivate, onDownload, onOpenFolder, onPreview],
  );

  const handleContextMenu = useCallback((file: FileNode, event: React.MouseEvent) => {
    setMenu({ kind: "item", file, x: event.clientX, y: event.clientY });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    anchorId.current = null;
  }, []);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, parentId, trashOpen]);

  const handleSelect = useCallback(
    (file: FileNode, event: { shiftKey: boolean }) => {
      const id = file.id;
      if (event.shiftKey && anchorId.current) {
        const from = sortedFiles.findIndex((item) => item.id === anchorId.current);
        const to = sortedFiles.findIndex((item) => item.id === id);
        if (from >= 0 && to >= 0) {
          const start = Math.min(from, to);
          const end = Math.max(from, to);
          setSelectedIds(new Set(sortedFiles.slice(start, end + 1).map((item) => item.id)));
          return;
        }
      }
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorId.current = id;
    },
    [sortedFiles],
  );

  const selectedFiles = useMemo(
    () => sortedFiles.filter((file) => selectedIds.has(file.id)),
    [selectedIds, sortedFiles],
  );
  const selected = selectedFiles.length === 1 ? selectedFiles[0] : undefined;
  const draggingIds = useMemo(() => {
    const id = explorer.draggingId;
    if (!id) return new Set<string>();
    if (selectedIds.has(id)) return selectedIds;
    return new Set([id]);
  }, [explorer.draggingId, selectedIds]);

  const handleDropOnFolder = useCallback(
    (destinationFolderId: string) => {
      const ids = [...draggingIds].filter((id) => id !== destinationFolderId);
      explorer.endDrag();
      if (ids.length === 0) return;
      void Promise.resolve(onMove({ itemIds: ids, destinationFolderId })).then(clearSelection);
    },
    [clearSelection, draggingIds, explorer, onMove],
  );

  const copyToClipboard = useCallback(
    (files: ReadonlyArray<FileNode>) => {
      if (files.length === 0) return;
      setClipboard(files);
      clearSelection();
    },
    [clearSelection],
  );

  const pasteClipboard = useCallback(
    async (destinationId: string | null = parentId) => {
      if (clipboard.length === 0 || trashOpen) return;
      for (const node of clipboard) {
        if (node.id === destinationId) continue;
        await actions.copyFile({ id: node.id, newParentId: destinationId, newName: node.name });
      }
      setClipboard([]);
      await reload();
    },
    [actions, clipboard, parentId, reload, trashOpen],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      const index = sortedFiles.findIndex((file) => file.id === (anchorId.current ?? selected?.id));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(new Set(sortedFiles.map((file) => file.id)));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        if (selectedFiles.length === 0 || trashOpen) return;
        event.preventDefault();
        copyToClipboard(selectedFiles);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        if (clipboard.length === 0 || trashOpen) return;
        event.preventDefault();
        void pasteClipboard();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(sortedFiles.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
        const next = sortedFiles[nextIndex];
        if (!next) return;
        if (event.shiftKey && anchorId.current) {
          const from = sortedFiles.findIndex((item) => item.id === anchorId.current);
          const start = Math.min(from, nextIndex);
          const end = Math.max(from, nextIndex);
          setSelectedIds(new Set(sortedFiles.slice(start, end + 1).map((item) => item.id)));
        } else {
          setSelectedIds(new Set([next.id]));
          anchorId.current = next.id;
        }
        return;
      }
      if (event.key === "Enter" && selected) {
        event.preventDefault();
        handleActivate(selected);
        return;
      }
      if (event.key === "F2" && selected && !trashOpen) {
        event.preventDefault();
        setRenameTarget(selected);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedFiles.length > 0) {
        event.preventDefault();
        if (trashOpen) {
          if (actions.purgeNode) setPurgeTargets(selectedFiles);
          return;
        }
        if (selectedFiles.some((file) => protectedSet.has(file.id))) return;
        setDeleteTargets(selectedFiles);
        return;
      }
      if (event.key === "Escape") {
        setMenu(null);
        clearSelection();
      }
    },
    [
      clipboard.length,
      clearSelection,
      copyToClipboard,
      handleActivate,
      pasteClipboard,
      protectedSet,
      selected,
      selectedFiles,
      sortedFiles,
      trashOpen,
    ],
  );

  const commitRename = (name: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setRenameTarget(null);
    void actions.renameFile(target.id, name).then(() => reload());
  };

  const openUpload = () => uploadInputRef.current?.click();

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        if (!requestUpload || trashOpen) return;
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!requestUpload || trashOpen) return;
        const files = event.dataTransfer.files;
        if (!files.length) return;
        event.preventDefault();
        enqueueUploads?.(Array.from(files), parentId);
      }}
      onContextMenu={(event) => {
        if (trashOpen) return;
        if ((event.target as HTMLElement).closest("[data-file-id]")) return;
        event.preventDefault();
        setMenu({ kind: "blank", x: event.clientX, y: event.clientY });
      }}
    >
      {breadcrumbs && onBreadcrumbNavigate ? (
        <div className="border-b border-border px-4 py-3">
          <Breadcrumbs segments={breadcrumbs} onNavigate={onBreadcrumbNavigate} />
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        {requestUpload ? (
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = event.target.files;
              if (!files || files.length === 0) return;
              enqueueUploads?.(Array.from(files), parentId);
              event.target.value = "";
            }}
          />
        ) : null}
        <ExplorerToolbar
          className="min-w-0 flex-1"
          view={explorer.view}
          onViewChange={explorer.setView}
          onUpload={requestUpload && !trashOpen ? openUpload : undefined}
          onNewFolder={actions.createFolder && !trashOpen ? () => setFolderOpen(true) : undefined}
          query={query}
          onQueryChange={searchFiles ? setQuery : undefined}
          trashOpen={trashOpen}
          trashHasItems={trashHasItems}
          onTrashToggle={
            listTrash
              ? () => {
                  setQuery("");
                  setTrashOpen((open) => !open);
                }
              : undefined
          }
          sortKey={sortKey}
          sortDirection={sortDir}
          onSortChange={handleSortChange}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {(overlayLoading || pageStatus === "loading") && sortedFiles.length === 0 ? (
          <p className="px-4 py-12 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {labels.loading}
          </p>
        ) : overlayError || (pageStatus === "error" && pageError) ? (
          <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {(overlayError ?? pageError)?.message ?? labels.folderCreateFailed}
          </div>
        ) : sortedFiles.length === 0 ? (
          <div className="flex min-h-full flex-col justify-center px-4 py-16 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {trashOpen ? labels.emptyTrash : query.trim() ? labels.noMatches : labels.emptyFolder}
            </p>
            {trashOpen ? (
              <p className="mt-2 text-sm text-muted-foreground">{labels.trashRetention}</p>
            ) : !query.trim() ? (
              <p className="mt-2 text-sm text-muted-foreground">{labels.dropHint}</p>
            ) : null}
          </div>
        ) : explorer.view === "list" ? (
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("[data-file-id]")) return;
              clearSelection();
            }}
          >
            <ExplorerListView
              files={sortedFiles}
              protectedIds={protectedSet}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onActivate={handleActivate}
              onContextMenu={handleContextMenu}
              onDragStart={explorer.beginDrag}
              onDragEnd={explorer.endDrag}
              onDrop={handleDropOnFolder}
              draggingId={explorer.draggingId}
              draggingIds={draggingIds}
              dropTargetId={explorer.dropTargetId}
              onDragOverRow={explorer.setDropTarget}
              sortKey={sortKey}
              sortDirection={sortDir}
              onSortChange={handleSortChange}
              renamingId={renameTarget?.id ?? null}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenameTarget(null)}
            />
          </div>
        ) : (
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("[data-file-id]")) return;
              clearSelection();
            }}
          >
            <ExplorerGridView
              files={sortedFiles}
              protectedIds={protectedSet}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onActivate={handleActivate}
              onContextMenu={handleContextMenu}
              onDragStart={explorer.beginDrag}
              onDragEnd={explorer.endDrag}
              onDrop={handleDropOnFolder}
              draggingId={explorer.draggingId}
              draggingIds={draggingIds}
              dropTargetId={explorer.dropTargetId}
              onDragOverRow={explorer.setDropTarget}
              renamingId={renameTarget?.id ?? null}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenameTarget(null)}
            />
          </div>
        )}
      </div>

      {hasMore && sortedFiles.length > 0 ? (
        <div className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            disabled={loadingMore || overlayMore}
            onClick={() => {
              if (overlayFiles) void loadOverlay("more");
              else void loadBrowse("more");
            }}
            className="inline-flex h-8 w-full items-center justify-center rounded-[10px] border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {loadingMore || overlayMore ? labels.loading : labels.loadMore}
          </button>
        </div>
      ) : null}

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="text-primary tabular-nums">
            {sortedFiles.length}
            {hasMore ? "+" : ""}
          </span>
          {trashOpen ? ` ${labels.inTrash}` : ` ${labels.items}`}
        </span>
        {quotaBytes != null ? (
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:inline">
            {formatExplorerBytes(usedBytes ?? 0)} / {formatExplorerBytes(quotaBytes)}
          </span>
        ) : null}
      </footer>

      <ExplorerContextMenu
        target={menu}
        mode={trashOpen ? "trash" : "browse"}
        protectedItem={menu?.kind === "item" ? protectedSet.has(menu.file.id) : false}
        extraFileAction={extraFileAction}
        actions={{
          deleteFile: async (input) => {
            await actions.deleteFile(input);
            clearSelection();
            await reload();
          },
          renameFile: actions.renameFile,
          restoreNode: actions.restoreNode
            ? async (input) => {
                await actions.restoreNode?.(input);
                await reload();
              }
            : undefined,
          purgeNode: actions.purgeNode
            ? async (input) => {
                await actions.purgeNode?.(input);
                await reload();
              }
            : undefined,
          createShare: actions.createShare,
        }}
        onClose={() => setMenu(null)}
        onPreview={onPreview}
        onDownload={onDownload}
        onRename={setRenameTarget}
        onRequestDelete={(file) => setDeleteTargets([file])}
        onRequestPurge={
          actions.purgeNode ? (file) => setPurgeTargets([file]) : undefined
        }
        onCopy={(file) => copyToClipboard([file])}
        onPaste={
          clipboard.length > 0 && !trashOpen
            ? (folder) => void pasteClipboard(folder ? folder.id : parentId)
            : undefined
        }
        onNewFolder={actions.createFolder ? () => setFolderOpen(true) : undefined}
        onUpload={requestUpload ? openUpload : undefined}
      />

      <ExplorerSelectionToast
        files={selectedFiles}
        protectedIds={protectedSet}
        trashOpen={trashOpen}
        onDownload={onDownload}
        onCopy={trashOpen ? undefined : () => copyToClipboard(selectedFiles)}
        onShare={
          actions.createShare
            ? async () => {
                const tokens: string[] = [];
                for (const file of selectedFiles) {
                  if (file.kind !== "file") continue;
                  tokens.push(await actions.createShare!({ id: file.id }));
                }
                if (tokens.length > 0) {
                  await navigator.clipboard.writeText(
                    tokens.map(absoluteShareUrl).join("\n"),
                  );
                }
              }
            : undefined
        }
        onDelete={() => setDeleteTargets(selectedFiles)}
        onRestore={
          actions.restoreNode
            ? async () => {
                for (const file of selectedFiles) await actions.restoreNode?.({ id: file.id });
                clearSelection();
                await reload();
              }
            : undefined
        }
        onPurge={
          actions.purgeNode ? () => setPurgeTargets(selectedFiles) : undefined
        }
        onClear={clearSelection}
      />
      <div className="fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))]">
        <ExplorerClipboardToast
          count={clipboard.length}
          onPaste={() => void pasteClipboard()}
          onClear={() => setClipboard([])}
        />
      </div>

      <CreateFolderDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        onCreate={async (name) => {
          await actions.createFolder?.({ name, parentId });
          await reload();
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTargets.length > 0}
        names={deleteTargets.map((file) => file.name)}
        onOpenChange={(open) => {
          if (!open) setDeleteTargets([]);
        }}
        onConfirm={async () => {
          for (const file of deleteTargets) await actions.deleteFile({ id: file.id });
          setDeleteTargets([]);
          clearSelection();
          await reload();
        }}
      />
      <ConfirmDeleteDialog
        open={purgeTargets.length > 0}
        names={purgeTargets.map((file) => file.name)}
        permanent
        onOpenChange={(open) => {
          if (!open) setPurgeTargets([]);
        }}
        onConfirm={async () => {
          for (const file of purgeTargets) await actions.purgeNode?.({ id: file.id });
          setPurgeTargets([]);
          clearSelection();
          await reload();
        }}
      />
    </div>
  );
}
