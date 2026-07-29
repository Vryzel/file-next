/**
 * Tests for the multipart S3 adapter methods (v0.2):
 *   createMultipartUpload / uploadPart / completeMultipartUpload /
 * abortMultipartUpload.
 *
 * These are the four AWS-vocabulary primitives. The `write` method
 * composes them for bodies larger than one part (see write.test.ts);
 * here we test each primitive in isolation: wire shape of the SDK
 * command and error mapping (NoSuchUpload -> NotFound).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import {
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
} from "@/storage/s3-adapter/multipart";
import { asS3Key } from "@/types/branded";
import type { FileSystemConfig } from "@/storage/config";

const s3Mock = mockClient(S3Client);

const config: FileSystemConfig = {
  provider: "s3",
  bucket: "test-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA-TEST", secretAccessKey: "test-secret" },
  forcePathStyle: false,
};

const client = new S3Client({ region: "us-east-1" });

describe("createMultipartUpload — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: returns uploadId and key", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-123" });

    const result = await createMultipartUpload(client, config, {
      key: asS3Key("uploads/big.bin"),
      contentType: "application/octet-stream",
      metadata: { author: "tester" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.uploadId).toBe("upload-123");
    expect(result.value.key).toBe("uploads/big.bin");

    const calls = s3Mock.commandCalls(CreateMultipartUploadCommand);
    expect(calls[0]?.args[0]?.input.Bucket).toBe("test-bucket");
    expect(calls[0]?.args[0]?.input.Key).toBe("uploads/big.bin");
    expect(calls[0]?.args[0]?.input.ContentType).toBe("application/octet-stream");
    expect(calls[0]?.args[0]?.input.Metadata).toEqual({ author: "tester" });
  });

  it("S3 error: maps to FileSystemError via fromAws", async () => {
    s3Mock.on(CreateMultipartUploadCommand).rejects({
      name: "AccessDenied",
      message: "Access Denied",
      $metadata: { httpStatusCode: 403 },
    });
    const result = await createMultipartUpload(client, config, {
      key: asS3Key("uploads/x.bin"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("Forbidden");
  });
});

describe("uploadPart — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: returns etag and partNumber, wires UploadId/PartNumber/Body", async () => {
    s3Mock.on(UploadPartCommand).resolves({ ETag: "etag-part-1" });
    const body = new Uint8Array([1, 2, 3]);

    const result = await uploadPart(client, config, {
      key: asS3Key("uploads/big.bin"),
      uploadId: "upload-123",
      partNumber: 1,
      body,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.etag).toBe("etag-part-1");
    expect(result.value.partNumber).toBe(1);

    const calls = s3Mock.commandCalls(UploadPartCommand);
    expect(calls[0]?.args[0]?.input.UploadId).toBe("upload-123");
    expect(calls[0]?.args[0]?.input.PartNumber).toBe(1);
    expect(calls[0]?.args[0]?.input.Body).toBe(body);
  });

  it("unknown uploadId: maps NoSuchUpload -> NotFound", async () => {
    s3Mock.on(UploadPartCommand).rejects({
      name: "NoSuchUpload",
      message: "The specified upload does not exist.",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await uploadPart(client, config, {
      key: asS3Key("uploads/x.bin"),
      uploadId: "gone",
      partNumber: 1,
      body: new Uint8Array([0]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});

describe("completeMultipartUpload — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: maps parts to the S3 wire shape and returns the assembled etag", async () => {
    s3Mock
      .on(CompleteMultipartUploadCommand)
      .resolves({ ETag: "etag-assembled", VersionId: "v-9" });

    const result = await completeMultipartUpload(client, config, {
      key: asS3Key("uploads/big.bin"),
      uploadId: "upload-123",
      parts: [
        { partNumber: 1, etag: "etag-part-1" },
        { partNumber: 2, etag: "etag-part-2" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.etag).toBe("etag-assembled");
    expect(result.value.versionId).toBe("v-9");

    const calls = s3Mock.commandCalls(CompleteMultipartUploadCommand);
    expect(calls[0]?.args[0]?.input.UploadId).toBe("upload-123");
    expect(calls[0]?.args[0]?.input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: "etag-part-1" },
      { PartNumber: 2, ETag: "etag-part-2" },
    ]);
  });

  it("unknown uploadId: maps NoSuchUpload -> NotFound", async () => {
    s3Mock.on(CompleteMultipartUploadCommand).rejects({
      name: "NoSuchUpload",
      message: "The specified upload does not exist.",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await completeMultipartUpload(client, config, {
      key: asS3Key("uploads/x.bin"),
      uploadId: "gone",
      parts: [{ partNumber: 1, etag: "e" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});

describe("abortMultipartUpload — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: sends UploadId and returns ok", async () => {
    s3Mock.on(AbortMultipartUploadCommand).resolves({});
    const result = await abortMultipartUpload(client, config, {
      key: asS3Key("uploads/big.bin"),
      uploadId: "upload-123",
    });
    expect(result.ok).toBe(true);

    const calls = s3Mock.commandCalls(AbortMultipartUploadCommand);
    expect(calls[0]?.args[0]?.input.UploadId).toBe("upload-123");
    expect(calls[0]?.args[0]?.input.Key).toBe("uploads/big.bin");
  });

  it("unknown uploadId: maps NoSuchUpload -> NotFound", async () => {
    s3Mock.on(AbortMultipartUploadCommand).rejects({
      name: "NoSuchUpload",
      message: "The specified upload does not exist.",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await abortMultipartUpload(client, config, {
      key: asS3Key("uploads/x.bin"),
      uploadId: "gone",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});
