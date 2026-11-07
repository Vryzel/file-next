"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import type { FileNode } from "./types";
import { useExplorerLabels } from "./labels";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function clampPreviewZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(scale) ? scale : 1));
}

export function canPreviewFile(file: Pick<FileNode, "mimeType" | "name">): boolean {
  return previewKind(file.mimeType, file.name) !== "none";
}

/**
 * Chrome's PDF viewer refuses every sandboxed frame, including allow-scripts.
 * A same-origin URL is re-framed as application/pdf so a host nonce CSP cannot
 * reach the viewer and a mislabeled HTML file is not executed.
 * Cross-origin URLs stay a direct frame: navigation does not need CORS.
 */
export function pdfFrameMode(src: string, pageOrigin: string): "blob" | "direct" {
  try {
    const url = new URL(src, pageOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "blob";
    return url.origin === new URL(pageOrigin).origin ? "blob" : "direct";
  } catch {
    return "blob";
  }
}

function previewKind(mimeType: string, name: string) {
  const mime = mimeType.toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "text/html" || mime === "application/xhtml+xml" || ext === "html" || ext === "htm") {
    return "none";
  }
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("video/") || ["mp4", "webm"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg"].includes(ext)) return "audio";
  if (mime.startsWith("text/") || ["txt", "csv", "md"].includes(ext)) return "text";
  return "none";
}

function PreviewSpinner({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="absolute inset-0 z-10 flex items-center justify-center">
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className="size-8 rounded-full border-2 border-white/25 border-t-white motion-safe:animate-spin"
      />
    </div>
  );
}

function PdfFrame({
  src,
  title,
  onClick,
}: {
  src: string;
  title: string;
  onClick: (event: React.SyntheticEvent) => void;
}) {
  const labels = useExplorerLabels();
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    setPainted(false);
    if (pdfFrameMode(src, window.location.origin) === "direct") {
      setFrameSrc(src);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let objectUrl: string | null = null;
    setFrameSrc(null);
    setFailed(false);
    // ponytail: buffers the file. The iframe cannot stream it: the host CSP would block Chrome's viewer.
    void fetch(src, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const blob = new Blob([await response.arrayBuffer()], { type: "application/pdf" });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFrameSrc(objectUrl);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) {
    return <p className="text-sm text-white/70">{labels.previewUnavailable}</p>;
  }

  return (
    <div className="relative h-full w-full max-w-5xl">
      {!painted ? <PreviewSpinner label={labels.loading} /> : null}
      {frameSrc ? (
        <iframe
          src={frameSrc}
          title={title}
          referrerPolicy="no-referrer"
          // A 1px hidden frame makes Chrome download the PDF instead of painting it.
          className="h-full w-full bg-white"
          onClick={onClick}
          onLoad={() => setPainted(true)}
          onError={() => setPainted(true)}
        />
      ) : null}
    </div>
  );
}

export function FilePreviewDialog({
  file,
  src,
  onClose,
  onDownload,
}: {
  file: FileNode | null;
  src: string;
  onClose: () => void;
  onDownload: (file: FileNode) => void;
}): React.ReactElement | null {
  const labels = useExplorerLabels();
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setReady(false);
    closeRef.current?.focus();
  }, [file?.id, src]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!file) return null;
  const kind = previewKind(file.mimeType, file.name);

  const zoom = (next: number) => {
    const clamped = clampPreviewZoom(next);
    setScale(clamped);
    if (clamped === 1) setPan({ x: 0, y: 0 });
  };

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className="fixed inset-0 z-50 bg-black/90 text-white"
      onClick={onClose}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-2" onClick={stop}>
        <p className="min-w-0 flex-1 truncate text-sm">{file.name}</p>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-full px-3 text-sm hover:bg-white/10"
          onClick={() => onDownload(file)}
        >
          {labels.download}
        </button>
        <button
          ref={closeRef}
          type="button"
          aria-label={labels.closePreview}
          className="inline-flex size-8 items-center justify-center rounded-full hover:bg-white/10"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="relative flex h-full w-full items-center justify-center px-4 pt-12 pb-16">
        {kind !== "pdf" && !ready ? <PreviewSpinner label={labels.loading} /> : null}
        {kind === "image" ? (
          <img
            src={src}
            alt={file.name}
            draggable={false}
            className={`max-h-full max-w-full cursor-zoom-in select-none object-contain ${ready ? "" : "absolute h-px w-px opacity-0"}`}
            onLoad={() => setReady(true)}
            onError={() => setReady(true)}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
            onClick={stop}
            onDoubleClick={(event) => {
              stop(event);
              zoom(scale === 1 ? 2 : 1);
            }}
            onWheel={(event) => {
              event.preventDefault();
              stop(event);
              zoom(scale + (event.deltaY < 0 ? 0.25 : -0.25));
            }}
            onPointerDown={(event) => {
              if (scale === 1) return;
              stop(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              setPan({
                x: drag.current.px + event.clientX - drag.current.x,
                y: drag.current.py + event.clientY - drag.current.y,
              });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        ) : kind === "pdf" ? (
          <PdfFrame src={src} title={file.name} onClick={stop} />
        ) : kind === "text" ? (
          <iframe
            src={src}
            title={file.name}
            sandbox=""
            referrerPolicy="no-referrer"
            className={
              ready
                ? "h-full w-full max-w-5xl bg-white"
                : "absolute h-px w-px max-w-5xl opacity-0"
            }
            onClick={stop}
            onLoad={() => setReady(true)}
            onError={() => setReady(true)}
          />
        ) : kind === "video" ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={src}
            className={`max-h-full max-w-full ${ready ? "" : "absolute h-px w-px opacity-0"}`}
            onClick={stop}
            onLoadedData={() => setReady(true)}
            onError={() => setReady(true)}
          >
            {labels.previewUnavailable}
          </video>
        ) : kind === "audio" ? (
          <audio
            controls
            preload="metadata"
            src={src}
            className={`w-full max-w-md ${ready ? "" : "absolute h-px w-px opacity-0"}`}
            onClick={stop}
            onLoadedMetadata={() => setReady(true)}
            onError={() => setReady(true)}
          />
        ) : (
          <p className="text-sm text-white/70">{labels.previewUnavailable}</p>
        )}
      </div>

      {kind === "image" ? (
        <div
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-1 py-1"
          onClick={stop}
        >
          <button
            type="button"
            aria-label={labels.zoomOut}
            className="inline-flex size-8 items-center justify-center rounded-full hover:bg-white/10"
            onClick={() => zoom(scale - 0.25)}
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={labels.zoomFit}
            className="min-w-14 px-2 text-xs tabular-nums"
            onClick={() => zoom(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            aria-label={labels.zoomIn}
            className="inline-flex size-8 items-center justify-center rounded-full hover:bg-white/10"
            onClick={() => zoom(scale + 0.25)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
