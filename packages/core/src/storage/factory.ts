/**
 * `createFileSystem(config, options?)` — the only place that decides
 * which concrete adapter to instantiate and how tenant scoping works.
 */
import { createS3Adapter, createS3Client } from "./s3-adapter";
import { createMemoryAdapter } from "./memory-adapter";
import { parseFileSystemConfig, type FileSystemConfig } from "./config";
import type { FileSystem, CreateFileSystemOptions } from "./filesystem";
import { prefixAdapter, tenantPrefix } from "./prefix-adapter";

const MEMORY_CONFIG: FileSystemConfig = {
  provider: "s3",
  bucket: "in-memory",
  region: "us-east-1",
  credentials: {
    accessKeyId: "in-memory",
    secretAccessKey: "in-memory",
  },
  forcePathStyle: false,
};

const assemble = (
  adapter: FileSystem["adapter"],
  config: FileSystemConfig,
  options: CreateFileSystemOptions | undefined,
): FileSystem => {
  const forTenant = (tenantId: string): FileSystem => ({
    adapter: prefixAdapter(adapter, tenantPrefix(tenantId)),
    config,
    metadata: options?.store,
    tenantId,
    quotaBytes: options?.quotaBytes,
    forTenant,
  });

  return {
    adapter,
    config,
    metadata: options?.store,
    quotaBytes: options?.quotaBytes,
    forTenant,
  };
};

export const createFileSystem = (
  config: FileSystemConfig,
  options?: CreateFileSystemOptions,
): FileSystem => {
  const parsed = parseFileSystemConfig(config);
  if (!parsed.ok) {
    throw parsed.error;
  }
  const client = createS3Client(parsed.value);
  const adapter = createS3Adapter(client, parsed.value);
  return assemble(adapter, parsed.value, options);
};

export const createMemoryFileSystem = (
  options?: CreateFileSystemOptions,
): FileSystem => assemble(createMemoryAdapter(), MEMORY_CONFIG, options);
