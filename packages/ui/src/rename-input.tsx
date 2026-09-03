"use client";

import { useEffect, useRef } from "react";
import { cn } from "./cn";

export function RenameInput({
  name,
  kind,
  ariaLabel,
  onCommit,
  onCancel,
  className,
}: {
  name: string;
  kind: "file" | "folder";
  ariaLabel?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = name.lastIndexOf(".");
    if (kind === "file" && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [kind, name]);

  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    const trimmed = next?.trim() ?? "";
    if (!trimmed || trimmed === name) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  };

  return (
    <input
      ref={ref}
      defaultValue={name}
      aria-label={ariaLabel ?? "Rename"}
      className={cn(
        "h-7 min-w-0 flex-1 rounded-[6px] border border-ring bg-background px-1.5 text-sm outline-none",
        className,
      )}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
