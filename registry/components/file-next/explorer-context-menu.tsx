"use client";

/**
 * `<ExplorerContextMenu />` — right-click context menu for the
 * file explorer.
 *
 * Wraps a child element so that right-clicking it opens a Radix
 * DropdownMenu at the cursor position. The menu items reuse the
 * `<FileActions />` semantics: rename, move, copy, delete —
 * wired to the consumer's server-action callbacks.
 *
 * Spec:
 *   - Right-click (or contextmenu keyboard) opens the menu at
 *     the cursor position.
 *   - Items: Open / Open in new tab (where applicable), Rename,
 *     Move to…, Copy to…, separator, Delete (destructive, in red).
 *   - Each item calls the consumer's injected callback.
 *
 * Architecture:
 *   - Dependency-injected actions — same shape as `<FileActions />`
 *     so consumers can reuse their action wiring.
 *   - The trigger is the child element itself. The menu is
 *     portal-rendered via Radix.
 */
import { useState, useEffect, type ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  FolderInput,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { cn } from "@/lib/cn";
import type { FileNode } from "@vryzel/file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExplorerContextMenuActions {
  readonly deleteFile: (input: { id: string }) => Promise<unknown>;
  readonly moveFile: (input: { id: string; newParentId: string | null }) => Promise<unknown>;
  readonly copyFile: (input: { id: string; newParentId: string | null }) => Promise<unknown>;
  readonly renameFile: (id: string, newName: string) => Promise<void>;
  readonly restoreNode?: (input: { id: string }) => Promise<unknown>;
  readonly createShare?: (input: { id: string }) => Promise<string>;
}

