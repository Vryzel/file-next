"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export interface BreadcrumbsProps {
  readonly segments: ReadonlyArray<{ id: string; name: string }>;
  readonly onNavigate?: (segment: { id: string; name: string }) => void;
  readonly className?: string;
}

export function Breadcrumbs(props: BreadcrumbsProps): React.ReactElement {
  const { segments, onNavigate, className } = props;
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1 text-sm", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li key={segment.id} className="flex items-center gap-1">
              {isLast ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {segment.name}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate?.(segment)}
                    className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {segment.name}
                  </button>
                  <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
