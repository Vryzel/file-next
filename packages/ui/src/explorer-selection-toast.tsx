"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Link2, ListChecks, RotateCcw, X } from "lucide-react";
import { cn } from "./cn";
import { swallowClickThrough } from "./swallow-click-through";
import type { FileNode } from "./types";
import { useExplorerLabels } from "./labels";

export function ExplorerSelectionToast({
  files,
  protectedIds,
  trashOpen,
  onDownload,
  onCopy,
  onShare,
  onDelete,
  onRestore,
  onPurge,
  onClear,
}: {
  readonly files: ReadonlyArray<FileNode>;
  readonly protectedIds: ReadonlySet<string>;
  readonly trashOpen: boolean;
  readonly onDownload?: (file: FileNode) => void;
  readonly onCopy?: () => void;
  readonly onShare?: () => void;
  readonly onDelete?: () => void;
  readonly onRestore?: () => void;
  readonly onPurge?: () => void;
  readonly onClear: () => void;
}): React.ReactElement | null {
  const labels = useExplorerLabels();
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (files.length < 2) setOpen(false);
  }, [files.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      swallowClickThrough();
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  if (files.length < 2) return null;

  return (
    <div
      ref={rootRef}
      className={cn(
        "z-50 flex flex-col items-start gap-2",
        compact ? "fixed bottom-4 left-4" : "fixed right-4 bottom-4 w-[min(22rem,calc(100vw-2rem))]",
      )}
    >
      {!compact || open ? (
        <div className="w-[min(18rem,calc(100vw-2rem))] md:w-full">
          <SelectionActions
            files={files}
            protectedIds={protectedIds}
            trashOpen={trashOpen}
            onDownload={onDownload}
            onCopy={onCopy}
            onShare={onShare}
            onDelete={onDelete}
            onRestore={onRestore}
            onPurge={onPurge}
            onClear={onClear}
          />
        </div>
      ) : null}
      {compact ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${files.length} ${labels.selectedCount}`}
          className="relative inline-flex size-12 items-center justify-center rounded-[10px] border border-border bg-card shadow-xl"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <ListChecks aria-hidden="true" className="size-5" />
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center font-mono text-[10px] leading-5 text-primary-foreground">
            {files.length}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function SelectionActions({
  files,
  protectedIds,
  trashOpen,
  onDownload,
  onCopy,
  onShare,
  onDelete,
  onRestore,
  onPurge,
  onClear,
}: {
  readonly files: ReadonlyArray<FileNode>;
  readonly protectedIds: ReadonlySet<string>;
  readonly trashOpen: boolean;
  readonly onDownload?: (file: FileNode) => void;
  readonly onCopy?: () => void;
  readonly onShare?: () => void;
  readonly onDelete?: () => void;
  readonly onRestore?: () => void;
  readonly onPurge?: () => void;
  readonly onClear: () => void;
}): React.ReactElement {
  const labels = useExplorerLabels();
  const downloadable = files.filter((file) => file.kind === "file");
  const hasProtected = files.some((file) => protectedIds.has(file.id));
  const btn =
    "inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-40 sm:h-8 sm:px-2.5";

  return (
    <div role="status" className="w-full rounded-[10px] border border-border bg-card p-3 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="text-primary">{String(files.length).padStart(2, "0")}</span>{" "}
          {labels.selectedCount}
        </span>
        <button
          type="button"
          aria-label={labels.clearSelection}
          className="ml-auto inline-flex size-7 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted"
          onClick={(event) => {
            event.stopPropagation();
            swallowClickThrough();
            onClear();
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {trashOpen ? (
          <>
            <button type="button" className={btn} onClick={onRestore}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {labels.restore}
            </button>
            {onPurge ? (
              <button type="button" className={cn(btn, "text-destructive")} onClick={onPurge}>
                <X aria-hidden="true" className="size-3.5" />
                {labels.deleteForever}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {onDownload && downloadable.length > 0 ? (
              <button type="button" className={btn} onClick={() => downloadable.forEach(onDownload)}>
                <Download aria-hidden="true" className="size-3.5" />
                {labels.download}
              </button>
            ) : null}
            {onCopy ? (
              <button type="button" className={btn} onClick={onCopy}>
                <Copy aria-hidden="true" className="size-3.5" />
                {labels.copy}
              </button>
            ) : null}
            {onShare && downloadable.length > 0 ? (
              <button type="button" className={btn} onClick={onShare}>
                <Link2 aria-hidden="true" className="size-3.5" />
                {labels.share}
              </button>
            ) : null}
            <button type="button" disabled={hasProtected} className={cn(btn, "text-destructive")} onClick={onDelete}>
              <X aria-hidden="true" className="size-3.5" />
              {labels.moveToTrash}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ExplorerClipboardToast({
  count,
  onPaste,
  onClear,
}: {
  readonly count: number;
  readonly onPaste: () => void;
  readonly onClear: () => void;
}): React.ReactElement | null {
  const labels = useExplorerLabels();
  if (count < 1) return null;
  return (
    <div role="status" className="pointer-events-auto w-full rounded-[10px] border border-border bg-card p-3 shadow-xl">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="text-primary">{String(count).padStart(2, "0")}</span> {labels.copied}
        </span>
        <button
          type="button"
          aria-label={labels.clearClipboard}
          className="ml-auto inline-flex size-7 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted"
          onClick={onClear}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <button
        type="button"
        className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-border px-2.5 text-xs font-medium hover:bg-muted"
        onClick={onPaste}
      >
        <Copy aria-hidden="true" className="size-3.5" />
        {labels.paste}
      </button>
    </div>
  );
}
