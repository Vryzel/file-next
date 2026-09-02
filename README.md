# file-next

Drive-like files for Next.js: your S3 or R2 bucket, your database, optional shadcn UI.

Bytes live in object storage. The tree, search, trash, shares, and quota live in SQLite or Postgres. Hooks are headless. Tenant comes from `getAuth()`, never from the client.

## Quick path

1. Install from GitHub Packages ([auth](./docs/github-packages.md)):

```bash
pnpm add @vryzel/file-next @vryzel/file-next-headless
```

2. Wire store + filesystem + actions in a server module:

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

Replace `getAuth` with your session. Bucket CORS and env: [`docs/provider-setup.md`](./docs/provider-setup.md).

3. UI: copy `registry/components/file-next/` into your app. `npx shadcn add` from a GitHub raw URL only works once this repository is public.

## Packages

| Package | What |
|---|---|
| [`@vryzel/file-next`](./packages/core) | Storage, metadata stores, server actions, write-through |
| [`@vryzel/file-next-headless`](./packages/headless) | 6 hooks: `useFileBrowser`, `useFileExplorer`, `useUploader`, `useFileActions`, `useFileUrl`, `useDownloadProgress` |
| [`@vryzel/file-next-cli`](./packages/cli) | `migrate`, `reconcile`, `doctor` |

## Registry

13 shadcn items in [`registry/`](./registry/). The composed block is `file-explorer`.

## Repo

| Path | Purpose |
|---|---|
| `packages/core/` | Adapter, metadata, server, sync |
| `packages/headless/` | React hooks |
| `packages/cli/` | CLI |
| `registry/` | shadcn items |
| `docs/` | Architecture, security, provider setup, GitHub Packages |
| `app/` | Demo Next.js app |

```bash
pnpm test:run      # unit tests; Postgres skips if nothing listens on POSTGRES_TEST_URL
pnpm test:integration  # S3; skips without INTEGRATION_S3_ENDPOINT
pnpm typecheck
```

## Next

- [GitHub Packages](./docs/github-packages.md)
- [Provider setup](./docs/provider-setup.md)
- [Architecture](./docs/architecture.md)
- [Security](./docs/security.md)

## License

MIT
