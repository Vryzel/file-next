"use client";

/**
 * `<ExplorerGridView />` — card-grid layout for the file explorer.
 *
 * Like Finder's icon view / Google Drive's grid view. Each file
 * or folder is a square card with an icon, name, and optional
 * size. Click selects, double-click activates (opens the folder
 * or triggers the download).
 *
 * Spec:
 *   - Responsive grid: 2 cols on mobile, 4 on sm, 6 on md, 8 on lg.
 *   - Hover lifts the card with a subtle shadow.
 *   - Selected card gets a tinted background + ring.
 *   - Drag-drop: cards are draggable; folder cards accept drops
 *     (same draggable pattern as the list view).
 *   - Right-click opens a context menu.
 */
import type { DragEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { FileIcon } from "./file-icon";
import { EXPLORER_DRAG_MIME } from "./explorer-list-view";
import type { FileNode } from "@vryzel/file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExplorerGridViewProps {
  readonly files: ReadonlyArray<FileNode>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onActivate: (file: FileNode) => void;
  readonly onContextMenu?: (file: FileNode, event: React.MouseEvent) => void;
  readonly onDragStart: (id: string) => void;
  readonly onDragEnd: () => void;
  readonly onDrop: (destinationFolderId: string) => void;
  readonly draggingId: string | null;
  readonly dropTargetId: string | null;
  readonly onDragOverRow: (id: string | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExplorerGridView(
  props: ExplorerGridViewProps,
): React.ReactElement {
  const {
    files,
    selectedId,
    onSelect,
    onActivate,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDrop,
    draggingId,
    dropTargetId,
    onDragOverRow,
  } = props;

  if (files.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        This folder is empty.
      </div>
    );
  }

  return (
    <ul
      role="list"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
    >
      {files.map((file) => {
        const selected = file.id === selectedId;
        const dragging = file.id === draggingId;
        const dropTarget = file.id === dropTargetId && file.kind === "folder";
        return (
          <li key={file.id}>
            <button
              type="button"
              draggable
              aria-selected={selected}
              onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                e.dataTransfer.setData(EXPLORER_DRAG_MIME, file.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(file.id);
              }}
              onDragEnd={onDragEnd}
              onClick={() => onSelect(file.id)}
              onDoubleClick={() => onActivate(file)}
              onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActivate(file);
                }
              }}
              onContextMenu={
                onContextMenu
                  ? (e) => {
                      e.preventDefault();
                      onContextMenu(file, e);
                    }
                  : undefined
              }
              onDragOver={(e) => {
                if (file.kind !== "folder") return;
                if (!draggingId) return;
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
                "group flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border border-border bg-card p-3 text-center outline-none transition-all",
                "hover:border-primary/50 hover:bg-accent hover:shadow-sm",
                "focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-primary bg-accent ring-1 ring-primary",
                dragging && "opacity-50",
                dropTarget && "ring-2 ring-primary ring-inset",
              )}
            >
              <FileIcon
                kind={file.kind}
                mimeType={file.mimeType}
                className="size-12"
              />
              <span className="line-clamp-2 w-full text-xs font-medium">
                {file.name}
              </span>
              {file.kind === "file" && file.size > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {formatSizeShort(file.size)}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const formatSizeShort = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
};
