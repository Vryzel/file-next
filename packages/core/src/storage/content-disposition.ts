/**
 * A signed GET opened in a tab must not render as a page.
 * `inline` is kept only for types the preview can show without executing script.
 */
const NEVER_INLINE = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

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
