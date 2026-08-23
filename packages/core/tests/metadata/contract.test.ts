import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createMemoryStore } from "@/metadata/memory-store";
import { createSqliteStore } from "@/metadata/sqlite-store";
import { createPostgresStore } from "@/metadata/postgres-store";
import { asS3Key, asTenantId, asUserId } from "@/types/branded";
import type { CreateNodeInput, MetadataStore } from "@/metadata/store";

const TEST_URL =
  process.env.POSTGRES_TEST_URL ??
  "postgres://file_next:file_next@localhost:5433/file_next";
const schema = `test_orphans_${randomUUID().replaceAll("-", "")}`;
const adminPool = new Pool({ connectionString: TEST_URL });

const stores: Array<[string, () => MetadataStore]> = [
  ["memory", () => createMemoryStore()],
  ["sqlite", () => createSqliteStore({ path: ":memory:" })],
  [
    "postgres",
    () => createPostgresStore({ connectionString: TEST_URL, schema }),
  ],
];

afterAll(async () => {
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminPool.end();
});

const makeFile = (
  tenantId: ReturnType<typeof asTenantId>,
  overrides: Partial<CreateNodeInput> = {},
): CreateNodeInput => ({
  tenantId,
  parentId: null,
  name: "alpha.txt",
  kind: "file",
  size: 13,
  mimeType: "text/plain",
  s3Key: "alpha.txt",
  ownerId: asUserId("user-1"),
  ...overrides,
});

const makeFolder = (
  tenantId: ReturnType<typeof asTenantId>,
  overrides: Partial<CreateNodeInput> = {},
): CreateNodeInput => ({
  tenantId,
  parentId: null,
  name: "f",
  kind: "folder",
  size: 0,
  mimeType: "",
  s3Key: "",
  ownerId: asUserId("user-1"),
  ...overrides,
});

describe.each(stores)("MetadataStore orphan contract — %s", (_, createStore) => {
  it("persists, lists, and deletes a tenant-scoped orphan", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    const s3Key = asS3Key("uploads/orphan.txt");
    const created = await store.enqueueOrphan({
      tenantId,
      s3Key,
      metadataId: "metadata-1",
      reason: "metadata insert failed",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const pending = await store.listPendingOrphans({ tenantId });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value).toEqual([
      expect.objectContaining({
        id: created.value.id,
        tenantId,
        s3Key,
        metadataId: "metadata-1",
        reason: "metadata insert failed",
        createdAt: expect.any(Date),
      }),
    ]);

    const deleted = await store.deleteOrphan({ tenantId, id: created.value.id });
    expect(deleted.ok).toBe(true);

    const empty = await store.listPendingOrphans({ tenantId });
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.value).toEqual([]);

    const missing = await store.deleteOrphan({ tenantId, id: created.value.id });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NotFound");
  });
});

describe.each(stores)("MetadataStore search contract — %s", (_, createStore) => {
  it("returns the inserted row for a basic case-insensitive match", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    await store.createNode(makeFile(tenantId, { name: "Alpha.txt" }));

    const r = await store.search({ tenantId, query: "ALPHA" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["Alpha.txt"]);
  });

  it("does not crash on FTS5 / LIKE special characters", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    await store.createNode(makeFile(tenantId, { name: "alpha.txt" }));

    const nasties = [
      "100%",
      "under_score",
      "(parens)",
      "*wild*",
      "name:foo",
      "foo AND bar",
      "foo OR bar",
      "foo NOT bar",
      "foo NEAR bar",
      'say "hi"',
    ];
    for (const q of nasties) {
      const r = await store.search({ tenantId, query: q });
      expect(r.ok, `query ${JSON.stringify(q)} should not crash`).toBe(true);
    }
  });

  it("scopes results to the parentId subtree when provided", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    await store.createNode(makeFile(tenantId, { name: "alpha-root.txt" }));
    const f = await store.createNode(makeFolder(tenantId, { name: "f" }));
    if (!f.ok) throw new Error("setup");
    await store.createNode(
      makeFile(tenantId, { parentId: f.value.id, name: "alpha-in-folder.txt" }),
    );

    const r = await store.search({ tenantId, query: "alpha", parentId: f.value.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha-in-folder.txt"]);
  });

  it("enforces tenant isolation — tenant A never sees tenant B's matches", async () => {
    const store = createStore();
    const tenantA = asTenantId(`tenant-a-${randomUUID()}`);
    const tenantB = asTenantId(`tenant-b-${randomUUID()}`);
    await store.createNode(makeFile(tenantA, { name: "shared.txt" }));
    await store.createNode(makeFile(tenantB, { name: "shared.txt" }));

    const a = await store.search({ tenantId: tenantA, query: "shared" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.items).toHaveLength(1);
    expect(a.value.items[0]?.tenantId).toBe(tenantA);
  });

  it("returns empty results for an empty query", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    await store.createNode(makeFile(tenantId, { name: "alpha.txt" }));

    const r = await store.search({ tenantId, query: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([]);
  });

  it("excludes soft-deleted nodes from search results", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    const a = await store.createNode(makeFile(tenantId, { name: "alpha.txt" }));
    if (!a.ok) throw new Error("setup");
    await store.createNode(makeFile(tenantId, { name: "alpha-draft.txt" }));
    await store.deleteNode({ tenantId, id: a.value.id });

    const r = await store.search({ tenantId, query: "alpha" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha-draft.txt"]);
  });

  it("reflects renames in the search index after moveNode", async () => {
    const store = createStore();
    const tenantId = asTenantId(`tenant-${randomUUID()}`);
    const a = await store.createNode(makeFile(tenantId, { name: "old-name.txt" }));
    if (!a.ok) throw new Error("setup");
    await store.moveNode({
      tenantId,
      id: a.value.id,
      newParentId: null,
      newName: "new-name.txt",
    });

    const oldR = await store.search({ tenantId, query: "old-name" });
    expect(oldR.ok).toBe(true);
    if (oldR.ok) expect(oldR.value.items).toEqual([]);

    const newR = await store.search({ tenantId, query: "new-name" });
    expect(newR.ok).toBe(true);
    if (newR.ok)
      expect(newR.value.items.map((n) => n.name)).toEqual(["new-name.txt"]);
  });
});
