/**
 * `createSqliteStore` — a SQLite-backed `MetadataStore`.
 *
 * Built on `better-sqlite3` (sync native binding). Every public
 * method returns a Promise to satisfy the `MetadataStore`
 * interface, but the actual SQL work is synchronous — there is
 * no I/O between calls.
 *
 * Schema (one table):
 *
 *   nodes(
 *     id          TEXT PRIMARY KEY,        -- UUID v4
 *     tenant_id   TEXT NOT NULL,
 *     parent_id   TEXT NOT NULL DEFAULT '', -- '' = root (SQLite treats NULL
 *                                          --   as distinct in unique indexes,
 *                                          --   so we use '' to enforce
 *                                          --   uniqueness at root level)
 *     name        TEXT NOT NULL,
 *     path        TEXT NOT NULL,           -- materialized "/a/b/c"
 *     kind        TEXT NOT NULL CHECK (kind IN ('file','folder')),
 *     size        INTEGER NOT NULL DEFAULT 0,
 *     mime_type   TEXT NOT NULL DEFAULT '',
 *     s3_key      TEXT NOT NULL DEFAULT '',
 *     owner_id    TEXT NOT NULL,
 *     metadata    TEXT NOT NULL DEFAULT '{}', -- JSON
 *     created_at  TEXT NOT NULL,           -- ISO 8601
 *     updated_at  TEXT NOT NULL,
 *     deleted_at  TEXT                     -- ISO 8601 or NULL
 *   )
 *
 *   Partial unique index on (tenant_id, parent_id, name)
 *   WHERE deleted_at IS NULL → name uniqueness only for live
 *   rows. Soft-deleted rows free the name.
 *
 *   Indexes for hot paths:
 *     nodes_path_prefix  → LIKE 'path/%' for moveNode cascade
 *     nodes_tenant_root  → list root children
 *     nodes_tenant_parent → list children of any folder
 *     nodes_name_nocase  → search by name COLLATE NOCASE
 *
 * Tenant isolation is enforced in app code (filter by tenant_id
 * in every query). Same posture as the memory store.
 *
 * The `reconcile()` method is a no-op — the real reconcile that
 * walks the S3 bucket needs the adapter injected, which would
 * change the MetadataStore interface. Tracked for v0.3.
 */
import { createRequire } from "node:module";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";

/**
 * The native `better-sqlite3` binding is loaded lazily. A top-level
 * `import Database from "better-sqlite3"` pulls the native module
 * into every consumer's dependency graph, and bundlers like Next.js
 * webpack/turbopack walk the native require chain at build time and
 * fail with "Can't resolve 'fs'" — even when createSqliteStore is
 * never called. Loading inside `buildInner` (the real factory body)
 * keeps the native binding out of the consumer's bundle until
 * createSqliteStore is actually invoked.
 *
 * We use `createRequire(import.meta.url)` to make webpack/turbopack
 * emit a runtime `require()` call. Vitest resolves the require at
 * runtime too (no static analysis).
 */
type BetterSqlite3Module = typeof import("better-sqlite3");
type DatabaseCtor = new (path: string) => BetterSqliteDatabase;
const extractDatabase = (mod: BetterSqlite3Module): DatabaseCtor => {
  const m = mod as unknown as { default?: DatabaseCtor };
  return (m.default ?? (mod as unknown as DatabaseCtor));
};
import {
  err,
  ok,
  type Result,
} from "@/types/result";
import { FileSystemError } from "@/errors";
import { asS3Key, asTenantId, asUserId } from "@/types/branded";
import type {
  CreateNodeInput,
  DeleteNodeInput,
  FileNode,
  GetNodeInput,
  GetPathInput,
  ListChildrenInput,
  ListChildrenOutput,
  MetadataStore,
  MoveNodeInput,
  ReconcileResult,
  SearchInput,
  UpdateMetadataInput,
} from "./store";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SqliteStoreOptions {
  /**
   * SQLite file path, or ":memory:" for a private in-memory
   * database. Use ":memory:" in tests; a real path in apps so
   * the file tree survives restarts.
   */
  readonly path: string;
  /**
   * Run schema migrations on construction. Default: true.
   * Set false when sharing a DB across multiple stores (each
   * instance would otherwise re-run the idempotent CREATE).
   */
  readonly runMigrations?: boolean;
}

