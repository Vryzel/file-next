/**
 * Tests for the Postgres-backed `MetadataStore`.
 *
 * Each test FILE gets its own dedicated schema (random name) so
 * parallel test runs don't collide. The schema is created in
 * `beforeAll` and dropped in `afterAll`. Inside a file, every
 * test uses a unique tenant + node names so they don't conflict.
 *
 * Requirements:
 *   - Postgres reachable via env POSTGRES_TEST_URL
 *     (default: postgres://file_next:file_next@localhost:5433/file_next)
 *   - docker compose -f docker-compose.yml up (in the test project)
 *
 * Coverage mirrors the SQLite store: all 9 methods, tenant
 * isolation, soft-delete cascade, conflict detection, recursive
 * CTE for getPath, ILIKE search, JSONB metadata merge.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  createPostgresStore,
  type PostgresStoreOptions,
} from "@/metadata/postgres-store";
import { asTenantId, asUserId } from "@/types/branded";
import type {
  CreateNodeInput,
  MetadataStore,
} from "@/metadata/store";

const TEST_URL =
  process.env.POSTGRES_TEST_URL ??
  "postgres://file_next:file_next@localhost:5433/file_next";

// Per-file schema. All nodes for every test in this file live
// inside this schema.
const SCHEMA = `test_${randomUUID().replaceAll("-", "")}`;

const TENANT_A = asTenantId("acme");
const TENANT_B = asTenantId("globex");
const USER = asUserId("user-1");

const baseFileInput = (
  overrides: Partial<CreateNodeInput> = {},
): CreateNodeInput => ({
  tenantId: TENANT_A,
  parentId: null,
  name: `hello-${randomUUID().slice(0, 8)}.txt`,
  kind: "file",
  size: 13,
  mimeType: "text/plain",
  s3Key: "hello.txt",
  ownerId: USER,
  ...overrides,
});

const baseFolderInput = (
  overrides: Partial<CreateNodeInput> = {},
): CreateNodeInput => ({
  tenantId: TENANT_A,
  parentId: null,
  name: `docs-${randomUUID().slice(0, 8)}`,
  kind: "folder",
  size: 0,
  mimeType: "",
  s3Key: "",
  ownerId: USER,
  ...overrides,
});

let store: MetadataStore;
let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: TEST_URL });
  store = createPostgresStore({
    connectionString: TEST_URL,
    schema: SCHEMA,
  } as PostgresStoreOptions);
  // Force schema creation by running one method.
  await store.listChildren({ tenantId: TENANT_A, parentId: null });
});

afterAll(async () => {
  // Drop the schema + all its objects, then close pools.
  await adminPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await adminPool.end();
  // The store's internal pool isn't exposed; force GC by ending
  // every active pool. Easier: just rely on vitest's process exit.
});

beforeEach(async () => {
  // Wipe the schema between tests for isolation. Faster than
  // DROP+CREATE and keeps the prepared-statement caches warm.
  await adminPool.query(`TRUNCATE TABLE "${SCHEMA}".nodes`);
});

describe("createPostgresStore — createNode", () => {
  it("creates a file at root and returns it", async () => {
    const r = await store.createNode(baseFileInput({ name: "hello.txt" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.value.name).toBe("hello.txt");
    expect(r.value.path).toBe("/hello.txt");
    expect(r.value.parentId).toBeNull();
    expect(r.value.size).toBe(13);
    expect(r.value.deletedAt).toBeNull();
  });

  it("creates a folder with zero size and empty s3Key", async () => {
    const r = await store.createNode(baseFolderInput({ name: "docs" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("folder");
    expect(r.value.size).toBe(0);
    expect(r.value.s3Key).toBe("");
  });

  it("creates a child file with the correct materialized path", async () => {
    const folder = await ok(store.createNode(baseFolderInput({ name: "docs" })));
    const r = await store.createNode(
      baseFileInput({ parentId: folder.id, name: "hello.txt" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.path).toBe("/docs/hello.txt");
  });

  it("returns Conflict on duplicate name in same parent", async () => {
    await ok(store.createNode(baseFileInput({ name: "same.txt" })));
    const r = await store.createNode(baseFileInput({ name: "same.txt" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("allows the same name in different parents", async () => {
    const a = await ok(store.createNode(baseFolderInput({ name: "a" })));
    const b = await ok(store.createNode(baseFolderInput({ name: "b" })));
    const r1 = await store.createNode(baseFileInput({ parentId: a.id, name: "x.txt" }));
    const r2 = await store.createNode(baseFileInput({ parentId: b.id, name: "x.txt" }));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("returns NotFound when parent does not exist", async () => {
    const r = await store.createNode(baseFileInput({ parentId: randomUUID() }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });

  it("returns Conflict when parent is a file", async () => {
    const file = await ok(store.createNode(baseFileInput({ name: "x.txt" })));
    const r = await store.createNode(
      baseFileInput({ parentId: file.id, name: "child.txt" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("persists custom metadata as JSONB", async () => {
    const r = await store.createNode(
      baseFileInput({ metadata: { source: "test", tag: "v1" } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ source: "test", tag: "v1" });
  });
});

describe("createPostgresStore — getNode", () => {
  it("returns null for unknown id", async () => {
    const r = await store.getNode({ tenantId: TENANT_A, id: randomUUID() });
    if (!r.ok) throw new Error("get failed");
    expect(r.value).toBeNull();
  });

  it("returns null for cross-tenant access", async () => {
    const created = await ok(store.createNode(baseFileInput()));
    const r = await store.getNode({ tenantId: TENANT_B, id: created.id });
    if (!r.ok) throw new Error("get failed");
    expect(r.value).toBeNull();
  });

  it("returns null for soft-deleted nodes", async () => {
    const created = await ok(store.createNode(baseFileInput()));
    const del = await store.deleteNode({ tenantId: TENANT_A, id: created.id });
    expect(del.ok).toBe(true);
    const r = await store.getNode({ tenantId: TENANT_A, id: created.id });
    if (!r.ok) throw new Error("get failed");
    expect(r.value).toBeNull();
  });
});

describe("createPostgresStore — listChildren", () => {
  it("returns empty list when folder has no children", async () => {
    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([]);
  });

  it("orders children by name (case-insensitive)", async () => {
    await ok(store.createNode(baseFileInput({ name: "banana.txt" })));
    await ok(store.createNode(baseFileInput({ name: "Apple.txt" })));
    await ok(store.createNode(baseFileInput({ name: "cherry.txt" })));

    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    if (!r.ok) throw new Error("list failed");
    expect(r.value.items.map((n) => n.name)).toEqual(["Apple.txt", "banana.txt", "cherry.txt"]);
  });

  it("excludes soft-deleted children", async () => {
    const a = await ok(store.createNode(baseFileInput({ name: "a.txt" })));
    await ok(store.createNode(baseFileInput({ name: "b.txt" })));
    await store.deleteNode({ tenantId: TENANT_A, id: a.id });

    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    if (!r.ok) throw new Error("list failed");
    expect(r.value.items.map((n) => n.name)).toEqual(["b.txt"]);
  });

  it("returns nextCursor when more rows exist past the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await ok(store.createNode(baseFileInput({ name: `f-${i}.txt` })));
    }
    const r = await store.listChildren({
      tenantId: TENANT_A,
      parentId: null,
      limit: 2,
    });
    if (!r.ok) throw new Error("list failed");
    expect(r.value.items).toHaveLength(2);
    expect(r.value.nextCursor).toBe("2");
  });
});

describe("createPostgresStore — moveNode", () => {
  it("renames a node and updates its path", async () => {
    const created = await ok(store.createNode(baseFileInput({ name: "old.txt" })));
    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: created.id,
      newParentId: null,
      newName: "new.txt",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("new.txt");
    expect(r.value.path).toBe("/new.txt");
  });

  it("reparents a node and updates its path", async () => {
    const file = await ok(store.createNode(baseFileInput({ name: "f.txt" })));
    const folder = await ok(store.createNode(baseFolderInput({ name: "dest" })));
    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: file.id,
      newParentId: folder.id,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parentId).toBe(folder.id);
    expect(r.value.path).toBe("/dest/f.txt");
  });

  it("cascades path updates to descendants on move", async () => {
    const folder = await ok(store.createNode(baseFolderInput({ name: "src" })));
    const sub = await ok(
      store.createNode(baseFolderInput({ parentId: folder.id, name: "sub" })),
    );
    const leaf = await ok(
      store.createNode(baseFileInput({ parentId: sub.id, name: "b.txt" })),
    );
    const dest = await ok(store.createNode(baseFolderInput({ name: "dest" })));

    await store.moveNode({
      tenantId: TENANT_A,
      id: folder.id,
      newParentId: dest.id,
    });

    const leafAfter = await store.getNode({ tenantId: TENANT_A, id: leaf.id });
    if (!leafAfter.ok || !leafAfter.value) throw new Error("leaf missing");
    expect(leafAfter.value.path).toBe("/dest/src/sub/b.txt");
  });

  it("preserves nested names with the same string as the moved prefix", async () => {
    // /src + move /src → /dst. A child named "src" inside /src
    // should become /dst/src (not /dst/dst).
    const src = await ok(store.createNode(baseFolderInput({ name: "src" })));
    await ok(store.createNode(baseFileInput({ parentId: src.id, name: "src" })));
    const dst = await ok(store.createNode(baseFolderInput({ name: "dst" })));

    await store.moveNode({
      tenantId: TENANT_A,
      id: src.id,
      newParentId: dst.id,
    });

    const movedSrc = await store.getNode({ tenantId: TENANT_A, id: src.id });
    if (!movedSrc.ok || !movedSrc.value) throw new Error("missing");
    expect(movedSrc.value.path).toBe("/dst/src");

    const list = await store.listChildren({ tenantId: TENANT_A, parentId: movedSrc.value.id });
    if (!list.ok) throw new Error("list failed");
    expect(list.value.items[0]?.name).toBe("src");
    expect(list.value.items[0]?.path).toBe("/dst/src/src");
  });

  it("rejects cycle: cannot move a folder into its own descendant", async () => {
    const parent = await ok(store.createNode(baseFolderInput({ name: "p" })));
    const child = await ok(
      store.createNode(baseFolderInput({ parentId: parent.id, name: "c" })),
    );
    const grand = await ok(
      store.createNode(baseFolderInput({ parentId: child.id, name: "g" })),
    );

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: parent.id,
      newParentId: grand.id,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("rejects self-move", async () => {
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })));
    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: f.id,
      newParentId: f.id,
    });
    expect(r.ok).toBe(false);
  });

  it("returns Conflict when destination has a same-named sibling", async () => {
    const folder = await ok(store.createNode(baseFolderInput({ name: "f" })));
    await ok(store.createNode(baseFileInput({ parentId: folder.id, name: "x.txt" })));
    const file = await ok(store.createNode(baseFileInput({ name: "x.txt" })));

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: file.id,
      newParentId: folder.id,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("returns NotFound when target id is unknown", async () => {
    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: randomUUID(),
      newParentId: null,
      newName: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createPostgresStore — deleteNode", () => {
  it("soft-deletes a file", async () => {
    const f = await ok(store.createNode(baseFileInput()));
    const del = await store.deleteNode({ tenantId: TENANT_A, id: f.id });
    expect(del.ok).toBe(true);
    const after = await store.getNode({ tenantId: TENANT_A, id: f.id });
    if (!after.ok) throw new Error("get failed");
    expect(after.value).toBeNull();
  });

  it("rejects non-recursive delete on a non-empty folder", async () => {
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })));
    await ok(store.createNode(baseFileInput({ parentId: f.id, name: "x.txt" })));
    const r = await store.deleteNode({ tenantId: TENANT_A, id: f.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("cascades soft-delete on recursive delete", async () => {
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })));
    const sub = await ok(
      store.createNode(baseFolderInput({ parentId: f.id, name: "sub" })),
    );
    const leaf = await ok(
      store.createNode(baseFileInput({ parentId: sub.id, name: "g.txt" })),
    );
    const r = await store.deleteNode({
      tenantId: TENANT_A,
      id: f.id,
      recursive: true,
    });
    expect(r.ok).toBe(true);
    for (const id of [f.id, sub.id, leaf.id]) {
      const after = await store.getNode({ tenantId: TENANT_A, id });
      if (!after.ok) throw new Error("get failed");
      expect(after.value).toBeNull();
    }
  });

  it("frees the name so a new node can be created in the same parent", async () => {
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })));
    await ok(store.createNode(baseFileInput({ parentId: f.id, name: "ghost.txt" })));
    const list = await store.listChildren({ tenantId: TENANT_A, parentId: f.id });
    if (!list.ok) throw new Error("list failed");
    const ghost = list.value.items[0];
    if (!ghost) throw new Error("ghost missing");
    await store.deleteNode({ tenantId: TENANT_A, id: ghost.id });
    const reborn = await store.createNode(
      baseFileInput({ parentId: f.id, name: "ghost.txt" }),
    );
    expect(reborn.ok).toBe(true);
  });

  it("returns NotFound on a missing id", async () => {
    const r = await store.deleteNode({ tenantId: TENANT_A, id: randomUUID() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createPostgresStore — updateMetadata", () => {
  it("merges by default via JSONB ||", async () => {
    const f = await ok(
      store.createNode(baseFileInput({ metadata: { a: "1", b: "2" } })),
    );
    const r = await store.updateMetadata({
      tenantId: TENANT_A,
      id: f.id,
      metadata: { b: "3", c: "4" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ a: "1", b: "3", c: "4" });
  });

  it("replaces when replace is true", async () => {
    const f = await ok(
      store.createNode(baseFileInput({ metadata: { a: "1" } })),
    );
    const r = await store.updateMetadata({
      tenantId: TENANT_A,
      id: f.id,
      metadata: { z: "9" },
      replace: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ z: "9" });
  });

  it("returns NotFound for missing id", async () => {
    const r = await store.updateMetadata({
      tenantId: TENANT_A,
      id: randomUUID(),
      metadata: { x: "1" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createPostgresStore — search", () => {
  it("finds matches case-insensitively (ILIKE)", async () => {
    await ok(store.createNode(baseFileInput({ name: "Alpha.txt" })));
    await ok(store.createNode(baseFileInput({ name: "beta.txt" })));
    await ok(store.createNode(baseFileInput({ name: "gamma.txt" })));

    const r = await store.search({ tenantId: TENANT_A, query: "ALPHA" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["Alpha.txt"]);
  });

  it("matches substring", async () => {
    await ok(store.createNode(baseFileInput({ name: "report-2026.pdf" })));
    await ok(store.createNode(baseFileInput({ name: "summary.txt" })));
    const r = await store.search({ tenantId: TENANT_A, query: "2026" });
    if (!r.ok) throw new Error("search failed");
    expect(r.value.items.map((n) => n.name)).toEqual(["report-2026.pdf"]);
  });

  it("scopes to a folder subtree when parentId is set", async () => {
    const root = await ok(store.createNode(baseFileInput({ name: "alpha-root.txt" })));
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })));
    await ok(store.createNode(baseFileInput({ parentId: f.id, name: "alpha-in-folder.txt" })));
    await ok(store.createNode(baseFileInput({ parentId: f.id, name: "beta.txt" })));

    const r = await store.search({ tenantId: TENANT_A, query: "alpha", parentId: f.id });
    if (!r.ok) throw new Error("search failed");
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha-in-folder.txt"]);
  });

  it("treats global search as the whole tenant", async () => {
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })));
    await ok(store.createNode(baseFileInput({ parentId: f.id, name: "alpha-in-folder.txt" })));
    await ok(store.createNode(baseFileInput({ name: "alpha-root.txt" })));

    const r = await store.search({ tenantId: TENANT_A, query: "alpha" });
    if (!r.ok) throw new Error("search failed");
    expect(r.value.items.map((n) => n.name).sort()).toEqual([
      "alpha-in-folder.txt",
      "alpha-root.txt",
    ]);
  });

  it("escapes LIKE wildcards in the query", async () => {
    await ok(store.createNode(baseFileInput({ name: "100%done.txt" })));
    await ok(store.createNode(baseFileInput({ name: "100abc.txt" })));
    const r = await store.search({ tenantId: TENANT_A, query: "100%" });
    if (!r.ok) throw new Error("search failed");
    expect(r.value.items.map((n) => n.name)).toEqual(["100%done.txt"]);
  });

  it("returns NotFound when scoped to a missing folder", async () => {
    const r = await store.search({ tenantId: TENANT_A, query: "x", parentId: randomUUID() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });

  it("does not crash on LIKE wildcards + multi-word queries", async () => {
    await ok(store.createNode(baseFileInput({ name: "alpha.txt" })));
    await ok(store.createNode(baseFileInput({ name: "alpha beta.txt" })));
    const queries = [
      "alpha beta", // multi-word (ILIKE treats the whole string literally)
      "100%", // LIKE wildcard — sanitized, becomes literal "%"
      "under_score", // LIKE single-char wildcard — sanitized
    ];
    for (const q of queries) {
      const r = await store.search({ tenantId: TENANT_A, query: q });
      expect(r.ok, `query ${JSON.stringify(q)} should not crash`).toBe(true);
    }
    // Sanity: the multi-word query matches the literal substring.
    const r = await store.search({ tenantId: TENANT_A, query: "alpha beta" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items.map((n) => n.name)).toEqual(["alpha beta.txt"]);
    }
  });

  it("respects the limit argument", async () => {
    for (let i = 0; i < 5; i++) {
      await ok(store.createNode(baseFileInput({ name: `report-${i}.pdf` })));
    }
    const r = await store.search({ tenantId: TENANT_A, query: "report", limit: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(2);
  });

  it("returns empty results for an empty query", async () => {
    await ok(store.createNode(baseFileInput({ name: "alpha.txt" })));
    const r = await store.search({ tenantId: TENANT_A, query: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([]);
  });

  it("excludes soft-deleted nodes from search results", async () => {
    const a = await ok(store.createNode(baseFileInput({ name: "alpha.txt" })));
    await ok(store.createNode(baseFileInput({ name: "alpha-draft.txt" })));
    await store.deleteNode({ tenantId: TENANT_A, id: a.id });

    const r = await store.search({ tenantId: TENANT_A, query: "alpha" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha-draft.txt"]);
  });

  it("tenant isolation: tenant B's matches are not visible to tenant A", async () => {
    await ok(store.createNode(baseFileInput({ name: "shared.txt", tenantId: TENANT_A })));
    await ok(store.createNode(baseFileInput({ name: "shared.txt", tenantId: TENANT_B })));

    const a = await store.search({ tenantId: TENANT_A, query: "shared" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.items).toHaveLength(1);
    expect(a.value.items[0]?.tenantId).toBe(TENANT_A);
  });

  it("enables pg_trgm and creates the GIN trigram index on lower(name)", async () => {
    // Migration sanity: pg_trgm must be installed (for gin_trgm_ops)
    // and the GIN index must exist (so ILIKE '%x%' on lower(name)
    // uses an index plan instead of a seq scan).
    const extRes = await adminPool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    expect(extRes.rows[0]?.extname).toBe("pg_trgm");

    const idxRes = await adminPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1 AND indexname = 'nodes_name_trgm_idx'`,
      [SCHEMA],
    );
    expect(idxRes.rows[0]?.indexname).toBe("nodes_name_trgm_idx");
  });
});

describe("createPostgresStore — getPath", () => {
  it("walks the parent chain root → target via recursive CTE", async () => {
    const a = await ok(store.createNode(baseFolderInput({ name: "a" })));
    const b = await ok(store.createNode(baseFolderInput({ parentId: a.id, name: "b" })));
    const c = await ok(store.createNode(baseFileInput({ parentId: b.id, name: "c.txt" })));

    const r = await store.getPath({ tenantId: TENANT_A, id: c.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.segments.map((n) => n.name)).toEqual(["a", "b", "c.txt"]);
  });

  it("includes tombstoned ancestors in the chain", async () => {
    const a = await ok(store.createNode(baseFolderInput({ name: "a" })));
    const b = await ok(store.createNode(baseFolderInput({ parentId: a.id, name: "b" })));
    const c = await ok(store.createNode(baseFileInput({ parentId: b.id, name: "c.txt" })));
    await store.deleteNode({ tenantId: TENANT_A, id: b.id });

    const r = await store.getPath({ tenantId: TENANT_A, id: c.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.segments.map((n) => n.name)).toEqual(["a", "b", "c.txt"]);
  });

  it("returns NotFound for unknown id", async () => {
    const r = await store.getPath({ tenantId: TENANT_A, id: randomUUID() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createPostgresStore — reconcile", () => {
  it("returns scanned count, no orphans (no adapter wired)", async () => {
    await ok(store.createNode(baseFileInput({ name: "a.txt" })));
    await ok(store.createNode(baseFileInput({ name: "b.txt" })));
    const r = await store.reconcile();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scanned).toBe(2);
    expect(r.value.orphansInStore).toEqual([]);
    expect(r.value.orphansInS3).toEqual([]);
  });
});

describe("createPostgresStore — tenant isolation", () => {
  it("does not let tenant B see or mutate tenant A's rows", async () => {
    const a = await ok(
      store.createNode(baseFileInput({ tenantId: TENANT_A, name: "a.txt" })),
    );

    const listB = await store.listChildren({ tenantId: TENANT_B, parentId: null });
    if (!listB.ok) throw new Error("list failed");
    expect(listB.value.items).toEqual([]);

    const getB = await store.getNode({ tenantId: TENANT_B, id: a.id });
    if (!getB.ok) throw new Error("get failed");
    expect(getB.value).toBeNull();

    const moveB = await store.moveNode({
      tenantId: TENANT_B,
      id: a.id,
      newParentId: null,
      newName: "x",
    });
    expect(moveB.ok).toBe(false);

    const delB = await store.deleteNode({ tenantId: TENANT_B, id: a.id });
    expect(delB.ok).toBe(false);
  });

  it("permits the same name across tenants", async () => {
    const a = await ok(
      store.createNode(baseFileInput({ tenantId: TENANT_A, name: "same.txt" })),
    );
    const b = await ok(
      store.createNode(baseFileInput({ tenantId: TENANT_B, name: "same.txt" })),
    );
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function ok<T>(
  p: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { code: string; message: string } }>,
  label?: string,
): Promise<T> {
  const r = await p;
  if (!r.ok) {
    throw new Error(
      `setup failed${label ? ` [${label}]` : ""}: ${r.error.code} — ${r.error.message}`,
    );
  }
  return r.value;
}
