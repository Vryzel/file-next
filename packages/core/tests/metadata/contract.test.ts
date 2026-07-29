import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createMemoryStore } from "@/metadata/memory-store";
import { createSqliteStore } from "@/metadata/sqlite-store";
import { createPostgresStore } from "@/metadata/postgres-store";
import { asS3Key, asTenantId } from "@/types/branded";
import type { MetadataStore } from "@/metadata/store";

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
