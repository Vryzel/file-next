import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const pendingOrphans = pgTable(
  "pending_orphans",
  {
    id: uuid("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    s3Key: text("s3_key").notNull(),
    metadataId: text("metadata_id"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pending_orphans_tenant_created").on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);
