/**
 * Public entry point for `@vryzel/file-next`.
 *
 * Storage (`createFileSystem`, `getFileSystem`, S3/R2/memory adapters),
 * branded IDs, `Result` + `FileSystemError`, and metadata stores
 * (memory / SQLite / Postgres). Server actions live on `./server`;
 * write-through on `./sync`; React hooks on `@vryzel/file-next-headless`.
 */

export type {
  Result,
} from "./types/result";

export {
  ok,
  err,
  map,
  mapErr,
  andThen,
  unwrap,
  unwrapOr,
} from "./types/result";

export {
  FileSystemError,
  FILE_SYSTEM_ERROR_CODES,
  RETRYABLE_BY_CODE,
  fromAws,
  fromPg,
  fromSqlite,
} from "./errors";

export type {
  FileSystemErrorCode,
  FileSystemErrorOptions,
  FileSystemErrorJson,
} from "./errors";

export type {
  Path,
  Prefix,
  S3Key,
  TenantId,
  UserId,
} from "./types/branded";

export {
  asPath,
  assertPath,
  asPrefix,
  assertPrefix,
  asS3Key,
  assertS3Key,
  asTenantId,
  assertTenantId,
  asUserId,
  assertUserId,
} from "./types/branded";

export { cn } from "./lib/cn";

export type {
  S3CompatibleAdapter,
  ListInput,
  ListOutput,
  ReadInput,
  ReadOutput,
  WriteInput,
  WriteOutput,
  DeleteInput,
  DeleteOutput,
  MoveInput,
  MoveOutput,
  CopyInput,
  CopyOutput,
  StatInput,
  StatOutput,
  ExistsInput,
  ExistsOutput,
  GetMetadataInput,
  GetMetadataOutput,
  SetMetadataInput,
  SetMetadataOutput,
  PresignedUploadInput,
  PresignedUploadOutput,
  PresignedDownloadInput,
  PresignedDownloadOutput,
  GetPublicUrlInput,
  GetPublicUrlOutput,
} from "./storage/adapter";

export type { FileSystem } from "./storage/filesystem";
export { createFileSystem, createMemoryFileSystem } from "./storage/factory";
export { prefixAdapter, tenantPrefix } from "./storage/prefix-adapter";
export { withAuth } from "./auth/with-auth";
export type { AuthContext } from "./auth/with-auth";
export type { CreateFileSystemOptions } from "./storage/filesystem";
export { getFileSystem } from "./storage/singleton";
export {
  createMemoryAdapter,
  type MemoryAdapterOptions,
  type MemoryStoreSnapshot,
} from "./storage/memory-adapter";
export type {
  FileSystemConfig,
  S3Config,
  R2Config,
  Credentials,
} from "./storage/config";
export { parseFileSystemConfig } from "./storage/config";
export type { MetadataStore } from "./metadata/store";

// PR 4a: metadata store
export {
  createMemoryStore,
  createSqliteStore,
  type SqliteStoreOptions,
  createPostgresStore,
  type PostgresStoreOptions,
  NODE_NAME_MAX_LENGTH,
  normalizeNodeName,
} from "./metadata";
export type {
  FileNode,
  NodeKind,
  CreateNodeInput,
  GetNodeInput,
  ListChildrenInput,
  ListChildrenOutput,
  MoveNodeInput,
  DeleteNodeInput,
  UpdateMetadataInput,
  SearchInput,
  GetPathInput,
  GetPathOutput,
  ReconcileResult,
} from "./metadata";
