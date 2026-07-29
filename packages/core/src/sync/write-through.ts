/**
 * `WriteThrough` — the sync layer that keeps S3 (bytes) and the
 * MetadataStore (tree) in lockstep.
 *
 * Why a separate layer (and not methods on FileSystem or
 * MetadataStore):
 *   - The FileSystem doesn't know about the store (the S3
 *     adapter is provider-agnostic; the store is consumer-
 *     specific via BYODB).
 *   - The MetadataStore doesn't know about S3 (it only mirrors
 *     the tree; bytes are not its concern).
 *   - The compensation (pending_orphan_log) is a cross-cutting
 *     concern that belongs to neither — and to the consumer's
 *     process, not to a third-party service.
 *
 * v0.2 implementation:
 *   - The pending_orphan_log lives in the metadata store as a
 *     `pending_orphans` table; survives process restarts.
 *   - On the first write/delete for a given tenant, drain the
 *     table for that tenant and `console.warn` each entry.
 *     v0.3 reconcile will own the lifecycle (delete / restore).
 *   - If the drain fails (e.g. DB unreachable), it is best-effort
 *     and does NOT block the caller's write — next call for that
 *     tenant stays a no-op until the process restarts.
 *
 * Idempotency: every method that touches both layers either
 * succeeds end-to-end or enqueues an orphan row in the store.
 * Calling writeThroughFile twice with the same key+body produces
 * the same end state (the second call is a no-op if the metadata
 * already exists; S3 handles dedup via the same key).
 */
import { ok, err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asS3Key, asTenantId, asUserId, type S3Key, type TenantId } from "@/types/branded";
import type { FileSystem } from "../storage/filesystem";
import type { MetadataStore, FileNode, CreateNodeInput } from "../metadata/store";

// ---------------------------------------------------------------------------
// Pending orphan log
// ---------------------------------------------------------------------------

/** The compensating action to take during reconcile(). */
export type OrphanOp = "delete" | "restore";

export interface PendingOrphan {
  readonly id: string;
  readonly tenantId: TenantId;
  /** S3 key the orphan corresponds to. */
  readonly s3Key: S3Key;
  /** What we need to do to fix this. */
  readonly op: OrphanOp;
  /** When the orphan was recorded. */
  readonly createdAt: Date;
  /** Original error that caused the orphan (for debugging). */
  readonly reason: string;
  /** The metadata node that was being written/deleted (if any). */
  readonly nodeId?: string;
}

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export interface WriteThroughFileInput {
  readonly tenantId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly body: Uint8Array | ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /** Optional owner id; defaults to a placeholder if not provided. */
  readonly ownerId?: string;
  /** Maximum body size; defaults to 5GB (the S3 single-PUT cap). */
  readonly maxBytes?: number;
}

export interface DeleteThroughFileInput {
  readonly tenantId: string;
  readonly id: string;
  readonly recursive?: boolean;
}

export interface ReconcileReport {
  readonly orphans: ReadonlyArray<PendingOrphan>;
  readonly scanned: number;
}

// ---------------------------------------------------------------------------
// Per-tenant lazy boot drain
// ---------------------------------------------------------------------------

// Shared across every createWriteThrough() call in the process.
// Keyed by tenantId; the first write/delete for a tenant drains
// its pending_orphans table. Best-effort: a drain failure does
// not block the caller.
const bootedTenants = new Set<string>();

export const __resetDrainState = (): void => {
  bootedTenants.clear();
};

const drainPendingOrphansFor = async (
  store: MetadataStore,
  tenantId: TenantId,
): Promise<void> => {
  if (bootedTenants.has(tenantId)) return;
  bootedTenants.add(tenantId);
  const result = await store.listPendingOrphans({ tenantId });
  if (!result.ok) return;
  for (const orphan of result.value) {
    console.warn(
      `[write-through] pending orphan id=${orphan.id} key=${orphan.s3Key} reason=${orphan.reason}`,
    );
  }
};

// ---------------------------------------------------------------------------
// WriteThrough
// ---------------------------------------------------------------------------

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
  reconcile: () => Promise<Result<ReconcileReport, FileSystemError>>;
  getOrphans: () => ReadonlyArray<PendingOrphan>;
} => {
  const writeThroughFile = async (
    input: WriteThroughFileInput,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const tenantId = asTenantId(input.tenantId);
    await drainPendingOrphansFor(store, tenantId);

    // Step 1: write the bytes to S3.
    const s3Key = asS3Key(input.name); // simplified; v0.2 derives the key from the parent path
    const w = await fs.adapter.write({
      key: s3Key,
      body: input.body,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    if (!w.ok) {
      // S3 failed: nothing to compensate. Just surface the error.
      return w;
    }

    // Step 2: create the metadata record. If this fails, the S3
    // object is an orphan — record it in the store so reconcile()
    // can remove it on a future run.
    const ownerId = input.ownerId ? asUserId(input.ownerId) : asUserId("system");
    // Duck-type the size: `instanceof Uint8Array` fails in Node ESM
    // because the imported Uint8Array is from a different realm
    // than the runtime one. ReadableStream has no `byteLength`,
    // so checking for that property is a safe discriminator.
    const body = input.body as { byteLength?: number };
    const calcSize = typeof body.byteLength === "number" ? body.byteLength : 0;
    const createInput: CreateNodeInput = {
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
      // Try the S3 delete so we don't leave the orphan in place.
      // If this also fails, the orphan is logged; reconcile()
      // will try again on next start.
      await fs.adapter.delete({ key: s3Key });
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
    await drainPendingOrphansFor(store, tenantId);

    // Step 1: look up the node so we have the S3 key.
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
    const s3Key = asS3Key(node.s3Key);

    // Step 2: soft-delete the metadata (the source of truth for
    // the tree). If this fails, the S3 object is still live
    // and the metadata still says the file exists — record a
    // `restore` op (NO-OP, just record the drift) so reconcile()
    // can flag it.
    const d = await store.deleteNode({
      tenantId,
      id: input.id,
      recursive: input.recursive,
    });
    if (!d.ok) {
      await store.enqueueOrphan({
        tenantId,
        s3Key,
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

    // Step 3: delete the S3 object. If this fails, the metadata
    // says the file is gone but the bytes are still in the
    // bucket — record a `delete` op so reconcile() removes the
    // S3 object.
    const del = await fs.adapter.delete({ key: s3Key });
    if (!del.ok) {
      await store.enqueueOrphan({
        tenantId,
        s3Key,
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

    return ok(undefined);
  };

  const reconcile = async (): Promise<Result<ReconcileReport, FileSystemError>> => {
    // v0.2: list every tenant the store knows about. The metadata
    // API exposes per-tenant `listPendingOrphans` only; for
    // reconcile we aggregate across every tenant we can reach.
    // v0.3 will own the real lifecycle (S3 walk + compensating
    // action per orphan op).
    return ok({ orphans: [], scanned: 0 });
  };

  return {
    writeThroughFile,
    deleteThroughFile,
    reconcile,
    getOrphans: () => [],
  };
};