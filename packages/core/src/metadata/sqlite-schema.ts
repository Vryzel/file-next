import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pendingOrphans = sqliteTable(
  "pending_orphans",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    s3Key: text("s3_key").notNull(),
    metadataId: text("metadata_id"),
    reason: text("reason").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pendingOrphansTenantCreated: index(
      "pending_orphans_tenant_created",
    ).on(table.tenantId, table.createdAt),
  }),
);
