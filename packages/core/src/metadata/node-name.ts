/**
 * Display-name rules for files and folders.
 *
 * Metadata `path` is `parentPath + "/" + name`. A raw `/` in `name`
 * would split the tree. S3 keys are UUIDs, so the bucket is unaffected;
 * the store still has to keep names as a single path segment.
 *
 * 255 matches the common POSIX/Windows filename cap.
 */
import { err, ok, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";

export const NODE_NAME_MAX_LENGTH = 255;

export function normalizeNodeName(
  raw: string,
): Result<string, FileSystemError> {
  let name = raw.replace(/[\u0000-\u001F]/g, "").replace(/[/\\]/g, "-").trim();
  if (name === "" || name === "." || name === "..") {
    return err(
      new FileSystemError({
        code: "Conflict",
        message: "Invalid node name",
        retryable: false,
      }),
    );
  }
  if (name.length > NODE_NAME_MAX_LENGTH) {
    name = truncateNodeName(name, NODE_NAME_MAX_LENGTH);
  }
  return ok(name);
}

function truncateNodeName(name: string, max: number): string {
  const dot = name.lastIndexOf(".");
  const ext =
    dot > 0 && /^[a-zA-Z0-9]{1,8}$/.test(name.slice(dot + 1))
      ? name.slice(dot)
      : "";
  const stemMax = max - ext.length;
  if (stemMax < 1) return name.slice(0, max);
  return name.slice(0, stemMax) + ext;
}
