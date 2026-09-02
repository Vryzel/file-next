"use client";

import { AlertCircleIcon } from "lucide-react";
import type { FileSystemError } from "./types";
import { cn } from "./cn";

export interface ErrorStateProps {
  readonly error: FileSystemError | { code: string; message: string };
  readonly onRetry?: () => void;
  readonly className?: string;
}

export function ErrorState(props: ErrorStateProps): React.ReactElement {
  const { error, onRetry, className } = props;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm",
        className,
      )}
    >
      <AlertCircleIcon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-destructive"
      />
      <div className="flex-1">
        <p className="font-medium text-destructive">{error.code}</p>
        <p className="mt-1 text-muted-foreground">{error.message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center justify-center rounded-[10px] border border-border bg-background px-3 text-sm font-medium hover:bg-accent"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
