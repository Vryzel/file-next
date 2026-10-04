"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link2, MoreHorizontal } from "lucide-react";
import { cn } from "./cn";
import { FileIcon } from "./file-icon";
import { EXPLORER_DRAG_MIME } from "./explorer-list-view";
import type { FileNode } from "./types";
import { useExplorerLabels } from "./labels";
import { RenameInput } from "./rename-input";
import { useCoarsePointer, useExplorerItemPointer } from "./use-explorer-item-pointer";
import { gridColumnCount, selectionEdgeIndex, useLoadMoreOnEnd } from "./virtual-window";

export interface ExplorerGridViewProps {
  readonly files: ReadonlyArray<FileNode>;
  readonly protectedIds?: ReadonlySet<string>;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelect: (file: FileNode, event: { shiftKey: boolean }) => void;
  readonly onActivate: (file: FileNode) => void;
  readonly onContextMenu?: (file: FileNode, event: React.MouseEvent) => void;
  readonly onDragStart: (id: string) => void;
  readonly onDragEnd: () => void;
  readonly onDrop: (destinationFolderId: string) => void;
  readonly draggingId: string | null;
  readonly draggingIds?: ReadonlySet<string>;
  readonly dropTargetId: string | null;
  readonly onDragOverRow: (id: string | null) => void;
  readonly renamingId?: string | null;
  readonly onRenameCommit?: (name: string) => void;
  readonly onRenameCancel?: () => void;
  readonly className?: string;
  readonly scrollRef?: RefObject<HTMLDivElement>;
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly onLoadMore?: () => void;
}

const GRID_PAD = 12; // ponytail: pt-3 at 16px root. Measure the spacer if the root font size changes.

