"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { Link2, MoreHorizontal } from "lucide-react";
import { cn } from "./cn";
import { FileIcon } from "./file-icon";
import { EXPLORER_DRAG_MIME } from "./explorer-list-view";
import type { FileNode } from "./types";
import { useExplorerLabels } from "./labels";
import { useCoarsePointer, useExplorerItemPointer } from "./use-explorer-item-pointer";

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
  readonly className?: string;
}

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
    className,
  } = props;
  const labels = useExplorerLabels();
  const coarse = useCoarsePointer();

  return (
    <ul role="list" className={cn("grid grid-cols-3 gap-1.5 p-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8", className)}>
      {files.map((file, idx) => (
        <ExplorerGridItem
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
        />
      ))}
    </ul>
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
}): React.ReactElement {
  const pointer = useExplorerItemPointer({ file, coarse, onSelect, onActivate });
  return (
    <li className="relative">
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
        className={cn(
          "group relative flex w-full flex-col items-stretch gap-1 overflow-hidden rounded-[10px] border border-border bg-background p-2 text-left outline-none",
          "touch-manipulation select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          selected && "border-primary bg-muted",
          dragging && "opacity-50",
          dropTarget && "ring-2 ring-primary ring-inset",
        )}
      >
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
        <span className={cn("truncate text-[11px]", file.kind === "folder" && "text-primary")}>{file.name}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          {file.kind === "folder" ? folderLabel : formatSizeShort(file.size)}
        </span>
      </button>
    </li>
  );
}

const formatSizeShort = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
};
