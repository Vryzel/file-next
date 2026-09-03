/**
 * Public share download: GET /api/share/[token]
 * Streams the object through the app. The client never sees the bucket or key.
 */
import { asS3Key } from "@/types/branded";
import type { FileSystem } from "@/storage/filesystem";
import type { MetadataStore } from "../../metadata/store";

export interface CreateShareRouteHandlerOptions {
  readonly store: MetadataStore;
  readonly fs: FileSystem;
}

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
        { ok: false, error: { code: resolved.error.code, message: resolved.error.message } },
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
    const rangeHeader = req.headers.get("range") ?? undefined;
    const read = await adapter.read({
      key: asS3Key(node.s3Key),
      range: rangeHeader ?? undefined,
    });
    if (!read.ok) {
      return Response.json(
        { ok: false, error: { code: read.error.code, message: read.error.message } },
        { status: 404 },
      );
    }

    const download = new URL(req.url).searchParams.get("download") === "1";
    const headers = new Headers();
    headers.set(
      "Content-Type",
      node.mimeType || read.value.contentType || "application/octet-stream",
    );
    headers.set(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(node.name)}`,
    );
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Length", String(read.value.body.byteLength));

    return new Response(Buffer.from(read.value.body), { status: 200, headers });
  };
};
