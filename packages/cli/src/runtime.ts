/**
 * Default CLI hooks — actually open the store / filesystem from env.
 */
import {
  asTenantId,
  createFileSystem,
  createMemoryFileSystem,
  createPostgresStore,
  createSqliteStore,
  parseFileSystemConfig,
  type MetadataStore,
} from "@vryzel/file-next";
import { createWriteThrough } from "@vryzel/file-next/sync";
import type { MigrateHooks } from "./migrate.js";
import type { ReconcileHooks } from "./reconcile.js";

const sqlitePath = (): string =>
  process.env.FILE_NEXT_SQLITE_PATH ?? ".data/metadata.db";

const postgresUrl = (): string => {
  const url = process.env.FILE_NEXT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("FILE_NEXT_DATABASE_URL (or DATABASE_URL) is required");
  }
  return url;
};

const openStore = (adapter: "postgres" | "sqlite"): MetadataStore =>
  adapter === "postgres"
    ? createPostgresStore({ connectionString: postgresUrl() })
    : createSqliteStore({ path: sqlitePath() });

const openFileSystem = (store: MetadataStore) => {
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
  if (!parsed.ok) {
    return createMemoryFileSystem({ store });
  }
  return createFileSystem(parsed.value, { store });
};

export const defaultMigrateHooks = (): MigrateHooks => ({
  resolveMigrator: async (adapter) => ({
    listPending: async () => [],
    apply: async () => {
      const store = openStore(adapter);
      await store.listChildren({
        tenantId: asTenantId("cli"),
        parentId: null,
        limit: 1,
      });
      return [adapter === "postgres" ? "postgres-nodes" : "sqlite-nodes"];
    },
  }),
});

export const defaultReconcileHooks = (): ReconcileHooks => ({
  runSync: async ({ tenant, dryRun }) => {
    const adapter =
      process.env.FILE_NEXT_DATABASE_URL || process.env.DATABASE_URL
        ? "postgres"
        : "sqlite";
    const store = openStore(adapter);
    const fs = openFileSystem(store);
    const wt = createWriteThrough(fs, store);
    const result = await wt.reconcile({ tenantId: tenant, dryRun });
    if (!result.ok) throw result.error;
    return {
      missingInS3: [...result.value.missingInS3],
      orphansInS3: [...result.value.orphansInS3],
      fixedCount: result.value.fixed,
    };
  },
});
