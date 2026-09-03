# @vryzel/file-next

S3/R2 filesystem for Next.js. Bytes in your bucket. The folder tree in **your** SQLite or Postgres. Tenant comes from the server, never from the client.

[Live demo](https://file-next-test-production.up.railway.app)

```bash
pnpm add @vryzel/file-next
# optional, depending on the store:
pnpm add better-sqlite3   # SQLite
pnpm add pg               # Postgres
```

Peer deps `better-sqlite3` and `pg` are optional. Install only the one you use.

## Quick path

```ts
// app/lib/file-next.ts
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

```ts
// app/lib/actions.ts
"use server";
import { actions } from "./file-next";

export const listFiles = (input: { parentId: string | null; cursor?: string; limit?: number }) =>
  actions.listFiles(input);
```

Replace `getAuth` with Clerk / Auth.js / your session. Import `@vryzel/file-next/server` only from server modules.

## Use cases

### 1. SQLite (one process)

Default for a single Next.js server.

```ts
import { createSqliteStore } from "@vryzel/file-next";
const store = createSqliteStore({ path: ".data/metadata.db" });
```

Schema is created on first call. Path is relative to `process.cwd()`.

### 2. Postgres (multi-instance + RLS)

```ts
import { createPostgresStore } from "@vryzel/file-next";
const store = createPostgresStore({
  connectionString: process.env.DATABASE_URL!,
});
```

Install `pg`. Tenant isolation uses `SET LOCAL app.current_tenant` + row-level security.

### 3. In-memory (tests / Storybook)

```ts
import { createMemoryStore, createMemoryFileSystem } from "@vryzel/file-next";

const store = createMemoryStore();
const fs = createMemoryFileSystem({ store });
```

No AWS. Data dies with the process.

### 4. Cloudflare R2

```ts
const fs = createFileSystem(
  {
    provider: "r2",
    bucket: process.env.FILE_NEXT_BUCKET!,
    endpoint: process.env.FILE_NEXT_ENDPOINT!, // https://<accountid>.r2.cloudflarestorage.com
    credentials: {
      accessKeyId: process.env.FILE_NEXT_ACCESS_KEY_ID!,
      secretAccessKey: process.env.FILE_NEXT_SECRET_ACCESS_KEY!,
    },
  },
  { store },
);
```

R2 is S3-compatible. Set bucket CORS for `PUT`/`GET` from your origin.

### 5. Env singleton

```ts
import { getFileSystem } from "@vryzel/file-next";
const fs = getFileSystem(); // memoized for the process
```

Reads:

| Var | Required |
|---|---|
| `FILE_NEXT_PROVIDER` | `s3` or `r2` |
| `FILE_NEXT_BUCKET` | yes |
| `FILE_NEXT_REGION` | S3 |
| `FILE_NEXT_ENDPOINT` | R2 |
| `FILE_NEXT_ACCESS_KEY_ID` | yes |
| `FILE_NEXT_SECRET_ACCESS_KEY` | yes |
| `FILE_NEXT_FORCE_PATH_STYLE` | optional |

Missing config throws `FileSystemError` (not retryable).

### 6. Multi-tenant keys

```ts
const scoped = fs.forTenant("acme");
// object keys are prefixed t/acme/{nodeId} unless prefixTenantKeys: false
```

Every store method also takes `tenantId`. Do not take tenant from the request body.

### 7. Server actions

`createServerActions` returns:

`listFiles`, `searchFiles`, `listTrash`, `createFolder`, `deleteFile`, `moveFile`, `copyFile`, `setMetadata`, `prepareUpload`, `confirmUpload`, `restoreNode`, `createShare`, `resolveShare`, `revokeShare`.

All return `Result<T, FileSystemError>`: `{ ok: true, value }` or `{ ok: false, error }`.

```ts
const listed = await actions.listFiles({ parentId: null, limit: 50 });
if (!listed.ok) throw listed.error;
```

`listFiles` / `listTrash` accept `cursor` + `limit`.

`createShare` returns `{ token, url }` where `url` is `/api/share/{token}` (your domain, not the bucket). Mount:

```ts
// app/api/share/[token]/route.ts
import { createShareRouteHandler } from "@vryzel/file-next/server";
export const GET = createShareRouteHandler({ store, fs });
```

The handler streams the object through Next.js. Folders cannot be shared this way. Optional `sharePathPrefix` on `createServerActions` (default `/api/share`).

### 8. Route handlers (upload / download)

```ts
// app/api/upload/route.ts
import { createUploadRouteHandler } from "@vryzel/file-next/server";
import { getFileSystem } from "@vryzel/file-next";

export const PUT = createUploadRouteHandler({
  fs: getFileSystem(),
  maxBytes: 25 * 1024 * 1024,
  allowedContentTypes: ["image/*", "application/pdf"],
});
```

Many apps skip this and PUT to a signed URL / a thin `writeThroughFile` route (see the test app). Use whichever matches your upload flow.

### 9. Write-through (object first, then the tree)

```ts
import { createWriteThrough } from "@vryzel/file-next/sync";

const writeThrough = createWriteThrough(fs, store);
await writeThrough.writeThroughFile({
  tenantId,
  parentId: null,
  name: "photo.png",
  body,
  contentType: "image/png",
  ownerId,
});
```

If the metadata insert fails after the object is written, the key lands in `pending_orphans`. `reconcile()` drains them.

### 10. Result + errors

```ts
import { ok, err, unwrap, type Result } from "@vryzel/file-next";
import { FileSystemError } from "@vryzel/file-next/errors";

if (!result.ok) {
  if (result.error.code === "Conflict") { /* duplicate name */ }
  if (result.error.retryable) { /* backoff */ }
}
```

`@vryzel/file-next/errors` is the client-safe entry (no Node builtins).

## Imports

| Entry | Use from |
|---|---|
| `@vryzel/file-next` | server or shared types |
| `@vryzel/file-next/server` | Server Actions / Route Handlers only (`server-only`) |
| `@vryzel/file-next/sync` | server |
| `@vryzel/file-next/errors` | client or server |

## Not this package

- React hooks → `@vryzel/file-next-headless`
- Ready-made explorer → `@vryzel/file-next-ui`
- CLI → `@vryzel/file-next-cli`

Bucket CORS and IAM: [provider-setup](https://github.com/Vryzel/file-next/blob/main/docs/provider-setup.md), [security](https://github.com/Vryzel/file-next/blob/main/docs/security.md).
