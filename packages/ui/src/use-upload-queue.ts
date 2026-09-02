"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestUploadResult } from "@vryzel/file-next-headless";

export type UploadQueueStatus = "queued" | "uploading" | "success" | "error";

export type UploadQueueItem = {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly parentId: string | null;
  readonly status: UploadQueueStatus;
  readonly progress: number;
  readonly error?: string;
};

type InternalItem = {
  id: string;
  name: string;
  size: number;
  type: string;
  parentId: string | null;
  status: UploadQueueStatus;
  progress: number;
  error?: string;
  content: Blob;
};

export function useUploadQueue(options: {
  readonly requestUpload: (file: {
    name: string;
    size: number;
    type: string;
    content: Blob;
    parentId: string | null;
  }) => Promise<RequestUploadResult>;
  readonly confirmUpload?: (file: {
    name: string;
    size: number;
    type: string;
    content: Blob;
  }) => Promise<void> | void;
}): {
  readonly items: ReadonlyArray<UploadQueueItem>;
  readonly enqueue: (files: ReadonlyArray<File>, parentId: string | null) => void;
  readonly dismiss: () => void;
  readonly active: boolean;
} {
  const requestUploadRef = useRef(options.requestUpload);
  requestUploadRef.current = options.requestUpload;
  const confirmUploadRef = useRef(options.confirmUpload);
  confirmUploadRef.current = options.confirmUpload;

  const queueRef = useRef<InternalItem[]>([]);
  const running = useRef(false);
  const [items, setItems] = useState<ReadonlyArray<UploadQueueItem>>([]);

  const publish = useCallback(() => {
    setItems(queueRef.current.map(({ content: _content, ...item }) => item));
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    const next = queueRef.current.find((item) => item.status === "queued");
    if (!next) return;
    running.current = true;
    next.status = "uploading";
    next.progress = 0;
    publish();
    try {
      const target = await requestUploadRef.current({
        name: next.name,
        size: next.size,
        type: next.type,
        content: next.content,
        parentId: next.parentId,
      });
      let lastPublish = 0;
      await putFile(target, next, (progress) => {
        next.progress = progress;
        const now = Date.now();
        if (progress === 100 || now - lastPublish > 200) {
          lastPublish = now;
          publish();
        }
      });
      await confirmUploadRef.current?.({
        name: next.name,
        size: next.size,
        type: next.type,
        content: next.content,
      });
      next.status = "success";
      next.progress = 100;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("file-next-uploaded"));
      }
    } catch (error) {
      next.status = "error";
      next.error = error instanceof Error ? error.message : "Upload failed";
    } finally {
      publish();
      running.current = false;
      void pump();
    }
  }, [publish]);

  const enqueue = useCallback(
    (files: ReadonlyArray<File>, parentId: string | null) => {
      if (files.length === 0) return;
      const added: InternalItem[] = files.map((file) => ({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        name: file.name,
        size: file.size,
        type: file.type,
        content: file,
        parentId,
        status: "queued",
        progress: 0,
      }));
      queueRef.current = [...queueRef.current, ...added];
      publish();
      void pump();
    },
    [publish, pump],
  );

  const dismiss = useCallback(() => {
    queueRef.current = queueRef.current.filter(
      (item) => item.status === "queued" || item.status === "uploading",
    );
    publish();
  }, [publish]);

  const active = items.some(
    (item) => item.status === "queued" || item.status === "uploading",
  );
  const itemCount = items.length;

  useEffect(() => {
    if (active || itemCount === 0) return undefined;
    const timeout = window.setTimeout(() => {
      dismiss();
    }, 3000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [active, dismiss, itemCount]);

  return { items, enqueue, dismiss, active };
}

function putFile(
  target: RequestUploadResult,
  file: InternalItem,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let message = `Upload failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            error?: { message?: string };
          };
          if (parsed.error?.message) message = parsed.error.message;
        } catch {
          /* keep fallback */
        }
        reject(new Error(message));
        return;
      }
      resolve();
    });
    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed"));
    });
    xhr.open(target.method ?? "PUT", target.url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    for (const [header, value] of Object.entries(target.headers ?? {})) {
      xhr.setRequestHeader(header, value);
    }
    xhr.send(file.content);
  });
}
