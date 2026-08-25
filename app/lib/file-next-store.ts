/**
 * Demo wiring — SQLite metadata + R2/S3 when env is set, otherwise memory bytes.
 */
import {
  createFileSystem,
  createMemoryFileSystem,
  createMemoryStore,
  createSqliteStore,
  parseFileSystemConfig,
  asTenantId,
  asUserId,
  type FileSystem,
  type MetadataStore,
} from "@vryzel/file-next";
import { createServerActions } from "@vryzel/file-next/server";
import { createWriteThrough } from "@vryzel/file-next/sync";
import { DEMO_QUOTA_BYTES } from "./constants";

export const DEMO_TENANT = asTenantId("acme");
export const DEMO_USER = asUserId("user-1");

let _store: MetadataStore | null = null;
let _fs: FileSystem | null = null;
let _actions: ReturnType<typeof createServerActions> | null = null;
let _writeThrough: ReturnType<typeof createWriteThrough> | null = null;

export function getStore(): MetadataStore {
  if (!_store) {
    _store =
      process.env.VITEST === "true"
        ? createMemoryStore()
        : createSqliteStore({ path: ".data/metadata.db" });
  }
  return _store;
}

function getFileSystemInstance(): FileSystem {
  if (!_fs) {
    const store = getStore();
    const parsed = parseFileSystemConfig({
      provider: process.env.FILE_NEXT_PROVIDER,
      bucket: process.env.FILE_NEXT_BUCKET,
      region: process.env.FILE_NEXT_REGION,
      endpoint: process.env.FILE_NEXT_ENDPOINT,
      credentials:
        process.env.FILE_NEXT_ACCESS_KEY_ID && process.env.FILE_NEXT_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.FILE_NEXT_ACCESS_KEY_ID,
              secretAccessKey: process.env.FILE_NEXT_SECRET_ACCESS_KEY,
            }
          : undefined,
      forcePathStyle:
        process.env.FILE_NEXT_PROVIDER === "r2"
          ? true
          : process.env.FILE_NEXT_FORCE_PATH_STYLE === "true",
    });
    _fs = parsed.ok
      ? createFileSystem(parsed.value, { store, quotaBytes: DEMO_QUOTA_BYTES })
      : createMemoryFileSystem({ store, quotaBytes: DEMO_QUOTA_BYTES });
  }
  return _fs;
}

export function getWriteThrough(): ReturnType<typeof createWriteThrough> {
  if (!_writeThrough) {
    _writeThrough = createWriteThrough(getFileSystemInstance(), getStore());
  }
  return _writeThrough;
}

export function getActions(): ReturnType<typeof createServerActions> {
  if (!_actions) {
    _actions = createServerActions({
      store: getStore(),
      writeThrough: getWriteThrough(),
      fs: getFileSystemInstance(),
      getAuth: () => ({ tenantId: DEMO_TENANT, userId: DEMO_USER }),
    });
  }
  return _actions;
}

export function getAdapter() {
  return getFileSystemInstance().adapter;
}

export function _resetForTests(): void {
  _store = null;
  _fs = null;
  _actions = null;
  _writeThrough = null;
}
