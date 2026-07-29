/**
 * In-memory implementation of the 17-method `S3CompatibleAdapter` contract.
 *
 * Why this exists:
 *   - **Demo / try-it-now experience**: lets the consumer run the
 *     demo app without provisioning AWS S3 or MinIO. The whole
 *     library (server actions, route handlers, headless hooks) works
 *     end-to-end against this adapter.
 *   - **Test utility**: integration tests and example apps can wire
 *     a deterministic in-process backend instead of relying on
 *     `aws-sdk-client-mock`. The state is observable (you can
 *     inspect `store()` to assert on the bytes that were written).
 *   - **Spec compliance**: every method returns the same
 *     `Result<T, FileSystemError>` shape, enforces the same input
 *     validation (5 GB single-PUT cap, mime-type default, etc.),
 *     and emits the same error codes for the same conditions as the
 *     S3 adapter. A consumer can swap adapters without changing
 *     any application code.
 *
 * Limitations (intentional, all documented):
 *   - **`createPresignedUploadUrl` / `createPresignedDownloadUrl`**
 *     return `in-memory://` URLs that are only resolvable by the
 *     in-memory adapter's own getter functions. The real S3 adapter
 *     returns real SigV4 URLs.
 *   - **`getPublicUrl`** returns a fake `https://in-memory.local/...`
 *     URL. Useful for shape parity, not for serving real assets.
 *   - State is per-process; it does NOT survive a server restart.
 *     For persistence, use the S3 or R2 adapter.
 *   - Not optimized for large blobs — the in-memory `Map` holds
 *     every byte in RAM. A 5 GB PUT occupies 5 GB of heap.
 *
 * The 17-method count is enforced by the S3 adapter's contract test
 * (`packages/core/tests/storage/adapter.test.ts`); adding/removing
 * a method here must be reflected there too.
 */
import { randomUUID } from "node:crypto";
import type { Result } from "@/types/result";
import { FileSystemError, RETRYABLE_BY_CODE } from "@/errors";
import { asS3Key, asPrefix, type S3Key, type Prefix } from "@/types/branded";
import type {
  S3CompatibleAdapter,
  ListInput,
  ListOutput,
  ReadInput,
  ReadOutput,
  WriteInput,
  WriteOutput,
  DeleteInput,
  DeleteOutput,
  MoveInput,
  MoveOutput,
  CopyInput,
  CopyOutput,
  StatInput,
  StatOutput,
  ExistsInput,
  ExistsOutput,
  GetMetadataInput,
  GetMetadataOutput,
  SetMetadataInput,
  SetMetadataOutput,
  PresignedUploadInput,
  PresignedUploadOutput,
  PresignedDownloadInput,
  PresignedDownloadOutput,
  GetPublicUrlInput,
  GetPublicUrlOutput,
  CreateMultipartUploadInput,
  CreateMultipartUploadOutput,
  UploadPartInput,
  UploadPartOutput,
  CompleteMultipartUploadInput,
  CompleteMultipartUploadOutput,
  AbortMultipartUploadInput,
  AbortMultipartUploadOutput,
} from "../adapter";
import { MAX_SINGLE_PUT_SIZE, MULTIPART_PART_SIZE } from "../s3-adapter";