export interface ExplorerContextMenuProps {
  /** The file/folder this menu operates on. */
  readonly file: FileNode;
  readonly mode?: "browse" | "trash";
  /** Server-action callbacks. */
  readonly actions: ExplorerContextMenuActions;
  /** Optional: callback for "Open" (double-click on the file). */
  readonly onOpen?: (file: FileNode) => void;
  /** Optional: callback for "Open in new tab" (download). */
  readonly onOpenInNewTab?: (file: FileNode) => void;
  /**
   * Optional: the current folder id. Used by "Move to…" / "Copy to…"
   * prompts to suggest "current folder" as a destination. The
   * prompt implementation is a simple `window.prompt` for v1;
   * v2 will replace with a folder picker.
   */
  readonly currentFolderId?: string | null;
  /** The child element that triggers the context menu. */
  readonly children: ReactNode;
  /** Optional className for the trigger wrapper. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExplorerContextMenu(
  props: ExplorerContextMenuProps,
): React.ReactElement {
  const {
    file,
    mode = "browse",
    actions,
    onOpen,
    onOpenInNewTab,
    currentFolderId,
    children,
    className,
  } = props;

  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Clear any pending error after a few seconds so a stale error
  // doesn't linger forever in the menu UI.
  useEffect(() => {
    if (!pendingError) return;
    const t = window.setTimeout(() => setPendingError(null), 4000);
    return () => window.clearTimeout(t);
  }, [pendingError]);

  const safeRun = async (
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      setPendingError(`${label}: ${(e as Error).message}`);
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className={cn("contents", className)}>{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-48 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {mode === "trash" ? (
            <ContextMenu.Item
              onSelect={() => {
                void safeRun("Restore", () =>
                  actions.restoreNode
                    ? actions.restoreNode({ id: file.id })
                    : Promise.resolve(),
                );
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Restore
            </ContextMenu.Item>
          ) : onOpen ? (
            <ContextMenu.Item
              onSelect={() => onOpen(file)}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Open
            </ContextMenu.Item>
          ) : null}
          {mode === "browse" && onOpenInNewTab && file.kind === "file" ? (
            <ContextMenu.Item
              onSelect={() => onOpenInNewTab(file)}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Open in new tab
            </ContextMenu.Item>
          ) : null}

          {mode === "browse" ? (
            <>
          <ContextMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              setRenameOpen(true);
            }}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <Pencil aria-hidden="true" className="size-4" />
            Rename…
          </ContextMenu.Item>

          <ContextMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              setMoveOpen(true);
            }}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <FolderInput aria-hidden="true" className="size-4" />
            Move to folder…
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              setCopyOpen(true);
            }}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <Copy aria-hidden="true" className="size-4" />
            Copy to folder…
          </ContextMenu.Item>

          {actions.createShare ? (
            <ContextMenu.Item
              onSelect={() => {
                void safeRun("Share", async () => {
                  const token = await actions.createShare!({ id: file.id });
                  await navigator.clipboard.writeText(token);
                });
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <Link2 aria-hidden="true" className="size-4" />
              Copy share token
            </ContextMenu.Item>
          ) : null}

          <ContextMenu.Separator className="my-1 h-px bg-border" />

          <ContextMenu.Item
            onSelect={() => {
              void safeRun("Delete", () => actions.deleteFile({ id: file.id }));
            }}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none data-[highlighted]:bg-destructive data-[highlighted]:text-destructive-foreground"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Delete
          </ContextMenu.Item>
            </>
          ) : null}

          {pendingError ? (
            <div className="mt-1 border-t border-border px-2 py-1.5 text-xs text-destructive">
              {pendingError}
            </div>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>

      {renameOpen ? (
        <PromptDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title={`Rename "${file.name}"`}
          defaultValue={file.name}
          placeholder="New name"
          confirmLabel="Rename"
          onConfirm={(newName) => {
            setRenameOpen(false);
            if (newName && newName !== file.name) {
              void safeRun("Rename", () =>
                actions.renameFile(file.id, newName),
              );
            }
          }}
        />
      ) : null}

      {moveOpen ? (
        <PromptDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={`Move "${file.name}"`}
          defaultValue={currentFolderId ?? ""}
          placeholder="Destination folder id (blank = root)"
          confirmLabel="Move"
          onConfirm={(dest) => {
            setMoveOpen(false);
            const newParentId = dest.trim() === "" ? null : dest.trim();
            void safeRun("Move", () =>
              actions.moveFile({ id: file.id, newParentId }),
            );
          }}
        />
      ) : null}

      {copyOpen ? (
        <PromptDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          title={`Copy "${file.name}"`}
          defaultValue={currentFolderId ?? ""}
          placeholder="Destination folder id (blank = root)"
          confirmLabel="Copy"
          onConfirm={(dest) => {
            setCopyOpen(false);
            const newParentId = dest.trim() === "" ? null : dest.trim();
            void safeRun("Copy", () =>
              actions.copyFile({ id: file.id, newParentId }),
            );
          }}
        />
      ) : null}
    </ContextMenu.Root>
  );
}

// ---------------------------------------------------------------------------
// Simple prompt dialog (browser `prompt` for v1; v2 replaces with
// an inline input or a folder picker).
// ---------------------------------------------------------------------------

function PromptDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  defaultValue: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
}): React.ReactElement | null {
  if (!props.open) return null;
  // Use window.prompt as a quick v1; consumers can override by
  // disabling the menu items via the `actions` prop shape.
  // We open the prompt immediately on mount.
  return (
    <PromptOnMount
      title={props.title}
      defaultValue={props.defaultValue}
      placeholder={props.placeholder}
      confirmLabel={props.confirmLabel}
      onConfirm={(v) => {
        props.onOpenChange(false);
        props.onConfirm(v);
      }}
    />
  );
}

function PromptOnMount(props: {
  title: string;
  defaultValue: string;
  placeholder?: string;
  confirmLabel: string;
  onConfirm: (v: string) => void;
}): null {
  useEffect(() => {
    const value = window.prompt(props.title, props.defaultValue);
    if (value !== null) {
      props.onConfirm(value);
    } else {
      props.onConfirm("");
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
