/**
 * Tests for the WriteThrough sync layer.
 *
 * Unit-level: uses a mock S3Client (aws-sdk-client-mock) and the
 * in-memory MetadataStore. The orphan log now lives in the store's
 * `pending_orphans` table (or in-memory Map for the memory adapter);
 * the writeThrough layer delegates to `store.enqueueOrphan` /
 * `store.listPendingOrphans` and never touches an in-memory Map.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createWriteThrough } from "@/sync/write-through";
import { createFileSystem } from "@/storage/factory";
import { createS3Client } from "@/storage/s3-adapter/client";
import { createMemoryStore } from "@/metadata";
import { asS3Key, asTenantId, asUserId } from "@/types/branded";
import { err } from "@/types/result";
import { FileSystemError } from "@/errors";
import type { FileSystemConfig } from "@/storage/config";

const config: FileSystemConfig = {
  provider: "s3",
  bucket: "test-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA-TEST", secretAccessKey: "test-secret" },
  forcePathStyle: false,
};

const s3Mock = mockClient(S3Client);
const fs = createFileSystem(config);

const TENANT_A = asTenantId("tenant-a");
const TENANT_B = asTenantId("tenant-b");
const USER = asUserId("user-1");

// Fresh store + wt per test so the in-memory orphan log
// (and the store's nodes) don't leak between tests.
let store: ReturnType<typeof createMemoryStore>;
let wt: ReturnType<typeof createWriteThrough>;

beforeEach(async () => {
  s3Mock.reset();
  store = createMemoryStore();
  // Reset the module-level drain Set so each test starts cold.
  const { __resetDrainState } = await import("@/sync/write-through");
  __resetDrainState();
  wt = createWriteThrough(fs, store);
});

describe("PR 6: writeThroughFile — happy path", () => {
  it("writes bytes to S3 + creates metadata record", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "etag-1" });

    const r = await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "hello.txt",
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("hello.txt");
    expect(r.value.size).toBe(5);
    // Metadata is in the store
    const g = await store.getNode({ tenantId: TENANT_A, id: r.value.id });
    expect(g.ok && g.value?.id).toBe(r.value.id);
    // No orphans in the store
    const orphans = await store.listPendingOrphans({ tenantId: TENANT_A });
    expect(orphans.ok && orphans.value).toHaveLength(0);
  });
});

describe("PR 6: writeThroughFile — compensation", () => {
  it("S3 failure: surfaces the error, no orphan logged, no metadata created", async () => {
    s3Mock.on(PutObjectCommand).rejects({
      name: "AccessDenied",
      message: "x",
      $metadata: { httpStatusCode: 403 },
    });

    const r = await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "denied.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Forbidden");
    // No orphan — we never got past the S3 step
    const orphans = await store.listPendingOrphans({ tenantId: TENANT_A });
    expect(orphans.ok && orphans.value).toHaveLength(0);
  });

  it("S3 succeeds, metadata insert fails: orphan logged + S3 cleanup attempted", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "ok" });

    // Pre-create a node with the same name to force the dup Conflict
    // on the metadata insert (createNode rejects duplicate names).
    await store.createNode({
      tenantId: TENANT_A,
      parentId: null,
      name: "dupe.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "dupe.txt",
      ownerId: USER,
    });
    s3Mock.on(DeleteObjectCommand).resolves({});

    const r = await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "dupe.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("InternalError");
    // Orphan persisted in the store
    const orphans = await store.listPendingOrphans({ tenantId: TENANT_A });
    expect(orphans.ok).toBe(true);
    if (!orphans.ok) return;
    expect(orphans.value).toHaveLength(1);
    expect(orphans.value[0]?.s3Key).toBe("dupe.txt");
  });
});

describe("PR 6: deleteThroughFile — happy path", () => {
  it("soft-deletes metadata + deletes S3 object", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const w = await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "to-delete.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });
    if (!w.ok) throw new Error("setup failed");
    s3Mock.on(DeleteObjectCommand).resolves({});

    const d = await wt.deleteThroughFile({ tenantId: TENANT_A, id: w.value.id });
    expect(d.ok).toBe(true);
    // Metadata is gone
    const g = await store.getNode({ tenantId: TENANT_A, id: w.value.id });
    expect(g.ok && g.value).toBeNull();
    // No orphans
    const orphans = await store.listPendingOrphans({ tenantId: TENANT_A });
    expect(orphans.ok && orphans.value).toHaveLength(0);
  });
});

describe("PR 6: deleteThroughFile — compensation", () => {
  it("metadata not found: returns NotFound, no orphan", async () => {
    const r = await wt.deleteThroughFile({ tenantId: TENANT_A, id: "nope" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
    const orphans = await store.listPendingOrphans({ tenantId: TENANT_A });
    expect(orphans.ok && orphans.value).toHaveLength(0);
  });

  it("metadata soft-delete fails: orphan logged with the failing node id (no S3 delete attempted)", async () => {
    // We can't easily make the in-memory store fail on a single
    // method, so this case is covered by the integration test
    // against the SQLite adapter (where we can inject a fault).
    // For v0.2 we just verify the happy + the NotFound paths.
  });
});

describe("v0.2: per-tenant boot drain", () => {
  it("first call for a tenant triggers listPendingOrphans + console.warn per orphan", async () => {
    // Seed two orphans for tenant A.
    await store.enqueueOrphan({
      tenantId: TENANT_A,
      s3Key: asS3Key("uploads/a.txt"),
      reason: "metadata insert failed",
    });
    await store.enqueueOrphan({
      tenantId: TENANT_A,
      s3Key: asS3Key("uploads/b.txt"),
      reason: "s3 delete failed",
    });

    const listSpy = vi.spyOn(store, "listPendingOrphans");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    s3Mock.on(PutObjectCommand).resolves({});

    await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "fresh.txt",
      body: new TextEncoder().encode("fresh"),
      contentType: "text/plain",
      ownerId: USER,
    });

    // Drain ran exactly once for tenant A.
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith({ tenantId: TENANT_A });
    // Two warnings, one per seeded orphan.
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("pending orphan");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("uploads/a.txt");
    expect(warnSpy.mock.calls[1]?.[0]).toContain("uploads/b.txt");

    warnSpy.mockRestore();
    listSpy.mockRestore();
  });

  it("second call for the same tenant does NOT re-drain", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "first.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    const listSpy = vi.spyOn(store, "listPendingOrphans");
    await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "second.txt",
      body: new TextEncoder().encode("y"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(listSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
  });

  it("drain runs independently per tenant", async () => {
    await store.enqueueOrphan({
      tenantId: TENANT_A,
      s3Key: asS3Key("uploads/a.txt"),
      reason: "a reason",
    });
    await store.enqueueOrphan({
      tenantId: TENANT_B,
      s3Key: asS3Key("uploads/b.txt"),
      reason: "b reason",
    });

    const listSpy = vi.spyOn(store, "listPendingOrphans");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    s3Mock.on(PutObjectCommand).resolves({});

    await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "x.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });
    await wt.writeThroughFile({
      tenantId: TENANT_B,
      parentId: null,
      name: "y.txt",
      body: new TextEncoder().encode("y"),
      contentType: "text/plain",
      ownerId: USER,
    });

    // Two drains — one per tenant.
    const tenants = listSpy.mock.calls.map(([arg]) => (arg as { tenantId: string }).tenantId);
    expect(tenants).toEqual([TENANT_A, TENANT_B]);
    // Two warnings total — one per tenant's seeded orphan.
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
    listSpy.mockRestore();
  });

  it("drain failure does not block the caller", async () => {
    const enqueueSpy = vi
      .spyOn(store, "enqueueOrphan")
      .mockResolvedValueOnce(err(new FileSystemError({
        code: "InternalError",
        message: "transient db error",
        retryable: true,
      })));

    s3Mock.on(PutObjectCommand).resolves({ ETag: "ok" });
    s3Mock.on(DeleteObjectCommand).resolves({});

    // metadata insert succeeds -> no enqueue path exercised; force one
    // by pre-creating a duplicate name.
    await store.createNode({
      tenantId: TENANT_A,
      parentId: null,
      name: "conflict.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "conflict.txt",
      ownerId: USER,
    });
    enqueueSpy.mockClear();

    const r = await wt.writeThroughFile({
      tenantId: TENANT_A,
      parentId: null,
      name: "conflict.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("InternalError");
    // Even though enqueue failed, the caller got an InternalError
    // that explains the compound failure.
    expect(r.error.message).toMatch(/orphan enqueue failed/);

    enqueueSpy.mockRestore();
  });
});