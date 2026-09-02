"use client";

import {
  Archive,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  Music,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./cn";

export interface FileIconProps {
  readonly kind: "file" | "folder";
  readonly mimeType?: string;
  readonly className?: string;
}

export const FILE_ICON_MAP: Record<string, LucideIcon> = {
  "text/plain": FileText,
  "text/csv": FileText,
  "text/html": FileCode,
  "application/pdf": FileText,
  "application/json": FileCode,
  "application/xml": FileCode,
  "application/zip": Archive,
  "application/gzip": Archive,
  "application/x-tar": Archive,
  "application/x-7z-compressed": Archive,
  "image/png": FileImage,
  "image/jpeg": FileImage,
  "image/gif": FileImage,
  "image/webp": FileImage,
  "image/svg+xml": FileImage,
  "audio/mpeg": FileAudio,
  "audio/wav": FileAudio,
  "video/mp4": FileVideo,
  "video/webm": FileVideo,
  "text/javascript": FileCode,
  "audio/mp4": Music,
};

export function resolveFileIcon(mimeType: string | undefined): LucideIcon {
  if (!mimeType) return File;
  if (FILE_ICON_MAP[mimeType]) return FILE_ICON_MAP[mimeType]!;
  const prefix = mimeType.split("/")[0];
  if (prefix === "image") return FileImage;
  if (prefix === "audio") return FileAudio;
  if (prefix === "video") return FileVideo;
  if (prefix === "text") return FileText;
  return File;
}

export function FileIcon(props: FileIconProps): React.ReactElement {
  const { kind, mimeType, className } = props;
  const Icon = kind === "folder" ? Folder : resolveFileIcon(mimeType);
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        kind === "folder" ? "text-primary" : "text-muted-foreground",
        "size-5 shrink-0",
        className,
      )}
    />
  );
}