export function ExplorerGridView(props: ExplorerGridViewProps): React.ReactElement {
  const {
    files,
    protectedIds,
    selectedIds,
    onSelect,
    onActivate,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDrop,
    draggingId,
    draggingIds,
    dropTargetId,
    onDragOverRow,
    renamingId,
    onRenameCommit,
    onRenameCancel,
    className,
    scrollRef: scrollRefProp,
    hasMore = false,
    loadingMore = false,
    onLoadMore,
  } = props;
  const labels = useExplorerLabels();
  const coarse = useCoarsePointer();
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollRefProp ?? ownScrollRef;
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  const columns = width != null && width > 0 ? gridColumnCount(width) : 6;
  const rowCount = Math.ceil(files.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 156,
    overscan: 4,
    gap: 6, // ponytail: gap-1.5 at 16px root
    scrollMargin: GRID_PAD,
    getItemKey: (index) => files[index * columns]?.id ?? index,
    initialRect: { width: 800, height: 600 },
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastRow = virtualRows.at(-1);
  useLoadMoreOnEnd({
    lastIndex: lastRow
      ? Math.min(files.length - 1, (lastRow.index + 1) * columns - 1)
      : undefined,
    loaded: files.length,
    hasMore,
    loading: loadingMore,
    onLoadMore,
  });

  const prevSelected = useRef(selectedIds);
  useEffect(() => {
    const itemIndex = renamingId
      ? files.findIndex((file) => file.id === renamingId)
      : selectionEdgeIndex(files, selectedIds, prevSelected.current);
    prevSelected.current = selectedIds;
    if (itemIndex < 0) return;
    virtualizer.scrollToIndex(Math.floor(itemIndex / columns), { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renamingId, selectedIds]);

  return (
    <div
      ref={scrollRefProp ? undefined : ownScrollRef}
      className={cn(!scrollRefProp && "min-h-0 flex-1 overflow-y-auto", className)}
    >
      <div role="list" className="pt-3">
        <div role="presentation" className="relative z-0 w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const start = virtualRow.index * columns;
            const rowFiles = files.slice(start, start + columns);
            return (
              <div
                key={virtualRow.key}
                role="presentation"
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 grid w-full gap-1.5 px-3"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                {rowFiles.map((file, offset) => (
                  <ExplorerGridItem
                    key={file.id}
                    file={file}
                    idx={start + offset}
                    selected={selectedIds.has(file.id)}
                    dragging={draggingIds?.has(file.id) ?? file.id === draggingId}
                    dropTarget={file.id === dropTargetId && file.kind === "folder"}
                    isProtected={protectedIds?.has(file.id) ?? false}
                    draggingId={draggingId}
                    dropTargetId={dropTargetId}
                    coarse={coarse}
                    folderLabel={labels.folder}
                    inUseLabel={labels.inUse}
                    actionsLabel={labels.itemActions}
                    onSelect={onSelect}
                    onActivate={onActivate}
                    onContextMenu={onContextMenu}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onDrop={onDrop}
                    onDragOverRow={onDragOverRow}
                    renaming={file.id === renamingId}
                    onRenameCommit={onRenameCommit}
                    onRenameCancel={onRenameCancel}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <div className="h-3" />
      </div>
      {loadingMore ? (
        <p className="px-4 py-3 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {labels.loading}
        </p>
      ) : null}
    </div>
  );
}

function ExplorerGridItem({
  file,
  idx,
  selected,
  dragging,
  dropTarget,
  isProtected,
  draggingId,
  dropTargetId,
  coarse,
  folderLabel,
  inUseLabel,
  actionsLabel,
  onSelect,
  onActivate,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOverRow,
  renaming,
  onRenameCommit,
  onRenameCancel,
}: {
  file: FileNode;
  idx: number;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  isProtected: boolean;
  draggingId: string | null;
  dropTargetId: string | null;
  coarse: boolean;
  folderLabel: string;
  inUseLabel: string;
  actionsLabel: string;
  onSelect: (file: FileNode, event: { shiftKey: boolean }) => void;
  onActivate: (file: FileNode) => void;
  onContextMenu?: (file: FileNode, event: React.MouseEvent) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (destinationFolderId: string) => void;
  onDragOverRow: (id: string | null) => void;
  renaming: boolean;
  onRenameCommit?: (name: string) => void;
  onRenameCancel?: () => void;
}): React.ReactElement {
  const labels = useExplorerLabels();
  const pointer = useExplorerItemPointer({ file, coarse, onSelect, onActivate });
  const bodyClass = cn(
    "group relative flex w-full flex-col items-stretch gap-1 overflow-hidden rounded-[10px] border border-border bg-background p-2 text-left outline-none",
    "touch-manipulation select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
    selected && "border-primary bg-muted",
    dragging && "opacity-50",
    dropTarget && "ring-2 ring-primary ring-inset",
  );
  const inner = (
    <>
      <span className="flex items-center gap-1 pr-8">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
          {String(idx + 1).padStart(2, "0")}
        </span>
        {isProtected ? (
          <span className="flex items-center gap-0.5 rounded-[10px] bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            <Link2 aria-hidden="true" className="size-2.5" />
            <span className="sr-only">{inUseLabel}</span>
          </span>
        ) : null}
      </span>
      <span className={cn("flex items-center justify-center py-1", file.kind === "folder" ? "text-primary" : "text-muted-foreground")}>
        <FileIcon kind={file.kind} mimeType={file.mimeType} className="size-12 text-current" />
      </span>
      {renaming && onRenameCommit && onRenameCancel ? (
        <RenameInput
          name={file.name}
          kind={file.kind}
          ariaLabel={labels.rename}
          className="text-[11px]"
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className={cn("truncate text-[11px]", file.kind === "folder" && "text-primary")}>{file.name}</span>
      )}
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {file.kind === "folder" ? folderLabel : formatSizeShort(file.size)}
      </span>
    </>
  );
  return (
    <div role="listitem" className="relative">
      {coarse && onContextMenu ? (
        <button
          type="button"
          aria-label={actionsLabel}
          className="absolute right-0.5 top-0.5 z-10 inline-flex size-10 items-center justify-center rounded-[10px] text-muted-foreground"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onContextMenu(file, event);
          }}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      ) : null}
      {renaming ? (
        <div data-file-id={file.id} className={bodyClass}>
          {inner}
        </div>
      ) : (
        <button
          type="button"
          data-file-id={file.id}
          draggable={!coarse}
          aria-selected={selected}
          onDragStart={(e: DragEvent<HTMLButtonElement>) => {
            e.dataTransfer.setData(EXPLORER_DRAG_MIME, file.id);
            e.dataTransfer.effectAllowed = "move";
            onDragStart(file.id);
          }}
          onDragEnd={onDragEnd}
          onPointerDown={pointer.onPointerDown}
          onClick={pointer.onClick}
          onDoubleClick={pointer.onDoubleClick}
          onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onActivate(file);
            }
          }}
          onContextMenu={
            onContextMenu
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (coarse) return;
                  onContextMenu(file, e);
                }
              : undefined
          }
          onDragOver={(e) => {
            if (file.kind !== "folder" || !draggingId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropTargetId !== file.id) onDragOverRow(file.id);
          }}
          onDragLeave={() => {
            if (dropTargetId === file.id) onDragOverRow(null);
          }}
          onDrop={(e) => {
            if (file.kind !== "folder") return;
            e.preventDefault();
            onDrop(file.id);
          }}
          className={bodyClass}
        >
          {inner}
        </button>
      )}
    </div>
  );
}

const formatSizeShort = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
};
