/**
 * `createUploadRouteHandler` — the Next.js Route Handler factory
 * for the presigned-URL upload flow.
 *
 * The client flow:
 *   1. Client POSTs `{ key, contentType, contentLength }` to this
 *      route (typically `/api/files/upload`).
 *   2. Route validates `contentLength` against `maxBytes` (413) and
 *      `contentType` against `allowedContentTypes` (415). No URL
 *      is signed on a rejected request.
 *   3. Route calls `fs.adapter.createPresignedUploadUrl({ key,
 *      contentType, expiresIn })` and returns `{ url, key,
 *      expiresAt }`.
 *   4. Client PUTs the file body to the signed URL (bypassing the
 *      Next.js server entirely).
 *
 * Spec scenarios: `route-handlers#1` (maxBytes), `route-handlers#2`
 * (allowedContentTypes).
 *
 * Construction-time validation: `expiresIn` is validated when the
 * factory is called (synchronous throw), per decision
 * `sdd/file-next/design/decision/expiresin-cap-timing`. A handler
 * built with `expiresIn: 30 * 86400` should never reach runtime —
 * the developer should see the error at server startup, not on
 * the first user request.
 */
import { z } from "zod";
import { FileSystemError } from "@/errors";
import { asS3Key } from "@/types/branded";
import type { FileSystem } from "@/storage/filesystem";
import type { AuthContext } from "../../auth/with-auth";
import {
  isDeniedUploadType,
  matchesAllowedContentType,
} from "@/storage/content-disposition";

/** S3 SigV4 presign hard cap. The SDK itself rejects anything longer. */
const MAX_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
/** Default 15 minutes — matches the adapter default and the AWS SDK default. */
const DEFAULT_EXPIRES_IN_SECONDS = 900;

const UploadBody = z.object({
  contentType: z.string().min(1).max(255),
  contentLength: z.number().int().nonnegative(),
});

export interface CreateUploadRouteHandlerOptions {
  readonly fs: FileSystem;
  /** Resolve the caller. Required unless `unsafeNoAuth` is set. */
  readonly getAuth?: (req: Request) => Promise<AuthContext | null>;
  /** Explicit opt-in for a handler that signs without a caller. */
  readonly unsafeNoAuth?: boolean;
  /** Reject requests whose `contentLength` exceeds this. Omit for no cap. */
  readonly maxBytes?: number;
  /**
   * Reject requests whose `contentType` is not in this list.
   * Each entry is a literal (`image/png`) or a wildcard (`image/*`).
   * Omit for no restriction.
   */
  readonly allowedContentTypes?: ReadonlyArray<string>;
  /** Presigned URL lifetime in seconds. Default 900, max 7d (S3 SigV4). */
  readonly expiresIn?: number;
}

export interface UploadRouteHandlerRequest {
  key: string;
  contentType: string;
  contentLength: number;
}

export interface UploadRouteHandlerResult {
  url: string;
  key: string;
  expiresAt: string;
}

/**
 * Validate `expiresIn` against the S3 SigV4 hard cap. Throws
 * `FileSystemError(InternalError)` with `cause.code: "InvalidArgument"`
 * if the value is out of range. The top-level code stays in the
 * closed 11-code catalog; the specific reason lives on `cause`.
 */
const assertExpiresIn = (expiresIn: number): void => {
  if (!Number.isFinite(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES_IN_SECONDS) {
    throw new FileSystemError({
      code: "InternalError",
      message: `expiresIn must be between 1 and ${MAX_EXPIRES_IN_SECONDS} seconds (S3 SigV4 limit)`,
      retryable: false,
      cause: { code: "InvalidArgument", message: `expiresIn=${expiresIn}` },
    });
  }
};

/**
 * Build a Next.js Route Handler `(req) => Response` that signs a
 * presigned upload URL after validating the request.
 */
export const createUploadRouteHandler = (
  opts: CreateUploadRouteHandlerOptions,
): ((req: Request) => Promise<Response>) => {
  if (!opts.getAuth && opts.unsafeNoAuth !== true) {
    throw new Error("file-next: getAuth is required");
  }
  const expiresIn = opts.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
  // Construction-time validation: fail-fast on misconfiguration.
  assertExpiresIn(expiresIn);

  return async (req: Request): Promise<Response> => {
    let fs = opts.fs;
    if (opts.getAuth) {
      const auth = await opts.getAuth(req);
      if (!auth) {
        return Response.json(
          { ok: false, error: { code: "Unauthorized", message: "Not authenticated" } },
          { status: 401 },
        );
      }
      fs = opts.fs.forTenant(auth.tenantId);
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json(
        { ok: false, error: { code: "InternalError", message: "Request body must be valid JSON" } },
        { status: 400 },
      );
    }
    const parsed = UploadBody.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: "InternalError", message: "Invalid upload request" } },
        { status: 400 },
      );
    }
    const body = parsed.data;

    if (typeof opts.maxBytes === "number" && body.contentLength > opts.maxBytes) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "PayloadTooLarge",
            message: `contentLength exceeds maxBytes ${opts.maxBytes}`,
          },
        },
        { status: 413 },
      );
    }

    if (
      isDeniedUploadType(body.contentType) ||
      (opts.allowedContentTypes &&
        opts.allowedContentTypes.length > 0 &&
        !opts.allowedContentTypes.some((pattern) =>
          matchesAllowedContentType(pattern, body.contentType),
        ))
    ) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "UnsupportedMediaType",
            message: "Content type is not allowed",
          },
        },
        { status: 415 },
      );
    }

    const id =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `upl-${Date.now()}`;
    const r = await fs.adapter.createPresignedUploadUrl({
      key: asS3Key(id),
      contentType: body.contentType,
      contentLength: body.contentLength,
      expiresIn,
    });
    if (!r.ok) {
      return Response.json(
        { ok: false, error: { code: r.error.code, message: "Upload failed" } },
        { status: 500 },
      );
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    return Response.json({
      ok: true,
      value: {
        url: r.value.url,
        key: id,
        id,
        method: r.value.method,
        headers: r.value.requiredHeaders ?? {},
        expiresAt,
      },
    });
  };
};
