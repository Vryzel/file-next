/**
 * `write` — single-PUT upload via `PutObjectCommand` (small bodies)
 * OR multipart upload via the v0.2 primitives (large bodies).
 *
 * Auto-switch (v0.2):
 *   - `data.byteLength <= MULTIPART_PART_SIZE` -> single-PUT path
 *     (unchanged from v0.1). Streams are always single-PUT.
 *   - `data.byteLength > MULTIPART_PART_SIZE`  -> multipart via
 *     `createMultipartUpload` / `uploadPart` loop /
 *     `completeMultipartUpload`, slicing the body into
 *     `MULTIPART_PART_SIZE` chunks with a smaller final part.
 *
 * Compensation (v0.2): if any of the three multipart steps fails
 * (create / a part upload / complete), we MUST `abortMultipartUpload`
 * before returning the error — otherwise the in-flight parts stay
 * on the server and continue to bill against the bucket. The latch
 * is a `try/finally` with `uploadId` captured after create succeeds
 * and `completed` flipped to true after complete succeeds; the
 * finally block aborts when an uploadId exists and complete hasn't
 * finished.
 *
 * The 5 GB v0.1 cap is REMOVED. v0.2 multipart lifts the
 * single-PUT ceiling; the only hard limit now is S3's 10,000-part
 * / 5 TiB-per-object maximum, which is well outside any realistic
 * server-action payload.
 */
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { WriteInput, WriteOutput } from "../adapter";
import {
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
} from "./multipart";

/** Multipart part size. 8 MiB — S3 minimum is 5 MiB; 8 MiB amortises request overhead and keeps the part count well under 10,000 for any realistic object. */
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

/** S3 single-PUT hard limit (kept for callers that want to know the boundary; `write` no longer enforces it). */
export const MAX_SINGLE_PUT_SIZE = 5 * 1024 * 1024 * 1024;

export const writeObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: WriteInput,
): Promise<Result<WriteOutput, FileSystemError>> => {
  // Auto-switch only triggers for Uint8Array bodies. Stream bodies
  // are sent as-is via single-PUT — the SDK will surface its own
  // error if the stream is too big.
  if (
    input.body instanceof Uint8Array &&
    input.body.byteLength > MULTIPART_PART_SIZE
  ) {
    return writeMultipart(client, config, input);
  }
  return writeSinglePut(client, config, input);
};

const writeSinglePut = async (
  client: S3Client,
  config: FileSystemConfig,
  input: WriteInput,
): Promise<Result<WriteOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
    return ok({
      etag: res.ETag ?? "",
      versionId: res.VersionId,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};

const writeMultipart = async (
  client: S3Client,
  config: FileSystemConfig,
  input: WriteInput,
): Promise<Result<WriteOutput, FileSystemError>> => {
  // The auto-switch guard guarantees this is a Uint8Array.
  const body = input.body as Uint8Array;
  const totalSize = body.byteLength;
  const chunkCount = Math.ceil(totalSize / MULTIPART_PART_SIZE);

  let uploadId: string | undefined;
  let completed = false;
  try {
    const create = await createMultipartUpload(client, config, {
      key: input.key,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    if (!create.ok) return err(create.error);
    uploadId = create.value.uploadId;

    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let i = 0; i < chunkCount; i++) {
      const start = i * MULTIPART_PART_SIZE;
      const end = Math.min(start + MULTIPART_PART_SIZE, totalSize);
      // .slice() copies the bytes into a fresh Uint8Array; the
      // stored part is never aliased to the caller's buffer.
      const chunk = body.slice(start, end);
      const up = await uploadPart(client, config, {
        key: input.key,
        uploadId,
        partNumber: i + 1,
        body: chunk,
      });
      if (!up.ok) return err(up.error);
      parts.push({ partNumber: i + 1, etag: up.value.etag });
    }

    const complete = await completeMultipartUpload(client, config, {
      key: input.key,
      uploadId,
      parts,
    });
    if (!complete.ok) return err(complete.error);
    completed = true;
    return ok({
      etag: complete.value.etag ?? "",
      versionId: complete.value.versionId,
    });
  } finally {
    // Compensate: if create succeeded (uploadId set) but complete
    // did not, abort so the server-side parts stop billing. Abort
    // failures are swallowed — the caller already has the original
    // error and an abort-failed error would only mask it.
    if (uploadId !== undefined && !completed) {
      await abortMultipartUpload(client, config, {
        key: input.key,
        uploadId,
      });
    }
  }
};
