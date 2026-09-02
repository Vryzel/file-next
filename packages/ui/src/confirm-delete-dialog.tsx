"use client";

import { useState } from "react";
import { Overlay } from "./overlay";
import { formatLabel, useExplorerLabels } from "./labels";

export function ConfirmDeleteDialog({
  open,
  names,
  permanent = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  names: ReadonlyArray<string>;
  permanent?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}): React.ReactElement {
  const labels = useExplorerLabels();
  const [saving, setSaving] = useState(false);
  const description =
    names.length === 1
      ? formatLabel(permanent ? labels.confirmPurge : labels.confirmDelete, {
          name: names[0] ?? "",
        })
      : formatLabel(permanent ? labels.confirmPurgeMany : labels.confirmDeleteMany, {
          count: names.length,
        });

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay open={open} onClose={() => !saving && onOpenChange(false)}>
      <h2 className="text-base font-semibold">
        {permanent ? labels.deleteForever : labels.moveToTrash}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          className="inline-flex h-8 items-center rounded-[10px] border border-border px-3 text-sm"
          onClick={() => onOpenChange(false)}
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          disabled={saving}
          className={
            permanent
              ? "inline-flex h-8 items-center rounded-[10px] bg-destructive px-3 text-sm text-destructive-foreground"
              : "inline-flex h-8 items-center rounded-[10px] bg-primary px-3 text-sm text-primary-foreground"
          }
          onClick={() => void submit()}
        >
          {saving
            ? labels.deleting
            : permanent
              ? labels.deleteForever
              : labels.moveToTrash}
        </button>
      </div>
    </Overlay>
  );
}