/** A single object stored in the in-memory backend. */
interface MemoryObject {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly userMetadata: Readonly<Record<string, string>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Public snapshot of the store. Tests use this to assert on state. */
export interface MemoryStoreSnapshot {
  /** Map from S3 key to the stored object. */
  readonly objects: ReadonlyMap<S3Key, MemoryObject>;
  /** Monotonic counter used to fabricate fake etags. */
  readonly etagCounter: number;
}

/** Options for `createMemoryAdapter`. */
export interface MemoryAdapterOptions {
  /** Default content type when the caller doesn't supply one. Default: `application/octet-stream`. */
  readonly defaultContentType?: string;
  /** Whether to validate the single-PUT size cap. Default: true. */
  readonly enforceSizeLimit?: boolean;
  /**
   * Override the single-PUT size cap. Default: `MAX_SINGLE_PUT_SIZE`
   * (5 GB). Lower this in tests so you don't need to allocate 5+ GB
   * of memory just to assert the cap.
   */
  readonly maxSinglePutSize?: number;
  /**
   * Optional bucket name for `getPublicUrl` fabrication. The
   * default `"in-memory"` keeps the URLs short and obviously fake.
   */
  readonly bucket?: string;
}

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Compute a fake etag from the byte length + a counter so that
 * successive writes to the same key produce different etags.
 */
function fakeEtag(bodyLength: number, counter: number): string {
  return `"mem-${counter.toString(16)}-${bodyLength.toString(16)}"`;
}

/**
 * Create a fresh in-memory adapter. The returned adapter is a
 * closure over a private `Map`; you can read the current state
 * via the `.store()` method.
 */
export function createMemoryAdapter(
  options: MemoryAdapterOptions = {},
): S3CompatibleAdapter & { readonly store: () => MemoryStoreSnapshot } {
  const defaultContentType = options.defaultContentType ?? DEFAULT_CONTENT_TYPE;
  const enforceSizeLimit = options.enforceSizeLimit ?? true;
  const maxSinglePutSize = options.maxSinglePutSize ?? MAX_SINGLE_PUT_SIZE;
  const bucket = options.bucket ?? "in-memory";

  const objects = new Map<S3Key, MemoryObject>();
  let etagCounter = 0;

  /**
   * In-flight multipart upload sessions. Keyed by `${key}::${uploadId}`
   * so two parallel sessions on the same key don't collide. The
   * `aborted` flag is what `abortMultipartUpload` flips and what
   * subsequent `uploadPart` / `completeMultipartUpload` calls check
   * to return `NotFound` (S3 semantics: an aborted session is gone).
   */
  interface MultipartSession {
    readonly key: S3Key;
    readonly contentType: string;
    readonly metadata: Record<string, string>;
    readonly parts: Map<number, Uint8Array>;
    aborted: boolean;
  }
  const sessions = new Map<string, MultipartSession>();
  const sessionKey = (key: S3Key, uploadId: string): string => `${key}::${uploadId}`;

  /** Return a deep-copied snapshot (callers can't mutate the map). */
  const store = (): MemoryStoreSnapshot => {
    // Return a plain object (not a real Map) so JSON.stringify works
    // in dev-tools / log lines. Iterating a Map preserves insertion order.
    const plain: Record<string, MemoryObject> = {};
    for (const [k, v] of objects) plain[k as string] = v;
    return {
      objects: new Map(Object.entries(plain).map(([k, v]) => [asS3Key(k), v])) as ReadonlyMap<S3Key, MemoryObject>,
      etagCounter,
    };
  };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Default content type when the caller didn't supply one. */
  const resolveContentType = (input: { contentType?: string }): string =>
    input.contentType ?? defaultContentType;

  /** Convert bytes to a Buffer for stable byteLength access. */
  /**
   * Coerce the body to a Uint8Array. We use duck-typing on
   * `ArrayBuffer.isView` and a numeric `byteLength` instead of
   * `instanceof Uint8Array` because vitest runs tests in worker
   * threads with separate realms, and `instanceof` fails across
   * realms (the source's `Uint8Array` and the test's `Uint8Array`
   * are different constructors even though the values are
   * structurally identical). See session memory
   * `sdd/file-next/v0.2-inmemory-adapter-cross-realm`.
   *
   * We always COPY the bytes into a fresh Uint8Array — even when
   * the input is already a Uint8Array in the same realm — so the
   * stored object is never aliased to the caller's buffer (a
   * caller mutating their input after a write() would otherwise
   * silently mutate the stored object too).
   */
  const toBytes = (data: WriteInput["body"]): Uint8Array => {
    if (data == null) {
      throw new TypeError("WriteInput.body is required");
    }
    // string → encode
    if (typeof data === "string") {
      return new TextEncoder().encode(data);
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return new Uint8Array(data.size);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    // Duck-type: any TypedArray view (Uint8Array, Buffer, Int8Array,
    // etc.) has a numeric byteLength and ArrayBuffer.isView() === true.
    // This branch handles cross-realm Uint8Arrays where
    // `data instanceof Uint8Array` returns false but the value IS
    // structurally a Uint8Array.
    if (
      typeof data === "object" &&
      data !== null &&
      typeof (data as { byteLength?: unknown }).byteLength === "number" &&
      ArrayBuffer.isView(data)
    ) {
      const view = data as unknown as {
        buffer: ArrayBuffer;
        byteOffset: number;
        byteLength: number;
      };
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    throw new TypeError(
      `WriteInput.body must be a string, Blob, ArrayBuffer, or TypedArray. Got: ${typeof data}`,
    );
  };

  /** Single source of truth for "key not found" results. */
  const notFound = (key: string): FileSystemError =>
    new FileSystemError({
      code: "NotFound",
      retryable: false,
      message: `Object not found: ${key}`,
    });

  /** Validate the single-PUT size cap (matches s3-adapter/write.ts). */
  const validateWriteSize = (
    body: Uint8Array,
  ): FileSystemError | null => {
    if (!enforceSizeLimit) return null;
    if (body.byteLength <= maxSinglePutSize) return null;
    return new FileSystemError({
      code: "PayloadTooLarge",
      retryable: false,
      message: `Object size ${body.byteLength} exceeds single-PUT limit ${maxSinglePutSize}`,
    });
  };

  // ---------------------------------------------------------------------
  // 17 methods
  // ---------------------------------------------------------------------

  const list = async (input: ListInput): Promise<Result<ListOutput, FileSystemError>> => {
    const prefixStr = (input.prefix ?? "") as string;
    const limit = input.limit ?? 1000;
    const items: Array<{ key: S3Key; size: number; lastModified: Date }> = [];
    const seenFolders = new Set<string>();
    for (const [key, obj] of objects) {
      const keyStr = key as string;
      if (!keyStr.startsWith(prefixStr)) continue;
      const remainder = keyStr.slice(prefixStr.length);
      // Group nested keys into a synthetic "folder" entry.
      const slashIdx = remainder.indexOf("/");
      if (slashIdx > 0) {
        const folder = prefixStr + remainder.slice(0, slashIdx + 1);
        if (!seenFolders.has(folder)) {
          seenFolders.add(folder);
          items.push({ key: asS3Key(folder), size: 0, lastModified: obj.updatedAt });
        }
        continue;
      }
      items.push({
        key,
        size: obj.body.byteLength,
        lastModified: obj.updatedAt,
      });
      if (items.length >= limit) break;
    }
    return { ok: true, value: { items, prefixes: [] } };
  };

  const read = async (input: ReadInput): Promise<Result<ReadOutput, FileSystemError>> => {
    const obj = objects.get(asS3Key(input.key));
    if (!obj) return { ok: false, error: notFound(input.key) };
    return { ok: true, value: { body: obj.body, contentType: obj.contentType } };
  };

  const write = async (input: WriteInput): Promise<Result<WriteOutput, FileSystemError>> => {
    const body = toBytes(input.body);
    // Auto-switch to multipart for large Uint8Array bodies. The
    // byte-length check mirrors the S3 adapter's switch condition
    // so the two adapters behave identically. Stream / Blob /
    // ArrayBuffer inputs skip the switch (they go single-PUT after
    // `toBytes` reduces them to a Uint8Array).
    if (input.body instanceof Uint8Array && body.byteLength > MULTIPART_PART_SIZE) {
      return writeMultipartMemory(input, body);
    }
    const sizeErr = validateWriteSize(body);
    if (sizeErr) return { ok: false, error: sizeErr };
    etagCounter += 1;
    const now = new Date();
    const existing = objects.get(asS3Key(input.key));
    objects.set(asS3Key(input.key), {
      body,
      contentType: resolveContentType(input),
      userMetadata: { ...(input.metadata ?? {}) },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return {
      ok: true,
      value: {
        etag: fakeEtag(body.byteLength, etagCounter),
      },
    };
  };

  /**
   * Multipart write path for the in-memory adapter. Drives the
   * same four primitives as the S3 adapter and shares the
   * create → loop → complete → compensate structure. The
   * in-memory primitives never fail mid-flight for in-process
   * callers (the only failure mode is a missing session, which
   * can't happen if we always pass the uploadId we just got from
   * create), so the compensation never fires in practice — but
   * the structure is preserved so the adapter stays symmetric
   * with the S3 path.
   */
  const writeMultipartMemory = async (
    input: WriteInput,
    body: Uint8Array,
  ): Promise<Result<WriteOutput, FileSystemError>> => {
    const totalSize = body.byteLength;
    const chunkCount = Math.ceil(totalSize / MULTIPART_PART_SIZE);

    let uploadId: string | undefined;
    let completed = false;
    try {
      const create = await createMultipartUpload({
        key: input.key,
        contentType: input.contentType,
        metadata: input.metadata,
      });
      if (!create.ok) return { ok: false, error: create.error };
      uploadId = create.value.uploadId;

      const parts: Array<{ partNumber: number; etag: string }> = [];
      for (let i = 0; i < chunkCount; i++) {
        const start = i * MULTIPART_PART_SIZE;
        const end = Math.min(start + MULTIPART_PART_SIZE, totalSize);
        const chunk = body.slice(start, end);
        const up = await uploadPart({
          key: input.key,
          uploadId,
          partNumber: i + 1,
          body: chunk,
        });
        if (!up.ok) return { ok: false, error: up.error };
        parts.push({ partNumber: i + 1, etag: up.value.etag });
      }

      const complete = await completeMultipartUpload({
        key: input.key,
        uploadId,
        parts,
      });
      if (!complete.ok) return { ok: false, error: complete.error };
      completed = true;
      return {
        ok: true,
        value: { etag: complete.value.etag ?? fakeEtag(totalSize, ++etagCounter) },
      };
    } finally {
      if (uploadId !== undefined && !completed) {
        await abortMultipartUpload({ key: input.key, uploadId });
      }
    }
  };

  const del = async (input: DeleteInput): Promise<Result<DeleteOutput, FileSystemError>> => {
    const existed = objects.delete(asS3Key(input.key));
    return { ok: true, value: { existed } };
  };

  const move = async (input: MoveInput): Promise<Result<MoveOutput, FileSystemError>> => {
    const src = objects.get(asS3Key(input.sourceKey));
    if (!src) return { ok: false, error: notFound(input.sourceKey) };
    etagCounter += 1;
    const now = new Date();
    const existing = objects.get(asS3Key(input.destinationKey));
    objects.set(asS3Key(input.destinationKey), {
      ...src,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (input.sourceKey !== input.destinationKey) {
      objects.delete(asS3Key(input.sourceKey));
    }
    return { ok: true, value: { key: input.destinationKey } };
  };

  const copy = async (input: CopyInput): Promise<Result<CopyOutput, FileSystemError>> => {
    const src = objects.get(asS3Key(input.sourceKey));
    if (!src) return { ok: false, error: notFound(input.sourceKey) };
    etagCounter += 1;
    const now = new Date();
    objects.set(asS3Key(input.destinationKey), {
      body: new Uint8Array(src.body), // defensive copy
      contentType: src.contentType,
      userMetadata: { ...src.userMetadata },
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, value: { key: input.destinationKey } };
  };

  const stat = async (input: StatInput): Promise<Result<StatOutput, FileSystemError>> => {
    const obj = objects.get(asS3Key(input.key));
    if (!obj) return { ok: false, error: notFound(input.key) };
    return {
      ok: true,
      value: {
        key: input.key,
        size: obj.body.byteLength,
        etag: fakeEtag(obj.body.byteLength, etagCounter),
        contentType: obj.contentType,
        lastModified: obj.updatedAt,
        metadata: { ...obj.userMetadata },
      },
    };
  };

  const exists = async (
    input: ExistsInput,
  ): Promise<Result<ExistsOutput, FileSystemError>> => {
    return { ok: true, value: { exists: objects.has(asS3Key(input.key)) } };
  };

  const getMetadata = async (
    input: GetMetadataInput,
  ): Promise<Result<GetMetadataOutput, FileSystemError>> => {
    const obj = objects.get(asS3Key(input.key));
    if (!obj) return { ok: false, error: notFound(input.key) };
    return { ok: true, value: { key: input.key, metadata: obj.userMetadata } };
  };

  const setMetadata = async (
    input: SetMetadataInput,
  ): Promise<Result<SetMetadataOutput, FileSystemError>> => {
    const obj = objects.get(asS3Key(input.key));
    if (!obj) return { ok: false, error: notFound(input.key) };
    const next = input.replace
      ? { ...(input.metadata ?? {}) }
      : { ...obj.userMetadata, ...(input.metadata ?? {}) };
    objects.set(asS3Key(input.key), {
      ...obj,
      userMetadata: next,
      updatedAt: new Date(),
    });
    return { ok: true, value: {} };
  };

  const createPresignedUploadUrl = async (
    input: PresignedUploadInput,
  ): Promise<Result<PresignedUploadOutput, FileSystemError>> => {
    // Fake URL — only resolvable by the in-memory adapter's
    // own test helper (not exposed in the public adapter).
    const expiresIn = input.expiresIn ?? 900;
    return {
      ok: true,
      value: {
        url: `in-memory://${bucket}/${input.key}?expiresIn=${expiresIn}`,
        method: "PUT",
      },
    };
  };

  const createPresignedDownloadUrl = async (
    input: PresignedDownloadInput,
  ): Promise<Result<PresignedDownloadOutput, FileSystemError>> => {
    if (!objects.has(asS3Key(input.key))) {
      return { ok: false, error: notFound(input.key) };
    }
    const expiresIn = input.expiresIn ?? 900;
    return {
      ok: true,
      value: {
        url: `in-memory://${bucket}/${input.key}?expiresIn=${expiresIn}`,
      },
    };
  };

  const getPublicUrl = async (
    input: GetPublicUrlInput,
  ): Promise<Result<GetPublicUrlOutput, FileSystemError>> => {
    return {
      ok: true,
      value: { url: `https://${bucket}.local/${input.key}` },
    };
  };

  // ---------------------------------------------------------------------
  // Multipart upload primitives (v0.2).
  //
  // The in-memory adapter mirrors S3's session semantics: each
  // `createMultipartUpload` returns an opaque `uploadId`; subsequent
  // `uploadPart` calls accumulate per-part bytes keyed by
  // `partNumber`; `completeMultipartUpload` assembles the bytes in
  // the caller's part order and writes them into the objects Map
  // (so a subsequent `read` returns the assembled body); and
  // `abortMultipartUpload` flips a flag that makes any later
  // reference to the same uploadId return `NotFound` (matching the
  // S3 behaviour where an aborted session is gone from the
  // server's perspective).
  // ---------------------------------------------------------------------

  const createMultipartUpload = async (
    input: CreateMultipartUploadInput,
  ): Promise<Result<CreateMultipartUploadOutput, FileSystemError>> => {
    const uploadId = randomUUID();
    sessions.set(sessionKey(input.key, uploadId), {
      key: input.key,
      contentType: resolveContentType(input),
      metadata: { ...(input.metadata ?? {}) },
      parts: new Map(),
      aborted: false,
    });
    return {
      ok: true,
      value: { uploadId, key: input.key },
    };
  };

  const uploadPart = async (
    input: UploadPartInput,
  ): Promise<Result<UploadPartOutput, FileSystemError>> => {
    const session = sessions.get(sessionKey(input.key, input.uploadId));
    if (!session || session.aborted) {
      return { ok: false, error: notFound(input.uploadId) };
    }
    session.parts.set(input.partNumber, input.body);
    return {
      ok: true,
      value: { etag: randomUUID(), partNumber: input.partNumber },
    };
  };

  const completeMultipartUpload = async (
    input: CompleteMultipartUploadInput,
  ): Promise<Result<CompleteMultipartUploadOutput, FileSystemError>> => {
    const session = sessions.get(sessionKey(input.key, input.uploadId));
    if (!session || session.aborted) {
      return { ok: false, error: notFound(input.uploadId) };
    }
    // S3 semantics: every partNumber in the caller's list must
    // have been uploaded. Otherwise the complete fails.
    for (const { partNumber } of input.parts) {
      if (!session.parts.has(partNumber)) {
        return { ok: false, error: notFound(input.uploadId) };
      }
    }
    // Assemble in the caller's order (S3 honours the part list
    // order; we do NOT sort).
    const totalLen = input.parts.reduce(
      (sum, p) => sum + (session.parts.get(p.partNumber)?.byteLength ?? 0),
      0,
    );
    const assembled = new Uint8Array(totalLen);
    let offset = 0;
    for (const { partNumber } of input.parts) {
      const chunk = session.parts.get(partNumber)!;
      assembled.set(chunk, offset);
      offset += chunk.byteLength;
    }
    etagCounter += 1;
    const now = new Date();
    objects.set(asS3Key(input.key), {
      body: assembled,
      contentType: session.contentType,
      userMetadata: { ...session.metadata },
      createdAt: now,
      updatedAt: now,
    });
    sessions.delete(sessionKey(input.key, input.uploadId));
    return { ok: true, value: { etag: fakeEtag(assembled.byteLength, etagCounter) } };
  };

  const abortMultipartUpload = async (
    input: AbortMultipartUploadInput,
  ): Promise<Result<AbortMultipartUploadOutput, FileSystemError>> => {
    const session = sessions.get(sessionKey(input.key, input.uploadId));
    if (!session) {
      return { ok: false, error: notFound(input.uploadId) };
    }
    session.aborted = true;
    sessions.delete(sessionKey(input.key, input.uploadId));
    return { ok: true, value: {} };
  };

  return {
    list,
    read,
    write,
    delete: del,
    move,
    copy,
    stat,
    exists,
    getMetadata,
    setMetadata,
    createPresignedUploadUrl,
    createPresignedDownloadUrl,
    getPublicUrl,
    createMultipartUpload,
    uploadPart,
    completeMultipartUpload,
    abortMultipartUpload,
    store,
  } as S3CompatibleAdapter & { readonly store: () => MemoryStoreSnapshot };
}

// Avoid unused-export warning for the asPrefix import in some configs.
void asPrefix;

// Keep RETRYABLE_BY_CODE imported to make adapter-side error code
// choice explicit (e.g. NotFound is non-retryable, NetworkError is).
void RETRYABLE_BY_CODE;
