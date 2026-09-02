"use client";

import { useEffect, useRef, useState } from "react";
import { Overlay } from "./overlay";
import { useExplorerLabels } from "./labels";

export function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
  title,
  description,
  confirmLabel,
  initialName = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void> | void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  initialName?: string;
}): React.ReactElement {
  const labels = useExplorerLabels();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setError(null);
      return;
    }
    setName(initialName);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [initialName, open]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmed);
      onOpenChange(false);
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? String((cause as { code?: string }).code)
          : "";
      setError(code === "Conflict" ? labels.folderExists : labels.folderCreateFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay open={open} onClose={() => onOpenChange(false)}>
      <h2 className="text-base font-semibold">{title ?? labels.newFolder}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {description ?? labels.folderNameHint}
      </p>
      <input
        ref={inputRef}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={labels.folderName}
        aria-invalid={Boolean(error)}
        className="mt-3 h-9 w-full rounded-[10px] border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[10px] border border-border px-3 text-sm"
          onClick={() => onOpenChange(false)}
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          disabled={!name.trim() || saving}
          className="inline-flex h-8 items-center rounded-[10px] bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
          onClick={() => void submit()}
        >
          {confirmLabel ?? labels.createFolder}
        </button>
      </div>
    </Overlay>
  );
}
