# Architecture

> How file-next stores files in S3/R2 while keeping a fast, queryable index in your own database.

## Quick path

1. The browser asks Next.js for a file list.
2. Next.js asks the **metadata store** (your database) for the tree.
3. Bytes live in **S3 or R2**. The browser talks to them via presigned URLs.
4. Writes go through **write-through**: object first, then the tree. Failures land in `pending_orphans`.

```
Browser ──► Next.js (your code)
              │
              ├──► Metadata store (Postgres / SQLite / memory)
              │     tree, names, owner, size, mime, search, trash, shares
              │
              └──► Object storage (S3 / R2)
                    bytes, keyed by node UUID under t/{tenantId}/
```

## Core concepts

| Concept | What it is |
|---|---|
| `createFileSystem(config, { store, quotaBytes })` | Wires adapter + metadata + quota. |
| `createMemoryFileSystem({ store })` | Same shape, no AWS. |
| `forTenant(id)` | Prefixes every object key with `t/{id}/`. |
| `getAuth()` | Server actions take tenant/user from the server, not the client. |
| `withAuth(resolve, handler)` | 401 wrapper for Route Handlers. |
| Object key | The node UUID. Rename/move do not rewrite the object. Copy writes a new UUID. |

## Tenant isolation

1. **Prefix** — `forTenant('acme')` writes to `t/acme/{nodeId}`.
2. **App filter** — every store method takes `tenantId`.
3. **Postgres RLS** — `SET LOCAL app.current_tenant` + `FORCE ROW LEVEL SECURITY` on `nodes` and `pending_orphans`.

## What is still your job

- Wire `getAuth` to Clerk / Auth.js / your session.
- CORS on the bucket (`PUT` from your origin).
- Encryption at rest, AV scanning, audit logs.

## Next step

- [`provider-setup.md`](./provider-setup.md)
- [`security.md`](./security.md)
