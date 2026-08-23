"use client";

/**
 * `<FileIcon />` — mime-type-aware icon for files and folders.
 *
 * Spec:
 *   - Folders always render `FolderIcon` (regardless of mime).
 *   - Files resolve via a small mime → lucide map. Unrecognized
 *     mimes fall back to a generic file icon.
 *   - Color comes from semantic CSS vars (the consumer's theme).
 *   - Size scales with the consumer's parent via `size-*` classes.
 *
 * Architecture:
 *   - Pure presentational. No hook, no state.
 *   - The mapping table is exported so the consumer can extend it
 *     (e.g. add a custom mime → icon resolver).
 */
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
import { cn } from "@/lib/cn";

export interface FileIconProps {
  /** The node kind. Folders always render the folder icon. */
  readonly kind: "file" | "folder";
  /** MIME type (e.g. "image/png"). Only used when kind = "file". */
  readonly mimeType?: string;
  /** Optional className overrides (size, color, etc.). */
  readonly className?: string;
}

/**
 * MIME → icon mapping. Extracted so consumers can compose or
 * override (e.g. add custom icons for application/vnd.* types).
 */
export const FILE_ICON_MAP: Record<string, LucideIcon> = {
  // Text / documents
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
  "application/vnd.ms-excel": FileText,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileText,
  "application/vnd.ms-powerpoint": FileText,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": FileText,
  "application/msword": FileText,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileText,
  // Images
  "image/png": FileImage,
  "image/jpeg": FileImage,
  "image/gif": FileImage,
  "image/webp": FileImage,
  "image/svg+xml": FileImage,
  "image/bmp": FileImage,
  "image/heic": FileImage,
  // Audio
  "audio/mpeg": FileAudio,
  "audio/wav": FileAudio,
  "audio/ogg": FileAudio,
  "audio/flac": FileAudio,
  "audio/mp4": Music,
  // Video
  "video/mp4": FileVideo,
  "video/webm": FileVideo,
  "video/quicktime": FileVideo,
  // Code
  "text/javascript": FileCode,
  "text/typescript": FileCode,
  "text/x-python": FileCode,
  "text/x-shellscript": FileCode,
};

/**
 * Resolve an icon for a file based on its MIME type. Falls back
 * to `File` when the mime is missing or unrecognized.
 */
export function resolveFileIcon(mimeType: string | undefined): LucideIcon {
  if (!mimeType) return File;
  if (FILE_ICON_MAP[mimeType]) return FILE_ICON_MAP[mimeType]!;
  // Wildcard match: e.g. "image/*" → FileImage.
  const prefix = mimeType.split("/")[0];
  if (prefix === "image") return FileImage;
  if (prefix === "audio") return FileAudio;
  if (prefix === "video") return FileVideo;
  if (prefix === "text") return FileText;
  return File;
}

export function FileIcon(props: FileIconProps): React.ReactElement {
  const { kind, mimeType, className } = props;
  const Icon =
    kind === "folder"
      ? Folder
      : resolveFileIcon(mimeType);
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        kind === "folder" ? "text-amber-500" : "text-muted-foreground",
        "size-5 shrink-0",
        className,
      )}
    />
  );
}