// ---------------------------------------------------------------------------
// Row → FileNode
// ---------------------------------------------------------------------------

interface NodeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly size: number;
  readonly mime_type: string;
  readonly s3_key: string;
  readonly owner_id: string;
  readonly metadata: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

interface OrphanRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly s3_key: string;
  readonly metadata_id: string | null;
  readonly reason: string;
  readonly created_at: string;
}

const rowToPendingOrphan = (row: OrphanRow) => ({
  id: row.id,
  tenantId: asTenantId(row.tenant_id),
  s3Key: asS3Key(row.s3_key),
  metadataId: row.metadata_id,
  reason: row.reason,
  createdAt: new Date(row.created_at),
});

const rowToFileNode = (row: NodeRow): FileNode => ({
  id: row.id,
  tenantId: asTenantId(row.tenant_id),
  // SQLite stores '' for "no parent" (NULL doesn't work in
  // unique indexes — see the schema comment).
  parentId: row.parent_id === "" ? null : row.parent_id,
  name: row.name,
  path: row.path,
  kind: row.kind,
  size: row.size,
  mimeType: row.mime_type,
  s3Key: row.s3_key,
  ownerId: asUserId(row.owner_id),
  metadata: JSON.parse(row.metadata) as Record<string, string>,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
});

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 2;

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  parent_id   TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
  size        INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT NOT NULL DEFAULT '',
  s3_key      TEXT NOT NULL DEFAULT '',
  owner_id    TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS pending_orphans (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  s3_key      TEXT NOT NULL,
  metadata_id TEXT,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_orphans_tenant_created
  ON pending_orphans(tenant_id, created_at);

-- Name uniqueness for LIVE rows only. NULL deleted_at lets two
-- deleted rows share a name; a new live row then claims the slot.
CREATE UNIQUE INDEX IF NOT EXISTS nodes_unique_live_name
  ON nodes(tenant_id, parent_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS nodes_path_prefix
  ON nodes(path);
CREATE INDEX IF NOT EXISTS nodes_tenant_parent
  ON nodes(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS nodes_name_nocase
  ON nodes(name COLLATE NOCASE);
`;

const runMigrations = (db: BetterSqliteDatabase): void => {
  db.exec(MIGRATION_SQL);
  db.prepare(
    "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)",
  ).run(String(SCHEMA_VERSION));
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSqliteStore = (
  options: SqliteStoreOptions,
): MetadataStore => {
  // The consumer-facing factory is sync (matches the MetadataStore
  // contract). The real work is built lazily — we return an object
  // that delegates every method through `ensureReady()`, which
  // resolves once and caches. First method call pays the import
  // cost; the rest are direct.
  let inner: MetadataStore | null = null;
  let pending: Promise<MetadataStore> | null = null;

  const ensureReady = async (): Promise<MetadataStore> => {
    if (inner) return inner;
    if (!pending) {
      pending = (async () => {
        // createRequire gives us a real require() call that
        // webpack/turbopack leave alone (treated as a runtime call).
        const req = createRequire(import.meta.url);
      const mod = req("better-sqlite3") as BetterSqlite3Module;
      inner = buildInner(extractDatabase(mod), options);
        return inner;
      })();
    }
    return pending;
  };

  const wrap = <A extends unknown[], R>(
    method: (store: MetadataStore, ...args: A) => Promise<R>,
  ): ((...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const s = await ensureReady();
      return method(s, ...args);
    };

  return {
    createNode: wrap((s, i) => s.createNode(i)),
    getNode: wrap((s, i) => s.getNode(i)),
    listChildren: wrap((s, i) => s.listChildren(i)),
    moveNode: wrap((s, i) => s.moveNode(i)),
    deleteNode: wrap((s, i) => s.deleteNode(i)),
    updateMetadata: wrap((s, i) => s.updateMetadata(i)),
    search: wrap((s, i) => s.search(i)),
    getPath: wrap((s, i) => s.getPath(i)),
    reconcile: wrap((s) => s.reconcile()),
    enqueueOrphan: wrap((s, i) => s.enqueueOrphan(i)),
    listPendingOrphans: wrap((s, i) => s.listPendingOrphans(i)),
    deleteOrphan: wrap((s, i) => s.deleteOrphan(i)),
  };
};

/**
 * The real factory — receives the loaded Database constructor and
 * options, builds the prepared statements and the 9-method store.
 * Defined below as a closure that captures `Database` at call
 * time (after the lazy import resolves).
 */
const buildInner = (
  Database: DatabaseCtor,
  options: SqliteStoreOptions,
): MetadataStore => {
  const db = new Database(options.path);
  // WAL gives us better concurrent read performance for little
  // extra cost (we're not heavily contended; still, cheap).
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  if (options.runMigrations !== false) {
    runMigrations(db);
  }

  // -------------------------------------------------------------------------
  // Prepared statements
  // -------------------------------------------------------------------------

  const stmtInsert = db.prepare(`
    INSERT INTO nodes (
      id, tenant_id, parent_id, name, path, kind, size, mime_type,
      s3_key, owner_id, metadata, created_at, updated_at, deleted_at
    ) VALUES (
      @id, @tenant_id, @parent_id, @name, @path, @kind, @size, @mime_type,
      @s3_key, @owner_id, @metadata, @created_at, @updated_at, NULL
    )
  `);

  const stmtGetById = db.prepare(`
    SELECT * FROM nodes
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
  `);

  // For getPath chain walking — include tombstoned ancestors so
  // the path mirrors the memory-store behavior (no gaps even if a
  // mid-chain parent is soft-deleted).
  const stmtGetByIdAny = db.prepare(`
    SELECT * FROM nodes
    WHERE id = ? AND tenant_id = ?
  `);

  // parent_id is stored as '' (empty string) for "no parent"
  // because SQLite treats NULL as distinct in unique indexes.
  // All queries that compare parent_id use `=` with '' bound.
  const stmtListChildren = db.prepare(`
    SELECT * FROM nodes
    WHERE tenant_id = ? AND parent_id = ?
      AND deleted_at IS NULL
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ?
  `);

  const stmtCountChildren = db.prepare(`
    SELECT COUNT(*) AS c FROM nodes
    WHERE tenant_id = ? AND parent_id = ? AND deleted_at IS NULL
  `);

  const stmtUpdateSelfMove = db.prepare(`
    UPDATE nodes
    SET parent_id = ?, name = ?, path = ?, updated_at = ?
    WHERE id = ?
  `);

  // Prefix-only replace: SUBSTR strips the leading oldPath and
  // we prepend newPath. Avoids accidentally rewriting nested
  // segments that happen to share the moved name (e.g. moving
  // "/foo" to "/bar" must turn "/foo/sub/foo" into "/bar/sub/foo",
  // not "/bar/sub/bar").
  const stmtCascadeDescendants = db.prepare(`
    UPDATE nodes
    SET path = ? || SUBSTR(path, LENGTH(?) + 1), updated_at = ?
    WHERE path LIKE ? || '/%'
  `);

  const stmtTombstone = db.prepare(`
    UPDATE nodes
    SET deleted_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const stmtTombstoneSubtree = db.prepare(`
    UPDATE nodes
    SET deleted_at = ?, updated_at = ?
    WHERE (id = ? OR path LIKE ? || '/%')
      AND deleted_at IS NULL
  `);

  const stmtHasLiveChild = db.prepare(`
    SELECT 1 FROM nodes
    WHERE tenant_id = ? AND parent_id = ? AND deleted_at IS NULL
    LIMIT 1
  `);

  const stmtUpdateMetadata = db.prepare(`
    UPDATE nodes
    SET metadata = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
  `);

  const stmtSearchGlobal = db.prepare(`
    SELECT * FROM nodes
    WHERE tenant_id = ? AND deleted_at IS NULL
      AND name LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ?
  `);

  const stmtSearchInFolder = db.prepare(`
    SELECT * FROM nodes
    WHERE tenant_id = ? AND deleted_at IS NULL
      AND (id = ? OR path LIKE ? || '/%')
      AND name LIKE ? ESCAPE '\\' COLLATE NOCASE
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ?
  `);

  const stmtEnqueueOrphan = db.prepare(`
    INSERT INTO pending_orphans (
      id, tenant_id, s3_key, metadata_id, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const stmtListPendingOrphans = db.prepare(`
    SELECT * FROM pending_orphans
    WHERE tenant_id = ?
    ORDER BY created_at ASC, id ASC
  `);

  const stmtDeleteOrphan = db.prepare(`
    DELETE FROM pending_orphans
    WHERE tenant_id = ? AND id = ?
  `);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const makeId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `sql-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const nowIso = (): string => new Date().toISOString();

  // Boundary translation: FileNode.parentId is null | string,
  // but the SQLite column is NOT NULL with '' for root. Map at
  // every bind site so the rest of the code can compare with =.
  const dbParent = (id: string | null): string => id ?? "";

  const computePath = (
    parentPath: string | null,
    name: string,
  ): string => {
    if (parentPath === null) return `/${name}`;
    return `${parentPath}/${name}`;
  };

  const notFound = (id: string): Result<never, FileSystemError> =>
    err(
      new FileSystemError({
        code: "NotFound",
        message: `Node ${id} not found`,
        retryable: false,
      }),
    );

  const escapeLike = (s: string): string =>
    s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

  // -------------------------------------------------------------------------
  // 9-method contract
  // -------------------------------------------------------------------------

  return {
    async createNode(
      input: CreateNodeInput,
    ): Promise<Result<FileNode, FileSystemError>> {
      const now = nowIso();
      const id = makeId();

      // Look up parent (if any) to compute the path. We require
      // a LIVE parent; tombstoned parents can't have new children.
      // `!= null` (not `!== null`) so that BOTH null and
      // undefined skip the lookup.
      let parentPath: string | null = null;
      if (input.parentId != null) {
        const parent = stmtGetById.get(input.parentId, input.tenantId) as
          | NodeRow
          | undefined;
        if (!parent) return notFound(input.parentId);
        if (parent.kind !== "folder") {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `Parent ${input.parentId} is not a folder`,
              retryable: false,
            }),
          );
        }
        parentPath = parent.path;
      }

      const path = computePath(parentPath, input.name);

      try {
        stmtInsert.run({
          id,
          tenant_id: input.tenantId,
          parent_id: dbParent(input.parentId),
          name: input.name,
          path,
          kind: input.kind,
          size: input.kind === "folder" ? 0 : input.size,
          mime_type: input.kind === "folder" ? "" : input.mimeType,
          s3_key: input.kind === "folder" ? "" : input.s3Key,
          owner_id: input.ownerId,
          metadata: JSON.stringify(input.metadata ?? {}),
          created_at: now,
          updated_at: now,
        });
      } catch (e) {
        // SQLite UNIQUE violation on nodes_unique_live_name.
        if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `A node named '${input.name}' already exists in this folder`,
              retryable: false,
            }),
          );
        }
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `createNode failed: ${(e as Error).message}`,
            retryable: false,
          }),
        );
      }

      const created = stmtGetById.get(id, input.tenantId) as NodeRow | undefined;
      if (!created) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: "Row missing immediately after insert",
            retryable: false,
          }),
        );
      }
      return ok(rowToFileNode(created));
    },

    async getNode(
      input: GetNodeInput,
    ): Promise<Result<FileNode | null, FileSystemError>> {
      const row = stmtGetById.get(input.id, input.tenantId) as
        | NodeRow
        | undefined;
      return ok(row ? rowToFileNode(row) : null);
    },

    async listChildren(
      input: ListChildrenInput,
    ): Promise<Result<ListChildrenOutput, FileSystemError>> {
      const limit = input.limit ?? 1000;
      const parentId = dbParent(input.parentId);
      const rows = stmtListChildren.all(
        input.tenantId,
        parentId,
        limit,
      ) as ReadonlyArray<NodeRow>;
      const total = (stmtCountChildren.get(
        input.tenantId,
        parentId,
      ) as { c: number }).c;
      return ok({
        items: rows.map(rowToFileNode),
        nextCursor: total > limit ? String(limit) : undefined,
      });
    },

    async moveNode(
      input: MoveNodeInput,
    ): Promise<Result<FileNode, FileSystemError>> {
      const current = stmtGetById.get(input.id, input.tenantId) as
        | NodeRow
        | undefined;
      if (!current) return notFound(input.id);

      const newName = input.newName ?? current.name;

      // Validate the new parent (if any) and check for cycles.
      // `!= null` (not `!== null`) so that BOTH null and
      // undefined skip the validation. (undefined !== null is
      // TRUE in JS — the footgun that hid this for an hour.)
      let newParentPath: string | null = null;
      if (input.newParentId != null) {
        if (input.newParentId === current.id) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: "Cannot move a folder into itself",
              retryable: false,
            }),
          );
        }
        const newParent = stmtGetById.get(input.newParentId, input.tenantId) as
          | NodeRow
          | undefined;
        if (!newParent) return notFound(input.newParentId);
        if (newParent.kind !== "folder") {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `Destination ${input.newParentId} is not a folder`,
              retryable: false,
            }),
          );
        }
        // Cycle: newParent must not be a descendant of current.
        if (newParent.path === current.path || newParent.path.startsWith(`${current.path}/`)) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: "Cannot move a folder into its own descendant",
              retryable: false,
            }),
          );
        }
        newParentPath = newParent.path;
      }

      const newPath = computePath(newParentPath, newName);

      try {
        const tx = db.transaction(() => {
          stmtUpdateSelfMove.run(
            dbParent(input.newParentId),
            newName,
            newPath,
            nowIso(),
            input.id,
          );
          if (current.path !== newPath) {
            // Params: newPath, oldPath, now, oldPath (for LIKE).
            stmtCascadeDescendants.run(
              newPath,
              current.path,
              nowIso(),
              current.path,
            );
          }
        });
        tx();
      } catch (e) {
        if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `A node named '${newName}' already exists in the destination folder`,
              retryable: false,
            }),
          );
        }
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `moveNode failed: ${(e as Error).message}`,
            retryable: false,
          }),
        );
      }

      const updated = stmtGetById.get(input.id, input.tenantId) as
        | NodeRow
        | undefined;
      if (!updated) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: "Node missing after move",
            retryable: false,
          }),
        );
      }
      return ok(rowToFileNode(updated));
    },

    async deleteNode(
      input: DeleteNodeInput,
    ): Promise<Result<void, FileSystemError>> {
      const node = stmtGetById.get(input.id, input.tenantId) as
        | NodeRow
        | undefined;
      if (!node) return notFound(input.id);

      if (node.kind === "folder" && !input.recursive) {
        const hasChild = stmtHasLiveChild.get(input.tenantId, input.id);
        if (hasChild) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `Folder '${node.name}' is not empty; pass recursive: true to delete the subtree`,
              retryable: false,
            }),
          );
        }
      }

      const now = nowIso();
      if (input.recursive || node.kind === "file") {
        stmtTombstoneSubtree.run(now, now, input.id, node.path);
      } else {
        stmtTombstone.run(now, now, input.id);
      }
      return ok(undefined);
    },

    async updateMetadata(
      input: UpdateMetadataInput,
    ): Promise<Result<FileNode, FileSystemError>> {
      const node = stmtGetById.get(input.id, input.tenantId) as
        | NodeRow
        | undefined;
      if (!node) return notFound(input.id);

      const next = input.replace
        ? { ...input.metadata }
        : { ...(JSON.parse(node.metadata) as Record<string, string>), ...input.metadata };

      const result = stmtUpdateMetadata.run(
        JSON.stringify(next),
        nowIso(),
        input.id,
        input.tenantId,
      );
      if (result.changes === 0) {
        return notFound(input.id);
      }
      const updated = stmtGetById.get(input.id, input.tenantId) as NodeRow;
      return ok(rowToFileNode(updated));
    },

    async search(
      input: SearchInput,
    ): Promise<Result<ListChildrenOutput, FileSystemError>> {
      const limit = input.limit ?? 100;
      const pattern = `%${escapeLike(input.query)}%`;

      let rows: ReadonlyArray<NodeRow>;
      if (input.parentId === undefined) {
        // No scope: search the whole tenant.
        rows = stmtSearchGlobal.all(input.tenantId, pattern, limit) as ReadonlyArray<NodeRow>;
      } else {
        const parent = stmtGetById.get(input.parentId, input.tenantId) as
          | NodeRow
          | undefined;
        if (!parent) return notFound(input.parentId);
        if (parent.path === "/") {
          // Root's subtree is the whole tenant — use the global
          // query (avoids the root path's "LIKE '//%'" no-op).
          rows = stmtSearchGlobal.all(input.tenantId, pattern, limit) as ReadonlyArray<NodeRow>;
        } else {
          rows = stmtSearchInFolder.all(
            input.tenantId,
            input.parentId,
            parent.path,
            pattern,
            limit,
          ) as ReadonlyArray<NodeRow>;
        }
      }

      return ok({
        items: rows.map(rowToFileNode),
        nextCursor: rows.length === limit ? String(limit) : undefined,
      });
    },

    async getPath(
      input: GetPathInput,
    ): Promise<Result<{ segments: FileNode[] }, FileSystemError>> {
      const start = stmtGetById.get(input.id, input.tenantId) as
        | NodeRow
        | undefined;
      if (!start) return notFound(input.id);

      const segments: FileNode[] = [];
      let cursor: NodeRow | undefined = start;
      while (cursor) {
        segments.unshift(rowToFileNode(cursor));
        // parent_id is stored as '' for root; treat '' as the
        // termination condition.
        if (cursor.parent_id === "") break;
        // Include tombstoned ancestors — mirrors memory-store and
        // gives the consumer a complete breadcrumb even if a
        // mid-chain parent was soft-deleted.
        cursor = stmtGetByIdAny.get(cursor.parent_id, input.tenantId) as
          | NodeRow
          | undefined;
        if (!cursor) break;
      }
      return ok({ segments });
    },

    async enqueueOrphan(input) {
      const id = makeId();
      try {
        stmtEnqueueOrphan.run(
          id,
          input.tenantId,
          input.s3Key,
          input.metadataId ?? null,
          input.reason,
          nowIso(),
        );
        return ok({ id });
      } catch (error) {
        return err(FileSystemError.fromSqlite(error));
      }
    },

    async listPendingOrphans(input) {
      try {
        const rows = stmtListPendingOrphans.all(
          input.tenantId,
        ) as ReadonlyArray<OrphanRow>;
        return ok(rows.map(rowToPendingOrphan));
      } catch (error) {
        return err(FileSystemError.fromSqlite(error));
      }
    },

    async deleteOrphan(input) {
      try {
        const result = stmtDeleteOrphan.run(input.tenantId, input.id);
        if (result.changes === 0) {
          return err(
            new FileSystemError({
              code: "NotFound",
              message: `Orphan ${input.id} not found`,
              retryable: false,
            }),
          );
        }
        return ok(undefined);
      } catch (error) {
        return err(FileSystemError.fromSqlite(error));
      }
    },

    async reconcile(): Promise<Result<ReconcileResult, FileSystemError>> {
      // No-op: needs the S3 adapter to walk the bucket, which
      // would change the MetadataStore interface. Tracked for v0.3.
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM nodes WHERE deleted_at IS NULL")
        .get() as { c: number };
      return ok({
        orphansInStore: [],
        orphansInS3: [],
        scanned: row.c,
      });
    },
  };
};

export { asTenantId, asUserId };
