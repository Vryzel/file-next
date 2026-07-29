/**
 * Tests for the `write` S3 adapter method (v0.2).
 *
 * Auto-switch behavior:
 *   - body.byteLength <= 8 MiB (MULTIPART_PART_SIZE) -> single-PUT
 *     via PutObjectCommand (unchanged from v0.1)
 *   - body.byteLength >  8 MiB                      -> multipart
 *     via createMultipartUpload / uploadPart loop /
 *     completeMultipartUpload, sliced into 8 MiB parts with a
 *     smaller final part
 *
 * Compensation: any failure in the multipart path triggers
 * abortMultipartUpload before returning the error.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { writeObject, MULTIPART_PART_SIZE } from "@/storage/s3-adapter/write";
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

/** Build a Uint8Array of `n` bytes filled with the index modulo 256 — easy to assert on. */
const fillBytes = (n: number): Uint8Array => {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = i % 256;
  return buf;
};

describe("T-015: write — single-PUT path (body <= 8 MiB)", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: uploads a small object, returns etag", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "etag-abc", VersionId: "v-1" });

    const result = await writeObject(client, config, {
      key: asS3Key("uploads/hello.txt"),
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
      metadata: { author: "tester" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.etag).toBe("etag-abc");
    expect(result.value.versionId).toBe("v-1");
  });

  it("passes contentType and metadata through to PutObject", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "x" });

    await writeObject(client, config, {
      key: asS3Key("uploads/data.json"),
      body: new TextEncoder().encode("{}"),
      contentType: "application/json",
      metadata: { version: "1" },
    });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0]?.args[0]?.input.ContentType).toBe("application/json");
    expect(calls[0]?.args[0]?.input.Metadata).toEqual({ version: "1" });
  });

  it("body exactly 8 MiB: stays single-PUT (boundary is >, not >=)", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "x" });
    const body = fillBytes(MULTIPART_PART_SIZE);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/exact.bin"),
      body,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No multipart commands were issued.
    expect(s3Mock.commandCalls(CreateMultipartUploadCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(UploadPartCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(CompleteMultipartUploadCommand)).toHaveLength(0);
  });

  it("S3 error on PutObject: maps to FileSystemError via fromAws", async () => {
    s3Mock.on(PutObjectCommand).rejects({
      name: "AccessDenied",
      message: "Access Denied",
      $metadata: { httpStatusCode: 403 },
    });
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/x.txt"),
      body: new TextEncoder().encode("x"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("Forbidden");
  });
});

describe("T-015: write — multipart path (body > 8 MiB)", () => {
  beforeEach(() => s3Mock.reset());

  it("body > 8 MiB: switches to multipart, splits into 8 MiB chunks + smaller final", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-xyz" });
    s3Mock.on(UploadPartCommand).resolves({ ETag: "etag-part" });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({
      ETag: "etag-assembled",
      VersionId: "v-final",
    });

    // 8 MiB + 1 KiB: should split into two parts (8 MiB + 1 KiB).
    const PART = MULTIPART_PART_SIZE;
    const extra = 1024;
    const body = fillBytes(PART + extra);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/big.bin"),
      body,
      contentType: "application/octet-stream",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.etag).toBe("etag-assembled");
    expect(result.value.versionId).toBe("v-final");

    // PutObject was NOT called for the body (only multipart).
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);

    // Exactly 2 parts uploaded, in order.
    const partCalls = s3Mock.commandCalls(UploadPartCommand);
    expect(partCalls).toHaveLength(2);
    expect(partCalls[0]?.args[0]?.input.PartNumber).toBe(1);
    expect(partCalls[1]?.args[0]?.input.PartNumber).toBe(2);
    // First part is exactly 8 MiB; second is the remaining 1024 bytes.
    expect((partCalls[0]?.args[0]?.input.Body as Uint8Array).byteLength).toBe(PART);
    expect((partCalls[1]?.args[0]?.input.Body as Uint8Array).byteLength).toBe(extra);

    // Complete was called once, with both parts in caller order.
    const completeCalls = s3Mock.commandCalls(CompleteMultipartUploadCommand);
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]?.args[0]?.input.UploadId).toBe("upload-xyz");
    expect(completeCalls[0]?.args[0]?.input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: "etag-part" },
      { PartNumber: 2, ETag: "etag-part" },
    ]);
  });

  it("body of 24 MiB + 100 bytes: 4 parts of 8 MiB + 1 final 100-byte part", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-24" });
    s3Mock.on(UploadPartCommand).resolves({ ETag: "e" });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({ ETag: "e-final" });

    const PART = MULTIPART_PART_SIZE;
    const body = fillBytes(3 * PART + 100);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/24mib.bin"),
      body,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const partCalls = s3Mock.commandCalls(UploadPartCommand);
    expect(partCalls).toHaveLength(4);
    expect(partCalls.map((c) => c.args[0]?.input.PartNumber)).toEqual([1, 2, 3, 4]);
    expect((partCalls[0]?.args[0]?.input.Body as Uint8Array).byteLength).toBe(PART);
    expect((partCalls[1]?.args[0]?.input.Body as Uint8Array).byteLength).toBe(PART);
    expect((partCalls[2]?.args[0]?.input.Body as Uint8Array).byteLength).toBe(PART);
    expect((partCalls[3]?.args[0]?.input.Body as Uint8Array).byteLength).toBe(100);
  });

  it("part bytes match the source: the assembled parts cover the original body in order", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-bytes" });
    s3Mock.on(UploadPartCommand).resolves({ ETag: "e" });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({ ETag: "e-final" });

    const PART = MULTIPART_PART_SIZE;
    const body = fillBytes(PART + 7);
    await writeObject(client, config, {
      key: asS3Key("uploads/bytes.bin"),
      body,
    });

    const partCalls = s3Mock.commandCalls(UploadPartCommand);
    const p1 = partCalls[0]?.args[0]?.input.Body as Uint8Array;
    const p2 = partCalls[1]?.args[0]?.input.Body as Uint8Array;
    const reassembled = new Uint8Array(p1.byteLength + p2.byteLength);
    reassembled.set(p1, 0);
    reassembled.set(p2, p1.byteLength);
    expect(Array.from(reassembled)).toEqual(Array.from(body));
  });
});

