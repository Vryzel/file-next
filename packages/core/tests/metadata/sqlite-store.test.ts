/**
 * Tests for the SQLite-backed `MetadataStore`.
 *
 * Validates the 9-method contract against the in-memory store's
 * observable behavior. Every test creates a fresh in-memory DB
 * (":memory:") so there's no cross-test bleed.
 *
 * Coverage:
 *   - createNode: happy path, name-uniqueness conflict, parent-not-found
 *   - getNode: live rows, soft-deleted rows return null, cross-tenant returns null
 *   - listChildren: ordering, deleted rows hidden, empty folder, pagination
 *   - moveNode: rename only, reparent only, both, cascade to descendants,
 *     cycle detection, name-uniqueness in destination
 *   - deleteNode: soft-delete file, non-empty folder requires recursive,
 *     recursive cascade, freed name can be reused
 *   - updateMetadata: merge vs replace
 *   - search: case-insensitive, scoped to folder, root scope = whole tenant
 *   - getPath: root → leaf chain, includes tombstoned ancestors
 *   - reconcile: no-op with scanned count
 *   - tenant isolation: rows from tenant A are invisible to tenant B
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createSqliteStore, type SqliteStoreOptions } from "@/metadata/sqlite-store";
import { asTenantId, asUserId } from "@/types/branded";
import type {
  CreateNodeInput,
  MetadataStore,
} from "@/metadata/store";

/**
 * Await a `Result<T, FileSystemError>` and unwrap. If the result
 * is `ok: false`, throw — every test in this file treats unexpected
 * failures as setup bugs, not behavior under test.
 */
const ok = async <T>(
  p: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { code: string; message: string } }>,
  label: string,
): Promise<T> => {
  const r = await p;
  if (!r.ok) throw new Error(`setup failed [${label}]: ${r.error.code} — ${r.error.message}`);
  return r.value;
};

const TENANT_A = asTenantId("acme");
const TENANT_B = asTenantId("globex");
const USER = asUserId("user-1");

const baseFileInput = (
  overrides: Partial<CreateNodeInput> = {},
): CreateNodeInput => ({
  tenantId: TENANT_A,
  parentId: null,
  name: "hello.txt",
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
  name: "docs",
  kind: "folder",
  size: 0,
  mimeType: "",
  s3Key: "",
  ownerId: USER,
  ...overrides,
});

let store: MetadataStore;

beforeEach(() => {
  store = createSqliteStore({ path: ":memory:" } as SqliteStoreOptions);
});

