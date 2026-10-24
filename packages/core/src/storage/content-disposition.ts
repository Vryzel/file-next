/**
 * A signed GET opened in a tab must not render as a page.
 * `inline` is kept only for types the preview can show without executing script.
 */
const NEVER_INLINE = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

const DENIED_UPLOAD = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
]);

export function mimeBase(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isDeniedUploadType(contentType: string | undefined): boolean {
  return DENIED_UPLOAD.has(mimeBase(contentType));
}

/** `image/*` matches `image/png` and does not match `image/svg+xml`. */
export function matchesAllowedContentType(pattern: string, actual: string): boolean {
  const mime = mimeBase(actual);
  if (!mime || isDeniedUploadType(mime)) return false;
  if (pattern === mime) return true;
  if (pattern.endsWith("/*")) return mime.startsWith(pattern.slice(0, -1));
  return false;
}

export function signedContentDisposition(
  requested: "attachment" | "inline" | undefined,
  contentType?: string,
): "attachment" | "inline" {
  if (requested !== "inline") return "attachment";
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime || NEVER_INLINE.has(mime)) return "attachment";
  if (
    mime === "application/pdf" ||
    mime === "text/plain" ||
    mime === "text/csv" ||
    mime === "text/markdown" ||
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  ) {
    return "inline";
  }
  return "attachment";
}
