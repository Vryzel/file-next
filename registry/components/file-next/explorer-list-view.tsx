"use client";

/**
 * `<ExplorerListView />` — table layout for the file explorer.
 *
 * Columns: Name | Size | Modified | Kind. The consumer can pick
 * a subset via the `columns` prop.
 *
 * Spec:
 *   - Header row with column labels (sortable: Name, Size, Modified).
 *   - Each row is a button so Enter / Space activates it.
 *   - Hover highlights the row; the selected row gets a tinted
 *     background.
 *   - Right-click opens a context menu (consumer wires `onContextMenu`).
 *   - Drag handle on the row name (HTML5 draggable).
 *
 * Architecture:
 *   - Pure presentational — the hook (`useFileExplorer`) owns the
 *     selection / drag state. This component just renders rows.
 *   - The folder icon column is always present (it IS the row's
 *     primary visual anchor).
 */
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { FileIcon } from "./file-icon";
import type { FileNode } from "@vryzel/file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExplorerColumn = "name" | "size" | "modified" | "kind";

export type SortDirection = "asc" | "desc";

export interface ExplorerListViewProps {
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
  /** Columns to show. Default: all four. */
  readonly columns?: ReadonlyArray<ExplorerColumn>;
  /** Sortable? Default: name asc. The consumer (orchestrator) sorts the array before passing. */
  readonly sortKey?: ExplorerColumn;
  readonly sortDirection?: SortDirection;
  readonly onSortChange?: (key: ExplorerColumn) => void;
}

const COLUMN_LABELS: Record<ExplorerColumn, string> = {
  name: "Name",
  size: "Size",
  modified: "Modified",
  kind: "Kind",
};

const COLUMN_WIDTHS: Record<ExplorerColumn, string> = {
  name: "min-w-0 flex-1",
  size: "w-24 text-right",
  modified: "w-40",
  kind: "w-24",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 100 || exp === 0 ? 0 : 1)} ${units[exp]}`;
};

const formatDate = (d: Date): string => {
  // Locale-aware short date. Tests rely on toLocaleDateString being
  // available (Node 13+, all browsers).
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const DRAG_MIME = "application/x-file-next-id";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExplorerListView(props: ExplorerListViewProps): React.ReactElement {
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
    columns = ["name", "size", "modified", "kind"],
    sortKey,
    sortDirection,
    onSortChange,
  } = props;

  return (
    <div className="overflow-hidden rounded-md border border-border">
      {/* Header */}
      <div
        role="row"
        className="grid items-center gap-4 border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: "auto 1fr" }}
      >
        <span className="w-5" aria-hidden="true" />
        {columns.map((col) => {
          const sortable = col !== "kind";
          const active = sortKey === col;
          return (
            <button
              key={col}
              type="button"
              role="columnheader"
              aria-sort={
                active
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
              disabled={!sortable}
              onClick={sortable && onSortChange ? () => onSortChange(col) : undefined}
              className={cn(
                "flex items-center gap-1 text-left",
                COLUMN_WIDTHS[col],
                sortable ? "cursor-pointer hover:text-foreground" : "cursor-default",
                col === "size" && "justify-end",
              )}
            >
              {COLUMN_LABELS[col]}
              {active &&
                (sortDirection === "asc" ? (
                  <ChevronUp aria-hidden="true" className="size-3" />
                ) : (
                  <ChevronDown aria-hidden="true" className="size-3" />
                ))}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <ul role="list" className="divide-y divide-border">
        {files.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            This folder is empty.
          </li>
        ) : (
          files.map((file) => {
            const selected = file.id === selectedId;
            const dragging = file.id === draggingId;
            const dropTarget = file.id === dropTargetId && file.kind === "folder";
            return (
              <li
                key={file.id}
                role="row"
                aria-selected={selected}
                draggable={file.kind === "file" || file.kind === "folder"}
                onDragStart={(e: DragEvent<HTMLLIElement>) => {
                  if (file.kind === "file") {
                    e.dataTransfer.setData(DRAG_MIME, file.id);
                    e.dataTransfer.effectAllowed = "move";
                  }
                  onDragStart(file.id);
                }}
                onDragEnd={onDragEnd}
                onClick={() => onSelect(file.id)}
                onDoubleClick={() => onActivate(file)}
                onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
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
                  // Only folders can be drop targets.
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
                  const draggedId = e.dataTransfer.getData(DRAG_MIME);
                  if (draggedId && draggedId !== file.id) {
                    onDrop(file.id);
                  } else {
                    onDragEnd();
                  }
                }}
                tabIndex={0}
                className={cn(
                  "grid items-center gap-4 px-4 py-2 text-sm outline-none transition-colors",
                  selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
                  dragging && "opacity-50",
                  dropTarget && "ring-2 ring-primary ring-inset",
                )}
                style={{ gridTemplateColumns: "auto 1fr" }}
              >
                <span className="w-5">
                  <FileIcon kind={file.kind} mimeType={file.mimeType} />
                </span>
                {columns.map((col) => (
                  <span
                    key={col}
                    className={cn(
                      "truncate",
                      COLUMN_WIDTHS[col],
                      col === "size" && "tabular-nums",
                      col === "kind" && "capitalize",
                    )}
                  >
                    {col === "name" && (
                      <span className="font-medium">{file.name}</span>
                    )}
                    {col === "size" && formatSize(file.size)}
                    {col === "modified" && formatDate(file.updatedAt)}
                    {col === "kind" && file.kind}
                  </span>
                ))}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// Re-export the drag MIME for the orchestrator's drop handler.
export const EXPLORER_DRAG_MIME = DRAG_MIME;
