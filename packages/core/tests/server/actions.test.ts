/**
 * Tests for the 5 server actions.
 *
 * Unit-level: uses the in-memory metadata store + an in-memory
 * S3-compatible adapter (via a stub). Validates inputs (Zod
 * rejects bad input with a typed FileSystemError) and exercises
 * the happy + error paths.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createServerActions } from "@/server";
import { createMemoryStore, type MetadataStore, type FileNode } from "@/metadata";
import { createWriteThrough } from "@/sync";
import { asTenantId, asUserId } from "@/types/branded";
import type { FileSystem } from "@/storage/filesystem";
import type { S3CompatibleAdapter } from "@/storage/adapter";
import { ok, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";

// ---------------------------------------------------------------------------
// A minimal in-memory S3-compatible adapter for the test
// (no aws-sdk-client-mock needed; the actions only call a few
// methods: write, delete, list).
// ---------------------------------------------------------------------------

const makeMemoryFs = (): FileSystem => {
  const store = new Map<string, { body: Uint8Array; metadata: Record<string, string> }>();
  const adapter: S3CompatibleAdapter = {
    list: async (input) => {
      const prefix = (input.prefix ?? "") as string;
      return ok({
        items: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({ key: k as never, size: v.body.byteLength, lastModified: new Date(0) })),
        prefixes: [],
      });
    },
    read: async () => ({ ok: true, value: { body: new Uint8Array() } } as never),
    write: async (input) => {
      const body = input.body instanceof Uint8Array ? input.body : new Uint8Array();
      store.set(input.key, { body, metadata: input.metadata ?? {} });
      return ok({ etag: "x" } as never);
    },
    delete: async (input) => {
      store.delete(input.key);
      return ok({} as never);
    },
    move: async () => ok({} as never),
    copy: async () => ok({} as never),
    stat: async () => ok({ key: "" as never, size: 0, etag: "", contentType: "", lastModified: new Date(0), metadata: {} } as never),
    exists: async (input) => ok({ exists: store.has(input.key) } as never),
    getMetadata: async () => ok({} as never),
    setMetadata: async () => ok({} as never),
    createPresignedUploadUrl: async () => ok({ url: "x", method: "PUT" as const } as never),
    createPresignedDownloadUrl: async () => ok({ url: "x" } as never),
    getPublicUrl: async () => ok({ url: "x" } as never),
    createMultipartUpload: async () => ok({ uploadId: "u", key: "k" as never } as never),
    uploadPart: async () => ok({ etag: "e", partNumber: 1 } as never),
    completeMultipartUpload: async () => ok({} as never),
    abortMultipartUpload: async () => ok({} as never),
  };
  const fs: FileSystem = {
    adapter,
    config: { provider: "s3", bucket: "b", region: "r", credentials: { accessKeyId: "a", secretAccessKey: "b" }, forcePathStyle: false },
    metadata: undefined,
    forTenant: () => fs,
  };
  return fs;
};

const TENANT = asTenantId("tenant-a");
const USER = asUserId("user-1");

let store: MetadataStore;
let fs: FileSystem;
let wt: ReturnType<typeof createWriteThrough>;
let actions: ReturnType<typeof createServerActions>;

beforeEach(() => {
  store = createMemoryStore();
  fs = makeMemoryFs();
  wt = createWriteThrough(fs, store);
  actions = createServerActions({
    store,
    writeThrough: wt,
    fs,
    getAuth: () => ({ tenantId: TENANT, userId: USER }),
  });
});

describe("PR 7a: listFilesAction — metadata-first (no S3 call)", () => {
  it("returns the children of a folder", async () => {
    await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "a.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "a.txt",
      ownerId: USER,
    });
    await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "b.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "b.txt",
      ownerId: USER,
    });
    const r = await actions.listFiles({ parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("rejects bad input with a typed FileSystemError (Zod validation)", async () => {
    const r = await actions.listFiles({ parentId: 1 as never });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(FileSystemError);
    expect(r.error.code).toBe("InternalError");
    expect(r.error.cause?.code).toBe("ZodError");
  });
});

describe("PR 7a: deleteFileAction — cascades metadata + S3", () => {
  it("soft-deletes metadata + deletes the S3 object via writeThrough", async () => {
    // Seed a file via the adapter directly
    await fs.adapter.write({
      key: "to-del.txt" as never,
      body: new TextEncoder().encode("x"),
    });
    // Create the metadata record
    const c = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "to-del.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "to-del.txt",
      ownerId: USER,
    });
    if (!c.ok) throw new Error("setup");

    const d = await actions.deleteFile({ id: c.value.id });
    expect(d.ok).toBe(true);
    // Metadata is gone
    const g = await store.getNode({ tenantId: TENANT, id: c.value.id });
    expect(g.ok && g.value).toBeNull();
    // S3 object is gone
    const ex = await fs.adapter.exists({ key: "to-del.txt" as never });
    expect(ex.ok && ex.value.exists).toBe(false);
  });
});

describe("PR 7a: moveFileAction — metadata-only in v0.1", () => {
  it("updates the parent + name in the metadata store", async () => {
    const c = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "old.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "old.txt",
      ownerId: USER,
    });
    if (!c.ok) throw new Error("setup");
    const folder = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "dest",
      kind: "folder",
      size: 0,
      mimeType: "",
      s3Key: "",
      ownerId: USER,
    });
    if (!folder.ok) throw new Error("setup");

    const m = await actions.moveFile({
      id: c.value.id,
      newParentId: folder.value.id,
    });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value.parentId).toBe(folder.value.id);
    expect(m.value.name).toBe("old.txt");
    expect(m.value.path).toBe("/dest/old.txt");
  });
});

  describe("copyFileAction — copies bytes to a new key", () => {
  it("creates a new node with its own s3Key", async () => {
    const c = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "src.txt",
      kind: "file",
      size: 42,
      mimeType: "text/plain",
      s3Key: "src.txt",
      ownerId: USER,
    });
    if (!c.ok) throw new Error("setup");
    const folder = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "dest",
      kind: "folder",
      size: 0,
      mimeType: "",
      s3Key: "",
      ownerId: USER,
    });
    if (!folder.ok) throw new Error("setup");

    const r = await actions.copyFile({
      id: c.value.id,
      newParentId: folder.value.id,
      newName: "copy.txt",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("copy.txt");
    expect(r.value.s3Key).not.toBe("src.txt");
    expect(r.value.size).toBe(42);
  });

  it("returns NotFound for a missing source id", async () => {
    const r = await actions.copyFile({ id: "nope", newParentId: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("purgeNode", () => {
  it("hard-deletes a trashed file", async () => {
    const c = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "gone.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "gone.txt",
      ownerId: USER,
    });
    if (!c.ok) throw new Error("setup");
    await actions.deleteFile({ id: c.value.id });
    const purged = await actions.purgeNode({ id: c.value.id });
    expect(purged.ok).toBe(true);
    const trash = await actions.listTrash();
    expect(trash.ok && trash.value.items).toEqual([]);
  });

  it("returns NotFound for a live file", async () => {
    const c = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "live.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "live.txt",
      ownerId: USER,
    });
    if (!c.ok) throw new Error("setup");
    const r = await actions.purgeNode({ id: c.value.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("PR 7a: setMetadataAction — store.updateMetadata", () => {
  it("merges new metadata into existing", async () => {
    const c = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "x.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "x.txt",
      ownerId: USER,
      metadata: { a: "1" },
    });
    if (!c.ok) throw new Error("setup");
    const r = await actions.setMetadata({
      id: c.value.id,
      metadata: { b: "2" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ a: "1", b: "2" });
  });
});
