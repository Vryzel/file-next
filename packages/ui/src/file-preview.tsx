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
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
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

      <div className="flex h-full items-center justify-center px-4 pt-12 pb-16">
        {kind === "image" ? (
          <img
            src={src}
            alt={file.name}
            draggable={false}
            className="max-h-full max-w-full cursor-zoom-in select-none object-contain"
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
        ) : kind === "pdf" || kind === "text" ? (
          <iframe
            src={src}
            title={file.name}
            className="h-full w-full max-w-5xl bg-white"
            onClick={stop}
          />
        ) : kind === "video" ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={src}
            className="max-h-full max-w-full"
            onClick={stop}
          >
            {labels.previewUnavailable}
          </video>
        ) : kind === "audio" ? (
          <audio controls preload="metadata" src={src} className="w-full max-w-md" onClick={stop} />
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
