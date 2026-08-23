/**
 * WriteThrough — keeps object storage and the metadata tree in lockstep.
 *
 * Object keys are the node UUID. Rename/move stay metadata-only.
 * Copy writes a new object under a new UUID.
 */
import { ok, err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asS3Key, asTenantId, asUserId, type S3Key, type TenantId } from "@/types/branded";
import type { FileSystem } from "../storage/filesystem";
import type { MetadataStore, FileNode, CreateNodeInput } from "../metadata/store";

export type OrphanOp = "delete" | "restore";

export interface PendingOrphan {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly s3Key: S3Key;
  readonly op: OrphanOp;
  readonly createdAt: Date;
  readonly reason: string;
  readonly nodeId?: string;
}

export interface WriteThroughFileInput {
  readonly tenantId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly body: Uint8Array | ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly ownerId?: string;
  readonly maxBytes?: number;
  readonly id?: string;
}

export interface DeleteThroughFileInput {
  readonly tenantId: string;
  readonly id: string;
  readonly recursive?: boolean;
}

export interface CopyThroughFileInput {
  readonly tenantId: string;
  readonly id: string;
  readonly newParentId: string | null;
  readonly newName?: string;
}

export interface ConfirmUploadInput {
  readonly tenantId: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly ownerId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ReconcileReport {
  readonly orphans: ReadonlyArray<PendingOrphan>;
  readonly scanned: number;
  readonly missingInS3: ReadonlyArray<string>;
  readonly orphansInS3: ReadonlyArray<string>;
  readonly fixed: number;
}

const bootedTenants = new Set<string>();

export const __resetDrainState = (): void => {
  bootedTenants.clear();
};

const newId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `node-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const scopedFs = (fs: FileSystem, tenantId: string): FileSystem =>
  fs.tenantId === tenantId ? fs : fs.forTenant(tenantId);

const bodySize = (body: WriteThroughFileInput["body"]): number => {
  const maybe = body as { byteLength?: number };
  return typeof maybe.byteLength === "number" ? maybe.byteLength : 0;
};

const drainPendingOrphansFor = async (
  fs: FileSystem,
  store: MetadataStore,
  tenantId: TenantId,
): Promise<void> => {
  if (bootedTenants.has(tenantId)) return;
  bootedTenants.add(tenantId);
  const result = await store.listPendingOrphans({ tenantId });
  if (!result.ok) return;
  const adapter = scopedFs(fs, tenantId).adapter;
  for (const orphan of result.value) {
    await adapter.delete({ key: asS3Key(orphan.s3Key) });
    await store.deleteOrphan({ tenantId, id: orphan.id });
  }
};

export const createWriteThrough = (
  fs: FileSystem,
  store: MetadataStore,
): {
  writeThroughFile: (
    input: WriteThroughFileInput,
  ) => Promise<Result<FileNode, FileSystemError>>;
  deleteThroughFile: (
    input: DeleteThroughFileInput,
  ) => Promise<Result<void, FileSystemError>>;
  copyThroughFile: (
    input: CopyThroughFileInput,
  ) => Promise<Result<FileNode, FileSystemError>>;
  confirmUpload: (
    input: ConfirmUploadInput,
  ) => Promise<Result<FileNode, FileSystemError>>;
  reconcile: (input?: {
    tenantId?: string;
    dryRun?: boolean;
  }) => Promise<Result<ReconcileReport, FileSystemError>>;
  getOrphans: () => ReadonlyArray<PendingOrphan>;
} => {
  const writeThroughFile = async (
    input: WriteThroughFileInput,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const tenantId = asTenantId(input.tenantId);
    await drainPendingOrphansFor(fs, store, tenantId);
    const adapter = scopedFs(fs, tenantId).adapter;
    const id = input.id ?? newId();
    const s3Key = asS3Key(id);
    const calcSize = bodySize(input.body);

    if (fs.quotaBytes != null) {
      const used = await store.sumSize({ tenantId });
      if (!used.ok) return used;
      if (used.value + calcSize > fs.quotaBytes) {
        return err(
          new FileSystemError({
            code: "QuotaExceeded",
            message: `Tenant quota of ${fs.quotaBytes} bytes exceeded`,
            retryable: false,
          }),
        );
      }
    }

    const w = await adapter.write({
      key: s3Key,
      body: input.body,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    if (!w.ok) return w;

    const ownerId = input.ownerId ? asUserId(input.ownerId) : asUserId("system");
    const createInput: CreateNodeInput = {
      id,
      tenantId,
      parentId: input.parentId,
      name: input.name,
      kind: "file",
      size: calcSize,
      mimeType: input.contentType,
      s3Key,
      ownerId,
      metadata: input.metadata,
    };
    const c = await store.createNode(createInput);
    if (!c.ok) {
      const enqueue = await store.enqueueOrphan({
        tenantId,
        s3Key,
        reason: c.error.message,
      });
      if (!enqueue.ok) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `S3 write succeeded, metadata insert failed, and orphan enqueue failed: ${enqueue.error.message}; original: ${c.error.message}`,
            retryable: false,
          }),
        );
      }
      await adapter.delete({ key: s3Key });
      return err(
        new FileSystemError({
          code: "InternalError",
          message: `S3 write succeeded but metadata insert failed; orphan logged for reconcile. S3 cleanup attempted. Original: ${c.error.message}`,
          retryable: false,
        }),
      );
    }

    return ok(c.value);
  };

  const deleteThroughFile = async (
    input: DeleteThroughFileInput,
  ): Promise<Result<void, FileSystemError>> => {
    const tenantId = asTenantId(input.tenantId);
    await drainPendingOrphansFor(fs, store, tenantId);
    const adapter = scopedFs(fs, tenantId).adapter;

    const g = await store.getNode({ tenantId, id: input.id });
    if (!g.ok) return g;
    if (!g.value) {
      return err(
        new FileSystemError({
          code: "NotFound",
          message: `Node ${input.id} not found`,
          retryable: false,
        }),
      );
    }
    const node = g.value;
    const d = await store.deleteNode({
      tenantId,
      id: input.id,
      recursive: input.recursive,
    });
    if (!d.ok) {
      await store.enqueueOrphan({
        tenantId,
        s3Key: asS3Key(node.s3Key || node.id),
        metadataId: input.id,
        reason: d.error.message,
      });
      return err(
        new FileSystemError({
          code: "InternalError",
          message: `Metadata soft-delete failed; orphan logged. Original: ${d.error.message}`,
          retryable: false,
        }),
      );
    }

    if (node.kind === "file" && node.s3Key) {
      const del = await adapter.delete({ key: asS3Key(node.s3Key) });
      if (!del.ok) {
        await store.enqueueOrphan({
          tenantId,
          s3Key: asS3Key(node.s3Key),
          metadataId: input.id,
          reason: del.error.message,
        });
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `Metadata deleted but S3 delete failed; orphan logged. Original: ${del.error.message}`,
            retryable: false,
          }),
        );
      }
    }

    return ok(undefined);
  };

  const copyThroughFile = async (
    input: CopyThroughFileInput,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const tenantId = asTenantId(input.tenantId);
    await drainPendingOrphansFor(fs, store, tenantId);
    const adapter = scopedFs(fs, tenantId).adapter;
    const g = await store.getNode({ tenantId, id: input.id });
    if (!g.ok) return g;
    if (!g.value) {
      return err(
        new FileSystemError({
          code: "NotFound",
          message: `Node ${input.id} not found`,
          retryable: false,
        }),
      );
    }
    const src = g.value;
    const id = newId();
    if (src.kind === "file" && src.s3Key) {
      const copied = await adapter.copy({
        sourceKey: asS3Key(src.s3Key),
        destinationKey: asS3Key(id),
      });
      if (!copied.ok) return copied;
    }
    return store.createNode({
      id,
      tenantId,
      parentId: input.newParentId,
      name: input.newName ?? src.name,
      kind: src.kind,
      size: src.size,
      mimeType: src.mimeType,
      s3Key: src.kind === "file" ? id : "",
      ownerId: src.ownerId,
      metadata: src.metadata,
    });
  };

  const confirmUpload = async (
    input: ConfirmUploadInput,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const tenantId = asTenantId(input.tenantId);
    await drainPendingOrphansFor(fs, store, tenantId);
    const adapter = scopedFs(fs, tenantId).adapter;
    const existing = await store.findByS3Key({ tenantId, s3Key: input.id });
    if (existing.ok && existing.value) return ok(existing.value);

    const st = await adapter.stat({ key: asS3Key(input.id) });
    const size = st.ok ? st.value.size : (input.size ?? 0);
    const mimeType = input.contentType ?? (st.ok ? st.value.contentType : "");
    if (!st.ok && input.size === undefined) return st;

    if (fs.quotaBytes != null) {
      const used = await store.sumSize({ tenantId });
      if (!used.ok) return used;
      if (used.value + size > fs.quotaBytes) {
        return err(
          new FileSystemError({
            code: "QuotaExceeded",
            message: `Tenant quota of ${fs.quotaBytes} bytes exceeded`,
            retryable: false,
          }),
        );
      }
    }

    return store.createNode({
      id: input.id,
      tenantId,
      parentId: input.parentId,
      name: input.name,
      kind: "file",
      size,
      mimeType,
      s3Key: input.id,
      ownerId: input.ownerId ? asUserId(input.ownerId) : asUserId("system"),
      metadata: input.metadata,
    });
  };

  const reconcile = async (input?: {
    tenantId?: string;
    dryRun?: boolean;
  }): Promise<Result<ReconcileReport, FileSystemError>> => {
    if (!input?.tenantId) {
      return ok({
        orphans: [],
        scanned: 0,
        missingInS3: [],
        orphansInS3: [],
        fixed: 0,
      });
    }
    const tenantId = asTenantId(input.tenantId);
    const adapter = scopedFs(fs, tenantId).adapter;
    const dryRun = input.dryRun === true;
    let fixed = 0;

    const pending = await store.listPendingOrphans({ tenantId });
    if (!pending.ok) return pending;
    if (!dryRun) {
      for (const orphan of pending.value) {
        await adapter.delete({ key: asS3Key(orphan.s3Key) });
        const del = await store.deleteOrphan({ tenantId, id: orphan.id });
        if (del.ok) fixed += 1;
      }
    }

    const keys = await store.scanFileKeys({ tenantId });
    if (!keys.ok) return keys;
    const missingInS3: string[] = [];
    for (const row of keys.value) {
      const exists = await adapter.exists({ key: asS3Key(row.s3Key) });
      if (exists.ok && !exists.value.exists) missingInS3.push(row.s3Key);
    }

    const listed = await adapter.list({ prefix: "" as never });
    const orphansInS3: string[] = [];
    if (listed.ok) {
      const known = new Set(keys.value.map((k) => k.s3Key));
      for (const item of listed.value.items) {
        if (!known.has(item.key)) orphansInS3.push(item.key);
      }
    }

    return ok({
      orphans: pending.value.map((orphan) => ({
        id: orphan.id,
        tenantId: orphan.tenantId,
        s3Key: orphan.s3Key,
        op: "delete" as const,
        createdAt: orphan.createdAt,
        reason: orphan.reason,
        nodeId: orphan.metadataId ?? undefined,
      })),
      scanned: keys.value.length,
      missingInS3,
      orphansInS3,
      fixed,
    });
  };

  return {
    writeThroughFile,
    deleteThroughFile,
    copyThroughFile,
    confirmUpload,
    reconcile,
    getOrphans: () => [],
  };
};
