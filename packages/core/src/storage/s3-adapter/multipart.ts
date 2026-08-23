/**
 * Multipart upload primitives (v0.2) — `createMultipartUpload`,
 * `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload`.
 *
 * S3's chunked upload protocol is a four-step dance:
 *   1. `CreateMultipartUpload` returns an opaque `UploadId`.
 *   2. `UploadPart` (one or more) returns an `ETag` per chunk.
 *   3. `CompleteMultipartUpload` finalises the object by listing
 *      the parts in the caller's chosen order (S3 honours the
 *      caller's order; we do NOT pre-sort).
 *   4. On any failure, `AbortMultipartUpload` cleans up the
 *      unfinished state on the server (parts are billed until
 *      either complete or abort runs).
 *
 * Each helper is a thin pass-through to the corresponding AWS SDK
 * v3 command, with the standard `fromAws` error mapping (which
 * already covers `NoSuchUpload -> NotFound`, see
 * `src/errors/mappers.ts`).
 *
 * These four primitives are exposed individually so the higher-
 * level `write` method can compose them for bodies larger than one
 * part, but they are also public so server actions or stream-
 * multiplexers can drive the protocol themselves.
 */
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type {
  CreateMultipartUploadInput,
  CreateMultipartUploadOutput,
  UploadPartInput,
  UploadPartOutput,
  CompleteMultipartUploadInput,
  CompleteMultipartUploadOutput,
  AbortMultipartUploadInput,
  AbortMultipartUploadOutput,
} from "../adapter";

export const createMultipartUpload = async (
  client: S3Client,
  config: FileSystemConfig,
  input: CreateMultipartUploadInput,
): Promise<Result<CreateMultipartUploadOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
    return ok({
      uploadId: res.UploadId ?? "",
      key: input.key,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};

export const uploadPart = async (
  client: S3Client,
  config: FileSystemConfig,
  input: UploadPartInput,
): Promise<Result<UploadPartOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new UploadPartCommand({
        Bucket: config.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
        Body: input.body,
      }),
    );
    return ok({
      etag: res.ETag ?? "",
      partNumber: input.partNumber,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};

export const completeMultipartUpload = async (
  client: S3Client,
  config: FileSystemConfig,
  input: CompleteMultipartUploadInput,
): Promise<Result<CompleteMultipartUploadOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
    );
    return ok({
      etag: res.ETag,
      versionId: res.VersionId,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};

export const abortMultipartUpload = async (
  client: S3Client,
  config: FileSystemConfig,
  input: AbortMultipartUploadInput,
): Promise<Result<AbortMultipartUploadOutput, FileSystemError>> => {
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: config.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
    return ok({});
  } catch (e) {
    return err(fromAws(e));
  }
};
