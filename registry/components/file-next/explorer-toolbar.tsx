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
import { LayoutGrid, List as ListIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ViewMode } from "@file-next/headless";

export interface ExplorerToolbarProps {
  readonly view: ViewMode;
  readonly onViewChange: (v: ViewMode) => void;
  /** Optional className for the wrapper. */
  readonly className?: string;
}

export function ExplorerToolbar(
  props: ExplorerToolbarProps,
): React.ReactElement {
  const { view, onViewChange, className } = props;
  return (
    <div
      role="toolbar"
      aria-label="View options"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5",
        className,
      )}
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
  );
}
