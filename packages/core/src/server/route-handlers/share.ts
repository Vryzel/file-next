/**
 * Public share download: GET /api/share/[token]
 * Streams the object through the app. The client never sees the bucket or key.
 */
import { asS3Key } from "@/types/branded";
import { signedContentDisposition } from "@/storage/content-disposition";
import type { FileSystem } from "@/storage/filesystem";
import type { MetadataStore } from "../../metadata/store";

/** Above this, the app redirects instead of buffering the object. */
const DEFAULT_MAX_SHARE_BYTES = 32 * 1024 * 1024;

export interface CreateShareRouteHandlerOptions {
  readonly store: MetadataStore;
  readonly fs: FileSystem;
  /** Bytes buffered through the app. Larger objects redirect to a 60s signed URL. */
  readonly maxBytes?: number;
}

const shareHeaders = (): Headers => {
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
};

const tokenFromRequest = (req: Request): string | null => {
  const url = new URL(req.url);
  const query = url.searchParams.get("token");
  if (query && query.length > 0) return query;
  const parts = url.pathname.replace(/\/+$/, "").split("/");
  const last = parts[parts.length - 1];
  if (!last || last === "share") return null;
  return last;
};

export const createShareRouteHandler = (
  opts: CreateShareRouteHandlerOptions,
): ((req: Request) => Promise<Response>) => {
  return async (req: Request): Promise<Response> => {
    const token = tokenFromRequest(req);
    if (!token) {
      return Response.json(
        { ok: false, error: { code: "InternalError", message: "Missing share token" } },
        { status: 400 },
      );
    }

    const resolved = await opts.store.resolveShare({ token });
    if (!resolved.ok) {
      return Response.json(
        { ok: false, error: { code: "InternalError", message: "Share lookup failed" } },
        { status: 500 },
      );
    }
    const node = resolved.value;
    if (!node || node.kind !== "file" || !node.s3Key) {
      return Response.json(
        { ok: false, error: { code: "NotFound", message: "Share not found" } },
        { status: 404 },
      );
    }

    const adapter = opts.fs.forTenant(node.tenantId).adapter;
    const download = new URL(req.url).searchParams.get("download") === "1";
    const key = asS3Key(node.s3Key);
    const st = await adapter.stat({ key });
    if (!st.ok) {
      return Response.json(
        { ok: false, error: { code: "NotFound", message: "Share not found" } },
        { status: 404 },
      );
    }
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_SHARE_BYTES;
    if (st.value.size > maxBytes) {
      const signed = await adapter.createPresignedDownloadUrl({
        key,
        expiresIn: 60,
        disposition: download ? "attachment" : "inline",
        contentType: st.value.contentType || node.mimeType,
      });
      if (!signed.ok) {
        return Response.json(
          { ok: false, error: { code: "InternalError", message: "Share failed" } },
          { status: 500 },
        );
      }
      const headers = shareHeaders();
      headers.set("Location", signed.value.url);
      return new Response(null, { status: 302, headers });
    }

    const read = await adapter.read({
      key,
      range: req.headers.get("range") ?? undefined,
    });
    if (!read.ok) {
      return Response.json(
        { ok: false, error: { code: "NotFound", message: "Share not found" } },
        { status: 404 },
      );
    }

    const headers = shareHeaders();
    const mime = st.value.contentType || node.mimeType || read.value.contentType || "application/octet-stream";
    headers.set("Content-Type", mime);
    const disposition = download ? "attachment" : signedContentDisposition("inline", mime);
    headers.set(
      "Content-Disposition",
      `${disposition}; filename*=UTF-8''${encodeURIComponent(node.name)}`,
    );
    const bytes = Uint8Array.from(read.value.body);
    headers.set("Content-Length", String(bytes.byteLength));

    return new Response(bytes.buffer, { status: 200, headers });
  };
};
