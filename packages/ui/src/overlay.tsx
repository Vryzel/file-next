"use client";

import type { ReactNode } from "react";
import { cn } from "./cn";

export function Overlay({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        className={cn(
          "w-full max-w-sm rounded-[10px] border border-border bg-card p-4 text-card-foreground shadow-xl",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
