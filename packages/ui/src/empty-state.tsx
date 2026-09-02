"use client";

import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "./cn";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { title, description, icon, action, className } = props;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-background p-3 text-muted-foreground shadow-sm">
        {icon ?? <Inbox aria-hidden="true" className="size-6" />}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
