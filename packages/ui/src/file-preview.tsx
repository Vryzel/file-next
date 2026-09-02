"use client";

import type { FileNode } from "./types";
import { Overlay } from "./overlay";
import { useExplorerLabels } from "./labels";

export function canPreviewFile(file: Pick<FileNode, "mimeType" | "name">): boolean {
  return previewKind(file.mimeType, file.name) !== "none";
}

function previewKind(mimeType: string, name: string) {
  const mime = mimeType.toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext)) return "video";
  if (mime.startsWith("text/") || ["txt", "csv"].includes(ext)) return "text";
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
  if (!file) return null;
  const kind = previewKind(file.mimeType, file.name);

  return (
    <Overlay open onClose={onClose} className="max-w-4xl">
      <h2 className="truncate pr-6 text-base font-semibold">{file.name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {file.mimeType || labels.unknownType}
      </p>
      <div className="mt-3">
        {kind === "image" ? (
          <img
            src={src}
            alt={file.name}
            className="max-h-[70vh] w-full rounded-[10px] object-contain"
          />
        ) : kind === "pdf" || kind === "text" ? (
          <iframe
            src={src}
            title={file.name}
            className="h-[70vh] w-full rounded-[10px] border border-border bg-background"
          />
        ) : kind === "video" ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={src}
            className="max-h-[70vh] w-full rounded-[10px] bg-foreground"
          >
            {labels.previewUnavailable}
          </video>
        ) : (
          <p className="text-sm text-muted-foreground">{labels.previewUnavailable}</p>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[10px] border border-border px-3 text-sm"
          onClick={() => onDownload(file)}
        >
          {labels.download}
        </button>
      </div>
    </Overlay>
  );
}