describe("createSqliteStore — createNode", () => {
  it("creates a file at root and returns it", async () => {
    const r = await store.createNode(baseFileInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBeTruthy();
    expect(r.value.name).toBe("hello.txt");
    expect(r.value.path).toBe("/hello.txt");
    expect(r.value.parentId).toBeNull();
    expect(r.value.size).toBe(13);
    expect(r.value.mimeType).toBe("text/plain");
    expect(r.value.s3Key).toBe("hello.txt");
    expect(r.value.deletedAt).toBeNull();
  });

  it("creates a folder with zero size and empty s3Key", async () => {
    const r = await store.createNode(baseFolderInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("folder");
    expect(r.value.size).toBe(0);
    expect(r.value.mimeType).toBe("");
    expect(r.value.s3Key).toBe("");
  });

  it("creates a child file with the correct materialized path", async () => {
    const folder = await store.createNode(baseFolderInput());
    if (!folder.ok) throw new Error("folder setup failed");

    const r = await store.createNode(baseFileInput({ parentId: folder.value.id }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.path).toBe("/docs/hello.txt");
  });

  it("returns Conflict on duplicate name in same parent", async () => {
    await store.createNode(baseFileInput());
    const r = await store.createNode(baseFileInput());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("allows the same name in different parents", async () => {
    const a = await store.createNode(baseFolderInput({ name: "a" }));
    const b = await store.createNode(baseFolderInput({ name: "b" }));
    if (!a.ok || !b.ok) throw new Error("folder setup");

    const r1 = await store.createNode(baseFileInput({ parentId: a.value.id, name: "x.txt" }));
    const r2 = await store.createNode(baseFileInput({ parentId: b.value.id, name: "x.txt" }));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("returns NotFound when parent does not exist", async () => {
    const r = await store.createNode(baseFileInput({ parentId: "ghost" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });

  it("returns Conflict when parent is a file", async () => {
    const file = await store.createNode(baseFileInput({ name: "x.txt" }));
    if (!file.ok) throw new Error("file setup");

    const r = await store.createNode(baseFileInput({ parentId: file.value.id, name: "child.txt" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("persists custom metadata as JSON", async () => {
    const r = await store.createNode(baseFileInput({ metadata: { source: "test", tag: "v1" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ source: "test", tag: "v1" });
  });
});

describe("createSqliteStore — getNode", () => {
  it("returns null for unknown id", async () => {
    const r = await store.getNode({ tenantId: TENANT_A, id: "ghost" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeNull();
  });

  it("returns null for cross-tenant access", async () => {
    const created = await store.createNode(baseFileInput());
    if (!created.ok) throw new Error("setup");
    const r = await store.getNode({ tenantId: TENANT_B, id: created.value.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeNull();
  });

  it("returns null for soft-deleted nodes", async () => {
    const created = await store.createNode(baseFileInput());
    if (!created.ok) throw new Error("setup");
    const del = await store.deleteNode({ tenantId: TENANT_A, id: created.value.id });
    expect(del.ok).toBe(true);
    const r = await store.getNode({ tenantId: TENANT_A, id: created.value.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeNull();
  });
});

describe("createSqliteStore — listChildren", () => {
  it("returns empty list when folder has no children", async () => {
    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([]);
    expect(r.value.nextCursor).toBeUndefined();
  });

  it("orders children by name (case-insensitive)", async () => {
    await store.createNode(baseFileInput({ name: "banana.txt" }));
    await store.createNode(baseFileInput({ name: "Apple.txt" }));
    await store.createNode(baseFileInput({ name: "cherry.txt" }));

    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["Apple.txt", "banana.txt", "cherry.txt"]);
  });

  it("excludes soft-deleted children", async () => {
    const a = await store.createNode(baseFileInput({ name: "a.txt" }));
    const b = await store.createNode(baseFileInput({ name: "b.txt" }));
    if (!a.ok || !b.ok) throw new Error("setup");
    await store.deleteNode({ tenantId: TENANT_A, id: a.value.id });

    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["b.txt"]);
  });

  it("returns nextCursor when more rows exist past the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.createNode(baseFileInput({ name: `f-${i}.txt` }));
    }
    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null, limit: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(2);
    expect(r.value.nextCursor).toBeDefined();
  });

  it("does not return nextCursor when result fits in limit", async () => {
    await store.createNode(baseFileInput({ name: "only.txt" }));
    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null, limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(1);
    expect(r.value.nextCursor).toBeUndefined();
  });
});

describe("createSqliteStore — moveNode", () => {
  it("renames a node and updates its path", async () => {
    const created = await store.createNode(baseFileInput({ name: "old.txt" }));
    if (!created.ok) throw new Error("setup");

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: created.value.id,
      newParentId: null,
      newName: "new.txt",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("new.txt");
    expect(r.value.path).toBe("/new.txt");
    expect(r.value.updatedAt.getTime()).toBeGreaterThanOrEqual(created.value.updatedAt.getTime());
  });

  it("reparents a node and updates its path", async () => {
    const file = await ok(store.createNode(baseFileInput({ name: "f.txt" })), "file");
    const folder = await ok(store.createNode(baseFolderInput({ name: "dest" })), "folder");

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
    const folder = await ok(store.createNode(baseFolderInput({ name: "src" })), "folder");
    const sub = await ok(store.createNode(baseFolderInput({ parentId: folder.id, name: "sub" })), "sub");
    const leaf = await ok(store.createNode(baseFileInput({ parentId: sub.id, name: "b.txt" })), "leaf");
    const dest = await ok(store.createNode(baseFolderInput({ name: "dest" })), "dest");

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: folder.id,
      newParentId: dest.id,
    });
    expect(r.ok).toBe(true);

    const leafAfter = await store.getNode({ tenantId: TENANT_A, id: leaf.id });
    if (!leafAfter.ok || !leafAfter.value) throw new Error("leaf not found");
    expect(leafAfter.value.path).toBe("/dest/src/sub/b.txt");
  });

  it("preserves nested names with the same string as the moved prefix", async () => {
    // /src + move /src → /dst. A child named "src" inside /src
    // should become /dst/src (not /dst/dst).
    const src = await store.createNode(baseFolderInput({ name: "src" }));
    if (!src.ok) throw new Error("setup");
    await store.createNode(baseFileInput({ parentId: src.value.id, name: "src" }));
    const dst = await store.createNode(baseFolderInput({ name: "dst" }));
    if (!dst.ok) throw new Error("setup");

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: src.value.id,
      newParentId: dst.value.id,
    });
    expect(r.ok).toBe(true);

    const movedSrc = await store.getNode({ tenantId: TENANT_A, id: src.value.id });
    if (!movedSrc.ok || !movedSrc.value) throw new Error("missing");
    expect(movedSrc.value.path).toBe("/dst/src");

    // Verify the nested "src" file kept its identity via getPath.
    const listRes = await store.listChildren({
      tenantId: TENANT_A,
      parentId: movedSrc.value.id,
    });
    if (!listRes.ok) throw new Error("list failed");
    const child = listRes.value.items[0];
    expect(child?.name).toBe("src");
    expect(child?.path).toBe("/dst/src/src");
  });

  it("rejects cycle: cannot move a folder into its own descendant", async () => {
    const parent = await ok(store.createNode(baseFolderInput({ name: "p" })), "parent");
    const child = await ok(store.createNode(baseFolderInput({ parentId: parent.id, name: "c" })), "child");
    const grand = await ok(store.createNode(baseFolderInput({ parentId: child.id, name: "g" })), "grand");

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
    const f = await ok(store.createNode(baseFolderInput({ name: "f" })), "f");

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: f.id,
      newParentId: f.id,
    });
    expect(r.ok).toBe(false);
  });

  it("returns Conflict when destination has a same-named sibling", async () => {
    const folder = await ok(store.createNode(baseFolderInput({ name: "f" })), "folder");
    await ok(store.createNode(baseFileInput({ parentId: folder.id, name: "x.txt" })), "sibling");
    const file = await ok(store.createNode(baseFileInput({ name: "x.txt" })), "file");

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
      id: "ghost",
      newParentId: null,
      newName: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createSqliteStore — deleteNode", () => {
  it("soft-deletes a file", async () => {
    const f = await store.createNode(baseFileInput());
    if (!f.ok) throw new Error("setup");
    const del = await store.deleteNode({ tenantId: TENANT_A, id: f.value.id });
    expect(del.ok).toBe(true);
    const after = await store.getNode({ tenantId: TENANT_A, id: f.value.id });
    if (!after.ok) throw new Error("get failed");
    expect(after.value).toBeNull();
  });

  it("rejects non-recursive delete on a non-empty folder", async () => {
    const f = await store.createNode(baseFolderInput({ name: "f" }));
    if (!f.ok) throw new Error("setup");
    await store.createNode(baseFileInput({ parentId: f.value.id, name: "x.txt" }));

    const r = await store.deleteNode({ tenantId: TENANT_A, id: f.value.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("cascades soft-delete on recursive delete", async () => {
    const f = await store.createNode(baseFolderInput({ name: "f" }));
    if (!f.ok) throw new Error("setup");
    const sub = await store.createNode(baseFolderInput({ parentId: f.value.id, name: "sub" }));
    if (!sub.ok) throw new Error("setup");
    const leaf = await store.createNode(baseFileInput({ parentId: sub.value.id, name: "g.txt" }));
    if (!leaf.ok) throw new Error("setup");

    const r = await store.deleteNode({ tenantId: TENANT_A, id: f.value.id, recursive: true });
    expect(r.ok).toBe(true);

    for (const id of [f.value.id, sub.value.id, leaf.value.id]) {
      const after = await store.getNode({ tenantId: TENANT_A, id });
      if (!after.ok) throw new Error("get failed");
      expect(after.value).toBeNull();
    }
  });

  it("frees the name so a new node can be created in the same parent", async () => {
    const f = await store.createNode(baseFolderInput({ name: "f" }));
    if (!f.ok) throw new Error("setup");
    await store.createNode(baseFileInput({ parentId: f.value.id, name: "ghost.txt" }));
    const listRes = await store.listChildren({
      tenantId: TENANT_A,
      parentId: f.value.id,
    });
    if (!listRes.ok) throw new Error("list failed");
    const ghost = listRes.value.items[0];
    if (!ghost) throw new Error("ghost missing");

    await store.deleteNode({ tenantId: TENANT_A, id: ghost.id });

    const reborn = await store.createNode(baseFileInput({
      parentId: f.value.id,
      name: "ghost.txt",
    }));
    expect(reborn.ok).toBe(true);
  });

  it("returns NotFound on a missing id", async () => {
    const r = await store.deleteNode({ tenantId: TENANT_A, id: "ghost" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createSqliteStore — updateMetadata", () => {
  it("merges by default", async () => {
    const f = await store.createNode(baseFileInput({ metadata: { a: "1", b: "2" } }));
    if (!f.ok) throw new Error("setup");

    const r = await store.updateMetadata({
      tenantId: TENANT_A,
      id: f.value.id,
      metadata: { b: "3", c: "4" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ a: "1", b: "3", c: "4" });
  });

  it("replaces when replace is true", async () => {
    const f = await store.createNode(baseFileInput({ metadata: { a: "1" } }));
    if (!f.ok) throw new Error("setup");

    const r = await store.updateMetadata({
      tenantId: TENANT_A,
      id: f.value.id,
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
      id: "ghost",
      metadata: { x: "1" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createSqliteStore — search", () => {
  it("finds matches case-insensitively across the whole tenant", async () => {
    await store.createNode(baseFileInput({ name: "Alpha.txt" }));
    await store.createNode(baseFileInput({ name: "beta.txt" }));
    await store.createNode(baseFileInput({ name: "gamma.txt" }));

    const r = await store.search({ tenantId: TENANT_A, query: "ALPHA" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["Alpha.txt"]);
  });

  it("matches substring", async () => {
    await store.createNode(baseFileInput({ name: "report-2026.pdf" }));
    await store.createNode(baseFileInput({ name: "summary.txt" }));

    const r = await store.search({ tenantId: TENANT_A, query: "2026" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["report-2026.pdf"]);
  });

  it("scopes to a folder subtree when parentId is set", async () => {
    const root = await store.createNode(baseFileInput({ name: "alpha-root.txt" }));
    const f = await store.createNode(baseFolderInput({ name: "f" }));
    if (!root.ok || !f.ok) throw new Error("setup");
    await store.createNode(baseFileInput({ parentId: f.value.id, name: "alpha-in-folder.txt" }));
    await store.createNode(baseFileInput({ parentId: f.value.id, name: "beta.txt" }));

    const r = await store.search({ tenantId: TENANT_A, query: "alpha", parentId: f.value.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha-in-folder.txt"]);
  });

  it("treats global search as the whole tenant", async () => {
    // No parentId → global scope, returns everything in the tenant.
    const f = await store.createNode(baseFolderInput({ name: "f" }));
    if (!f.ok) throw new Error("setup");
    await store.createNode(baseFileInput({ parentId: f.value.id, name: "alpha-in-folder.txt" }));
    await store.createNode(baseFileInput({ name: "alpha-root.txt" }));

    const r = await store.search({ tenantId: TENANT_A, query: "alpha" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name).sort()).toEqual([
      "alpha-in-folder.txt",
      "alpha-root.txt",
    ]);
  });

  it("does not crash on FTS5 special characters (% _ * ( ) : AND OR NOT NEAR)", async () => {
    // The sanitizer wraps the query in a phrase so FTS5 treats every
    // metacharacter and reserved keyword as literal text. None of these
    // should raise a syntax error.
    const nasties = [
      "100%", // LIKE wildcard
      "under_score", // LIKE single-char wildcard
      "(parens)", // FTS5 grouping
      "*wild*", // FTS5 wildcard
      "name:foo", // FTS5 column filter
      "foo AND bar", // FTS5 reserved keyword
      "foo OR bar",
      "foo NOT bar",
      "foo NEAR bar",
      'say "hi"', // embedded phrase delimiter
    ];
    await store.createNode(baseFileInput({ name: "100%done.txt" }));
    await store.createNode(baseFileInput({ name: "under_score.txt" }));
    await store.createNode(baseFileInput({ name: "alpha.txt" }));
    for (const q of nasties) {
      const r = await store.search({ tenantId: TENANT_A, query: q });
      expect(r.ok, `query ${JSON.stringify(q)} should not crash`).toBe(true);
    }
  });

  it("treats the query as an FTS5 phrase (adjacent tokens)", async () => {
    // "alpha beta" as a phrase matches only names where "alpha" and
    // "beta" appear as adjacent tokens.
    await store.createNode(baseFileInput({ name: "alpha beta.txt" }));
    await store.createNode(baseFileInput({ name: "alpha gamma.txt" }));
    await store.createNode(baseFileInput({ name: "beta alpha.txt" }));

    const r = await store.search({ tenantId: TENANT_A, query: "alpha beta" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha beta.txt"]);
  });

  it("respects the limit argument", async () => {
    for (let i = 0; i < 5; i++) {
      await store.createNode(baseFileInput({ name: `report-${i}.pdf` }));
    }
    const r = await store.search({ tenantId: TENANT_A, query: "report", limit: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(2);
  });

  it("returns empty results for an empty query", async () => {
    await store.createNode(baseFileInput({ name: "alpha.txt" }));
    const r = await store.search({ tenantId: TENANT_A, query: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([]);
  });

  it("excludes soft-deleted nodes from search results", async () => {
    const a = await store.createNode(baseFileInput({ name: "alpha.txt" }));
    if (!a.ok) throw new Error("setup");
    await store.createNode(baseFileInput({ name: "alpha-draft.txt" }));
    await store.deleteNode({ tenantId: TENANT_A, id: a.value.id });

    const r = await store.search({ tenantId: TENANT_A, query: "alpha" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["alpha-draft.txt"]);
  });

  it("reflects renames in the FTS index after moveNode", async () => {
    const a = await store.createNode(baseFileInput({ name: "old-name.txt" }));
    if (!a.ok) throw new Error("setup");
    await store.moveNode({
      tenantId: TENANT_A,
      id: a.value.id,
      newParentId: null,
      newName: "new-name.txt",
    });

    const oldR = await store.search({ tenantId: TENANT_A, query: "old-name" });
    expect(oldR.ok).toBe(true);
    if (oldR.ok) expect(oldR.value.items).toEqual([]);

    const newR = await store.search({ tenantId: TENANT_A, query: "new-name" });
    expect(newR.ok).toBe(true);
    if (newR.ok) expect(newR.value.items.map((n) => n.name)).toEqual(["new-name.txt"]);
  });

  it("tenant isolation: tenant B's matches are not visible to tenant A", async () => {
    await store.createNode(baseFileInput({ name: "shared.txt", tenantId: TENANT_A }));
    await store.createNode(baseFileInput({ name: "shared.txt", tenantId: TENANT_B }));

    const a = await store.search({ tenantId: TENANT_A, query: "shared" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.items).toHaveLength(1);
    expect(a.value.items[0]?.tenantId).toBe(TENANT_A);
  });

  it("returns NotFound when scoped to a missing folder", async () => {
    const r = await store.search({ tenantId: TENANT_A, query: "x", parentId: "ghost" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createSqliteStore — getPath", () => {
  it("walks the parent chain root → target", async () => {
    const a = await ok(store.createNode(baseFolderInput({ name: "a" })), "a");
    const b = await ok(store.createNode(baseFolderInput({ parentId: a.id, name: "b" })), "b");
    const c = await ok(store.createNode(baseFileInput({ parentId: b.id, name: "c.txt" })), "c");

    const r = await store.getPath({ tenantId: TENANT_A, id: c.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.segments.map((n) => n.name)).toEqual(["a", "b", "c.txt"]);
  });

  it("includes tombstoned ancestors in the chain", async () => {
    const a = await ok(store.createNode(baseFolderInput({ name: "a" })), "a");
    const b = await ok(store.createNode(baseFolderInput({ parentId: a.id, name: "b" })), "b");
    const c = await ok(store.createNode(baseFileInput({ parentId: b.id, name: "c.txt" })), "c");

    await store.deleteNode({ tenantId: TENANT_A, id: b.id });

    const r = await store.getPath({ tenantId: TENANT_A, id: c.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.segments.map((n) => n.name)).toEqual(["a", "b", "c.txt"]);
  });

  it("returns NotFound for unknown id", async () => {
    const r = await store.getPath({ tenantId: TENANT_A, id: "ghost" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
  });
});

describe("createSqliteStore — reconcile", () => {
  it("returns scanned count, no orphans (no adapter wired)", async () => {
    await store.createNode(baseFileInput({ name: "a.txt" }));
    await store.createNode(baseFileInput({ name: "b.txt" }));
    const r = await store.reconcile();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scanned).toBe(2);
    expect(r.value.orphansInStore).toEqual([]);
    expect(r.value.orphansInS3).toEqual([]);
  });
});

describe("createSqliteStore — tenant isolation", () => {
  it("does not let tenant B see or mutate tenant A's rows", async () => {
    const a = await store.createNode(baseFileInput({ tenantId: TENANT_A, name: "a.txt" }));
    if (!a.ok) throw new Error("setup");

    const listB = await store.listChildren({ tenantId: TENANT_B, parentId: null });
    if (!listB.ok) throw new Error("listB failed");
    expect(listB.value.items).toEqual([]);

    const getB = await store.getNode({ tenantId: TENANT_B, id: a.value.id });
    if (!getB.ok) throw new Error("getB failed");
    expect(getB.value).toBeNull();

    const moveB = await store.moveNode({ tenantId: TENANT_B, id: a.value.id, newParentId: null, newName: "x" });
    expect(moveB.ok).toBe(false);

    const delB = await store.deleteNode({ tenantId: TENANT_B, id: a.value.id });
    expect(delB.ok).toBe(false);
  });

  it("permits the same name across tenants", async () => {
    const a = await store.createNode(baseFileInput({ tenantId: TENANT_A, name: "same.txt" }));
    const b = await store.createNode(baseFileInput({ tenantId: TENANT_B, name: "same.txt" }));
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("createSqliteStore — schema persistence", () => {
  it("survives reopening the same file", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-next-sqlite-"));
    const dbPath = path.join(tmpDir, "store.db");
    try {
      // First connection creates the schema and inserts a row.
      const s1 = createSqliteStore({ path: dbPath });
      const created = await s1.createNode(baseFileInput({ name: "persisted.txt" }));
      if (!created.ok) throw new Error("create failed");

      // Reopen with runMigrations: false — schema already exists,
      // the row should be visible.
      const s2 = createSqliteStore({ path: dbPath, runMigrations: false });
      const r = await s2.getNode({ tenantId: TENANT_A, id: created.value.id });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value?.name).toBe("persisted.txt");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("migrations are idempotent across reopens", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-next-sqlite-"));
    const dbPath = path.join(tmpDir, "store.db");
    try {
      const s1 = createSqliteStore({ path: dbPath });
      await s1.createNode(baseFileInput({ name: "row.txt" }));

      // Reopen with default runMigrations: true — CREATE IF NOT
      // EXISTS makes the second run a no-op.
      const s2 = createSqliteStore({ path: dbPath });
      const list = await s2.listChildren({ tenantId: TENANT_A, parentId: null });
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.value.items.map((n) => n.name)).toEqual(["row.txt"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