describe("T-015: write — multipart compensation (abort on failure)", () => {
  beforeEach(() => s3Mock.reset());

  it("uploadPart failure: triggers abortMultipartUpload before returning the error", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-fail" });
    // First UploadPart succeeds (so the loop has progress to abort),
    // the second one fails. We need at least 2 parts for a second
    // call, so the body is 2 * 8 MiB + 1 byte.
    let partCallIndex = 0;
    s3Mock.on(UploadPartCommand).callsFake(() => {
      partCallIndex += 1;
      if (partCallIndex === 1) return Promise.resolve({ ETag: "ok" });
      return Promise.reject({
        name: "InternalError",
        message: "boom",
        $metadata: { httpStatusCode: 500 },
      });
    });
    s3Mock.on(AbortMultipartUploadCommand).resolves({});

    const body = fillBytes(2 * MULTIPART_PART_SIZE + 1);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/abort.bin"),
      body,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("InternalError");

    // The abort happened with the same uploadId and key.
    const abortCalls = s3Mock.commandCalls(AbortMultipartUploadCommand);
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0]?.args[0]?.input.UploadId).toBe("upload-fail");
    expect(abortCalls[0]?.args[0]?.input.Key).toBe("uploads/abort.bin");
  });

  it("completeMultipartUpload failure: triggers abortMultipartUpload before returning the error", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-complete-fail" });
    s3Mock.on(UploadPartCommand).resolves({ ETag: "ok" });
    s3Mock.on(CompleteMultipartUploadCommand).rejects({
      name: "InternalError",
      message: "complete boom",
      $metadata: { httpStatusCode: 500 },
    });
    s3Mock.on(AbortMultipartUploadCommand).resolves({});

    const body = fillBytes(MULTIPART_PART_SIZE + 1);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/complete-fail.bin"),
      body,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("InternalError");

    const abortCalls = s3Mock.commandCalls(AbortMultipartUploadCommand);
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0]?.args[0]?.input.UploadId).toBe("upload-complete-fail");
  });

  it("successful multipart write: does NOT issue abortMultipartUpload", async () => {
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: "upload-ok" });
    s3Mock.on(UploadPartCommand).resolves({ ETag: "e" });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({ ETag: "e-final" });
    // abort mock is intentionally NOT set — if write mistakenly
    // calls it, aws-sdk-client-mock will reject with an
    // unconfigured-call error.

    const body = fillBytes(MULTIPART_PART_SIZE + 1);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/ok.bin"),
      body,
    });
    expect(result.ok).toBe(true);
    expect(s3Mock.commandCalls(AbortMultipartUploadCommand)).toHaveLength(0);
  });
});
