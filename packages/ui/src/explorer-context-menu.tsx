"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  Copy,
  Download,
  Eye,
  FolderPlus,
  Link2,
  Pencil,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { cn } from "./cn";
import { swallowClickThrough } from "./swallow-click-through";
import type { FileNode } from "./types";
import { useExplorerLabels } from "./labels";

export interface ExplorerContextMenuActions {
  readonly deleteFile: (input: { id: string }) => Promise<unknown>;
  readonly renameFile: (id: string, newName: string) => Promise<void>;
  readonly restoreNode?: (input: { id: string }) => Promise<unknown>;
  readonly purgeNode?: (input: { id: string }) => Promise<unknown>;
  readonly createShare?: (input: { id: string }) => Promise<string>;
}

export type ExplorerContextTarget =
  | { kind: "item"; file: FileNode; x: number; y: number }
  | { kind: "blank"; x: number; y: number };

export interface ExplorerContextMenuProps {
  readonly target: ExplorerContextTarget | null;
  readonly mode?: "browse" | "trash";
  readonly actions: ExplorerContextMenuActions;
  readonly protectedItem?: boolean;
  readonly onClose: () => void;
  readonly onPreview?: (file: FileNode) => void;
  readonly onDownload?: (file: FileNode) => void;
  readonly onRename?: (file: FileNode) => void;
  readonly onRequestDelete?: (file: FileNode) => void;
  readonly onRequestPurge?: (file: FileNode) => void;
  readonly onCopy?: (file: FileNode) => void;
  readonly onPaste?: (folder?: FileNode) => void;
  readonly onNewFolder?: () => void;
  readonly onUpload?: () => void;
  readonly extraFileAction?: {
    label: string;
    onSelect: (file: FileNode) => void;
  };
}

export function ExplorerContextMenu(
  props: ExplorerContextMenuProps,
): React.ReactElement | null {
  const {
    target,
    mode = "browse",
    actions,
    protectedItem = false,
    onClose,
    onPreview,
    onDownload,
    onRename,
    onRequestDelete,
    onRequestPurge,
    onCopy,
    onPaste,
    onNewFolder,
    onUpload,
    extraFileAction,
  } = props;
  const labels = useExplorerLabels();
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !target) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(Math.max(pad, target.x), window.innerWidth - rect.width - pad);
    const top = Math.min(Math.max(pad, target.y), window.innerHeight - rect.height - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      swallowClickThrough();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose, target]);

  if (!target) return null;

  const close = () => {
    swallowClickThrough();
    onClose();
  };

  const itemClass =
    "flex w-full min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-sm outline-none hover:bg-accent disabled:opacity-40 sm:min-h-0 sm:px-2.5 sm:py-1.5";

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-48 rounded-[10px] border border-border bg-card p-1 text-card-foreground shadow-xl"
      style={{ left: target.x, top: target.y }}
    >
      {target.kind === "blank" ? (
        <>
          {onNewFolder ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onNewFolder(); }}>
              <FolderPlus aria-hidden="true" className="size-4" />
              {labels.newFolder}
            </button>
          ) : null}
          {onUpload ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onUpload(); }}>
              <Upload aria-hidden="true" className="size-4" />
              {labels.upload}
            </button>
          ) : null}
          {onPaste ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onPaste(); }}>
              <Copy aria-hidden="true" className="size-4" />
              {labels.paste}
            </button>
          ) : null}
        </>
      ) : mode === "trash" ? (
        <>
          <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); void actions.restoreNode?.({ id: target.file.id }); }}>
            <RotateCcw aria-hidden="true" className="size-4" />
            {labels.restore}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className={cn(itemClass, "text-destructive")}
            onClick={() => {
              close();
              if (onRequestPurge) onRequestPurge(target.file);
              else void actions.purgeNode?.({ id: target.file.id });
            }}
          >
            <X aria-hidden="true" className="size-4" />
            {labels.deleteForever}
          </button>
        </>
      ) : (
        <>
          {target.file.kind === "file" && onPreview ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onPreview(target.file); }}>
              <Eye aria-hidden="true" className="size-4" />
              {labels.preview}
            </button>
          ) : null}
          {target.file.kind === "file" && onDownload ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onDownload(target.file); }}>
              <Download aria-hidden="true" className="size-4" />
              {labels.download}
            </button>
          ) : null}
          {target.file.kind === "file" && extraFileAction ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); extraFileAction.onSelect(target.file); }}>
              {extraFileAction.label}
            </button>
          ) : null}
          {onRename ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onRename(target.file); }}>
              <Pencil aria-hidden="true" className="size-4" />
              {labels.rename}
            </button>
          ) : null}
          {onCopy ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onCopy(target.file); }}>
              <Copy aria-hidden="true" className="size-4" />
              {labels.copy}
            </button>
          ) : null}
          {onPaste && target.file.kind === "folder" ? (
            <button type="button" role="menuitem" className={itemClass} onClick={() => { close(); onPaste(target.file); }}>
              <Copy aria-hidden="true" className="size-4" />
              {labels.paste}
            </button>
          ) : null}
          {actions.createShare ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                close();
                void actions.createShare!({ id: target.file.id }).then((token) =>
                  navigator.clipboard.writeText(token),
                );
              }}
            >
              <Link2 aria-hidden="true" className="size-4" />
              {labels.copyShare}
            </button>
          ) : null}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            disabled={protectedItem}
            className={cn(itemClass, "text-destructive")}
            onClick={() => {
              if (protectedItem) return;
              close();
              if (onRequestDelete) onRequestDelete(target.file);
              else void actions.deleteFile({ id: target.file.id });
            }}
          >
            <X aria-hidden="true" className="size-4" />
            {labels.moveToTrash}
          </button>
        </>
      )}
    </div>
  );
}
