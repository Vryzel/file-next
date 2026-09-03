# file-next

Drive-like files for Next.js: your S3 or R2 bucket, your database, optional UI.

[Live demo](https://file-next-test-production.up.railway.app)

Bytes live in object storage. The tree, search, trash, shares, and quota live in SQLite or Postgres. Tenant comes from `getAuth()`, never from the client.

```bash
pnpm add @vryzel/file-next @vryzel/file-next-headless @vryzel/file-next-ui
```

## Quick path

**1. Server** — store + filesystem + actions ([full core docs](./packages/core/README.md)):

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
    tenantId: asTenantId("demo"),
    userId: asUserId("user-1"),
  }),
});
```

**2. UI** — default explorer ([full UI docs](./packages/ui/README.md)):

```tsx
"use client";
import { FileExplorer } from "@vryzel/file-next-ui";

<FileExplorer
  className="h-[70vh] overflow-hidden rounded-[10px] border"
  tenantId="demo"
  parentId={folderId}
  listFiles={listFiles}
  searchFiles={searchFiles}
  listTrash={listTrash}
  requestUpload={requestUpload}
  actions={fileActions}
  onOpenFolder={(folder) => setFolderId(folder.id)}
/>
```

Scan `@vryzel/file-next-ui/dist` in `tailwind.config` `content`. CORS/IAM: [`docs/provider-setup.md`](./docs/provider-setup.md).

## Which package

| I want to… | Package |
|---|---|
| Talk to S3/R2 + SQLite/Postgres, server actions | [`@vryzel/file-next`](./packages/core/README.md) |
| Build my own UI with hooks | [`@vryzel/file-next-headless`](./packages/headless/README.md) |
| Drop in a Drive-like explorer | [`@vryzel/file-next-ui`](./packages/ui/README.md) |
| Diagnose env (`doctor`) | [`@vryzel/file-next-cli`](./packages/cli/README.md) |

Each package README has copy-paste use cases.

## Docs

- [Live demo](https://file-next-test-production.up.railway.app)
- [Install](./docs/github-packages.md)
- [Provider setup](./docs/provider-setup.md)
- [Architecture](./docs/architecture.md)
- [Security](./docs/security.md)

```bash
pnpm test:run           # Postgres skips if nothing listens
pnpm test:integration   # S3; skips without INTEGRATION_S3_ENDPOINT
pnpm typecheck
```

## License

MIT
