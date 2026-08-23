/**
 * The `FileSystem` container — adapter + config + optional metadata
 * index + a `forTenant` chain that returns a namespaced view.
 */
import type { S3CompatibleAdapter } from "./adapter";
import type { FileSystemConfig } from "./config";
import type { MetadataStore } from "../metadata/store";

export interface FileSystem {
  readonly adapter: S3CompatibleAdapter;
  readonly config: FileSystemConfig;
  readonly metadata: MetadataStore | undefined;
  /** Set when this instance was produced by `forTenant`. */
  readonly tenantId?: string;
  /** Optional per-tenant byte cap enforced by write-through. */
  readonly quotaBytes?: number;
  forTenant(tenantId: string): FileSystem;
}

export interface CreateFileSystemOptions {
  readonly store?: MetadataStore;
  readonly quotaBytes?: number;
  /**
   * When true (default), `forTenant(id)` prefixes object keys with
   * `t/{id}/`. Set false for a single-tenant bucket or an R2 token
   * scoped to the bucket root.
   */
  readonly prefixTenantKeys?: boolean;
}
