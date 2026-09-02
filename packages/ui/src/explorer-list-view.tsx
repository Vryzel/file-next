"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Link2, MoreHorizontal } from "lucide-react";
import { cn } from "./cn";
import { FileIcon } from "./file-icon";
import type { FileNode } from "./types";
import { useExplorerLabels } from "./labels";
import { useCoarsePointer, useExplorerItemPointer } from "./use-explorer-item-pointer";

export type ExplorerColumn = "name" | "size" | "modified" | "kind";
export type SortDirection = "asc" | "desc";

export interface ExplorerListViewProps {
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
  readonly sortKey?: ExplorerColumn;
  readonly sortDirection?: SortDirection;
  readonly onSortChange?: (key: ExplorerColumn) => void;
  readonly className?: string;
}

const ROW_GRID =
  "grid-cols-[2.25rem_1.5rem_minmax(12rem,1fr)_5rem_2.75rem] sm:grid-cols-[2.25rem_1.25rem_minmax(0,1fr)_5rem_7.5rem]";
const DRAG_MIME = "application/x-file-next-id";

export function ExplorerListView(props: ExplorerListViewProps): React.ReactElement {
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
    sortKey,
    sortDirection,
    onSortChange,
    className,
  } = props;
  const labels = useExplorerLabels();
  const coarse = useCoarsePointer();

  return (
    <div className={cn("overflow-x-auto overscroll-x-contain", className)}>
      <div className="min-w-[32rem] sm:min-w-0">
        <div
          role="row"
          className={cn(
            "grid items-center gap-3 border-b border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground",
            ROW_GRID,
          )}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <SortHeader col="name" label={labels.sortName} sortKey={sortKey} sortDirection={sortDirection} onSort={onSortChange} />
          <SortHeader col="size" label={labels.sortSize} sortKey={sortKey} sortDirection={sortDirection} onSort={onSortChange} className="justify-end text-right" />
          {coarse ? (
            <span aria-hidden="true" />
          ) : (
            <SortHeader col="modified" label={labels.sortModified} sortKey={sortKey} sortDirection={sortDirection} onSort={onSortChange} className="hidden sm:flex" />
          )}
        </div>
        <ul role="list">
          {files.map((file, idx) => (
            <ExplorerListRow
              key={file.id}
              file={file}
              idx={idx}
              selected={selectedIds.has(file.id)}
              dragging={draggingIds?.has(file.id) ?? file.id === draggingId}
              dropTarget={file.id === dropTargetId && file.kind === "folder"}
              isProtected={protectedIds?.has(file.id) ?? false}
              draggingId={draggingId}
              dropTargetId={dropTargetId}
              coarse={coarse}
              onSelect={onSelect}
              onActivate={onActivate}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onDragOverRow={onDragOverRow}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ExplorerListRow({
  file,
  idx,
  selected,
  dragging,
  dropTarget,
  isProtected,
  draggingId,
  dropTargetId,
  coarse,
  onSelect,
  onActivate,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOverRow,
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
  onSelect: (file: FileNode, event: { shiftKey: boolean }) => void;
  onActivate: (file: FileNode) => void;
  onContextMenu?: (file: FileNode, event: React.MouseEvent) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (destinationFolderId: string) => void;
  onDragOverRow: (id: string | null) => void;
}): React.ReactElement {
  const labels = useExplorerLabels();
  const isFolder = file.kind === "folder";
  const pointer = useExplorerItemPointer({ file, coarse, onSelect, onActivate });

  return (
    <li
      role="row"
      data-file-id={file.id}
      aria-selected={selected}
      draggable={!coarse}
      onDragStart={(e: DragEvent<HTMLLIElement>) => {
        e.dataTransfer.setData(DRAG_MIME, file.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(file.id);
      }}
      onDragEnd={onDragEnd}
      onPointerDown={pointer.onPointerDown}
      onClick={pointer.onClick}
      onDoubleClick={pointer.onDoubleClick}
      onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
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
        if (!isFolder || !draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTargetId !== file.id) onDragOverRow(file.id);
      }}
      onDragLeave={() => {
        if (dropTargetId === file.id) onDragOverRow(null);
      }}
      onDrop={(e) => {
        if (!isFolder) return;
        e.preventDefault();
        const draggedId = e.dataTransfer.getData(DRAG_MIME);
        if (draggedId && draggedId !== file.id) onDrop(file.id);
        else onDragEnd();
      }}
      tabIndex={0}
      className={cn(
        "group grid items-center gap-3 border-b border-border/60 px-3 py-3.5 text-sm outline-none last:border-b-0 sm:py-2",
        "touch-manipulation select-none [-webkit-touch-callout:none]",
        ROW_GRID,
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "bg-muted",
        dragging && "opacity-50",
        dropTarget && "ring-2 ring-primary ring-inset",
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
        {String(idx + 1).padStart(2, "0")}
      </span>
      <span className={isFolder ? "text-primary" : "text-muted-foreground"}>
        <FileIcon kind={file.kind} mimeType={file.mimeType} className="size-5 text-current sm:size-4" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn("truncate", isFolder && "text-primary")}>{file.name}</span>
        {isProtected ? (
          <span className="flex shrink-0 items-center gap-0.5 rounded-[10px] bg-primary/10 px-1.5 text-[10px] text-primary">
            <Link2 aria-hidden="true" className="size-2.5" />
            {labels.inUse}
          </span>
        ) : null}
      </span>
      <span className="truncate text-right font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
        {formatSize(file.size)}
      </span>
      {coarse ? (
        <button
          type="button"
          aria-label={labels.itemActions}
          className="inline-flex size-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onContextMenu?.(file, event);
          }}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
        </button>
      ) : (
        <span className="hidden truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums sm:block">
          {formatDate(file.updatedAt)}
        </span>
      )}
    </li>
  );
}

function SortHeader({
  col,
  label,
  sortKey,
  sortDirection,
  onSort,
  className,
}: {
  col: ExplorerColumn;
  label: string;
  sortKey?: ExplorerColumn;
  sortDirection?: SortDirection;
  onSort?: (k: ExplorerColumn) => void;
  className?: string;
}): React.ReactElement {
  const active = sortKey === col;
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
      onClick={onSort ? () => onSort(col) : undefined}
      className={cn(
        "flex items-center gap-1 text-left outline-none",
        onSort ? "cursor-pointer hover:text-foreground" : "cursor-default",
        className,
      )}
    >
      <span>{label}</span>
      {active ? (
        sortDirection === "asc" ? (
          <ChevronUp aria-hidden="true" className="size-3" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-3" />
        )
      ) : null}
    </button>
  );
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 100 || exp === 0 ? 0 : 1)} ${units[exp]}`;
};

const formatDate = (d: Date): string =>
  d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export const EXPLORER_DRAG_MIME = DRAG_MIME;
