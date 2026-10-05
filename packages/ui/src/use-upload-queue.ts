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
  }, signal?: AbortSignal) => Promise<RequestUploadResult>;
  readonly confirmUpload?: (file: {
    name: string;
    size: number;
    type: string;
    content: Blob;
  }, signal?: AbortSignal) => Promise<void> | void;
}): {
  readonly items: ReadonlyArray<UploadQueueItem>;
  readonly enqueue: (files: ReadonlyArray<File>, parentId: string | null) => void;
  readonly dismiss: () => void;
  readonly cancel: () => void;
  readonly remove: (id: string) => void;
  readonly active: boolean;
} {
  const requestUploadRef = useRef(options.requestUpload);
  requestUploadRef.current = options.requestUpload;
  const confirmUploadRef = useRef(options.confirmUpload);
  confirmUploadRef.current = options.confirmUpload;

  const queueRef = useRef<InternalItem[]>([]);
  const running = useRef(false);
  const dropped = useRef(new Set<string>());
  const activeId = useRef<string | null>(null);
  const stepAbort = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const xhrOwner = useRef<string | null>(null);
  const [items, setItems] = useState<ReadonlyArray<UploadQueueItem>>([]);

  const publish = useCallback(() => {
    setItems(queueRef.current.map(({ content: _content, ...item }) => item));
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    const next = queueRef.current.find((item) => item.status === "queued");
    if (!next) return;
    running.current = true;
    activeId.current = next.id;
    const controller = new AbortController();
    stepAbort.current = controller;
    let confirming = false;
    const forget = () => {
      queueRef.current = queueRef.current.filter((item) => item.id !== next.id);
    };
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
      }, controller.signal);
      if (dropped.current.has(next.id)) {
        forget();
        return;
      }
      let lastPublish = 0;
      await putFile(
        target,
        next,
        (progress) => {
          next.progress = progress;
          const now = Date.now();
          if (progress === 100 || now - lastPublish > 200) {
            lastPublish = now;
            publish();
          }
        },
        (xhr) => {
          xhrRef.current = xhr;
          xhrOwner.current = next.id;
        },
      );
      if (dropped.current.has(next.id)) {
        forget();
        return;
      }
      confirming = true;
      await confirmUploadRef.current?.({
        name: next.name,
        size: next.size,
        type: next.type,
        content: next.content,
      }, controller.signal);
      dropped.current.delete(next.id);
      next.status = "success";
      next.progress = 100;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("file-next-uploaded"));
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      if ((!confirming && dropped.current.has(next.id)) || (confirming && aborted)) {
        forget();
        return;
      }
      next.status = "error";
      next.error = error instanceof Error ? error.message : "Upload failed";
    } finally {
      if (activeId.current === next.id) {
        activeId.current = null;
        stepAbort.current = null;
      }
      if (xhrOwner.current === next.id) {
        xhrRef.current = null;
        xhrOwner.current = null;
      }
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

  const dropIds = useCallback(
    (ids: ReadonlyArray<string>) => {
      if (ids.length === 0) return;
      for (const id of ids) dropped.current.add(id);
      if (xhrOwner.current && ids.includes(xhrOwner.current)) xhrRef.current?.abort();
      if (activeId.current && ids.includes(activeId.current)) stepAbort.current?.abort();
      const idSet = new Set(ids);
      // ponytail: row stays until the promise settles; a confirm that ignores AbortSignal still blocks the pump
      queueRef.current = queueRef.current.filter(
        (item) => !idSet.has(item.id) || item.id === activeId.current,
      );
      publish();
    },
    [publish],
  );

  const remove = useCallback((id: string) => dropIds([id]), [dropIds]);

  const cancel = useCallback(() => {
    dropIds(
      queueRef.current
        .filter((item) => item.status === "queued" || item.status === "uploading")
        .map((item) => item.id),
    );
  }, [dropIds]);

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

  return { items, enqueue, dismiss, cancel, remove, active };
}

function putFile(
  target: RequestUploadResult,
  file: InternalItem,
  onProgress: (progress: number) => void,
  onStart: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const xhr = new XMLHttpRequest();
    onStart(xhr);
    xhr.addEventListener("abort", () => finish(() => reject(new Error("aborted"))));
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
        finish(() => reject(new Error(message)));
        return;
      }
      finish(resolve);
    });
    xhr.addEventListener("error", () => {
      finish(() => reject(new Error("Upload failed")));
    });
    xhr.open(target.method ?? "PUT", target.url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    for (const [header, value] of Object.entries(target.headers ?? {})) {
      xhr.setRequestHeader(header, value);
    }
    xhr.send(file.content);
  });
}
