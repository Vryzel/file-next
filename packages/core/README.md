# @vryzel/file-next

S3/R2 filesystem for Next.js: object adapter, metadata index, server actions, write-through.

```bash
pnpm add @vryzel/file-next
```

```ts
import {
  asTenantId,
  asUserId,
  createFileSystem,
  createSqliteStore,
} from "@vryzel/file-next";
import { createServerActions } from "@vryzel/file-next/server";
import { createWriteThrough } from "@vryzel/file-next/sync";

const store = createSqliteStore({ path: ".data/metadata.db" });
const fs = createFileSystem(
  {
    provider: "s3",
    bucket: process.env.FILE_NEXT_BUCKET!,
    region: process.env.FILE_NEXT_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.FILE_NEXT_ACCESS_KEY_ID!,
      secretAccessKey: process.env.FILE_NEXT_SECRET_ACCESS_KEY!,
    },
  },
  { store },
);
export const actions = createServerActions({
  store,
  fs,
  writeThrough: createWriteThrough(fs, store),
  getAuth: () => ({
    tenantId: asTenantId("acme"),
    userId: asUserId("user-1"),
  }),
});
```

Tenant never comes from the client. Replace `getAuth` with your session.

Public on npmjs. See the repository README.
