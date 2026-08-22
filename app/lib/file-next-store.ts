/**
 * Demo app wiring — memory adapter + SQLite metadata (survives refresh).
 */
import {
  createMemoryFileSystem,
  createMemoryStore,
  createSqliteStore,
  asTenantId,
  asUserId,
  type FileSystem,
  type MetadataStore,
} from "file-next";
import { createServerActions } from "file-next/server";
import { createWriteThrough } from "file-next/sync";

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
    _fs = createMemoryFileSystem({ store: getStore() });
  }
  return _fs;
}

function getWriteThroughInstance(): ReturnType<typeof createWriteThrough> {
  if (!_writeThrough) {
    _writeThrough = createWriteThrough(getFileSystemInstance(), getStore());
  }
  return _writeThrough;
}

export function getActions(): ReturnType<typeof createServerActions> {
  if (!_actions) {
    _actions = createServerActions({
      store: getStore(),
      writeThrough: getWriteThroughInstance(),
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

export const DEMO_TENANT = asTenantId("acme");
export const DEMO_USER = asUserId("user-1");
