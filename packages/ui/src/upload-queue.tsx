"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { RequestUploadResult } from "@vryzel/file-next-headless";
import { ExplorerUploadStatus } from "./explorer-upload-status";
import { useUploadQueue, type UploadQueueItem } from "./use-upload-queue";

type Enqueue = (files: ReadonlyArray<File>, parentId: string | null) => void;

const EnqueueContext = createContext<Enqueue | null>(null);

export function useUploadEnqueue(): Enqueue | null {
  return useContext(EnqueueContext);
}

export function UploadQueueProvider({
  requestUpload,
  confirmUpload,
  children,
}: {
  requestUpload: (file: {
    name: string;
    size: number;
    type: string;
    content: Blob;
    parentId: string | null;
  }) => Promise<RequestUploadResult>;
  confirmUpload?: (file: {
    name: string;
    size: number;
    type: string;
    content: Blob;
  }) => Promise<void> | void;
  children: ReactNode;
}): React.ReactElement {
  const uploads = useUploadQueue({ requestUpload, confirmUpload });
  const panel = useMemo(
    () => (
      <div className="fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        <ExplorerUploadStatus items={uploads.items} onDismiss={uploads.dismiss} />
      </div>
    ),
    [uploads.dismiss, uploads.items],
  );

  return (
    <EnqueueContext.Provider value={uploads.enqueue}>
      {children}
      {panel}
    </EnqueueContext.Provider>
  );
}

export type { UploadQueueItem };
