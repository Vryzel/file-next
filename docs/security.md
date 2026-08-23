# Security

> What file-next enforces and what your application is responsible for.

## The three boundaries

| Boundary | Enforced by | What you must do |
|---|---|---|
| Server ↔ storage | AWS SigV4 / R2 token | Least-privilege IAM. |
| Server ↔ database | TLS + optional Postgres RLS | Connection string; rotate credentials. |
| Browser ↔ server | Your auth | Pass `getAuth` into `createServerActions` and route handlers. Wrap extra routes with `withAuth`. |

`tenantId` is **not** accepted from the client on server actions. If you skip `getAuth`, you do not have a multi-tenant product.

Upload and download route handlers generate the object id on the server. Do not sign a client-supplied key.

## Tenant isolation (one bucket)

Default: `forTenant(id)` writes to `t/{id}/{nodeId}` in the **same** bucket. The metadata store filters every query by `tenantId`. Postgres can add RLS.

That is enough for a normal SaaS **if** the IAM cannot list/get the whole bucket:

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:HeadObject"],
  "Resource": "arn:aws:s3:::your-bucket/t/*"
}
```

```json
{
  "Effect": "Allow",
  "Action": ["s3:ListBucket"],
  "Resource": "arn:aws:s3:::your-bucket",
  "Condition": { "StringLike": { "s3:prefix": ["t/*"] } }
}
```

On R2, scope the API token to prefix `t/` (or the whole bucket if the token is server-only and never leaves the process).

`prefixTenantKeys: false` is only for a single-tenant bucket or a token that cannot write under `t/`. Do not ship a multi-tenant product that way.

A **bucket per tenant** is a separate `createFileSystem({ bucket })` — use it when a customer requires their own encryption key or offboarding by deleting the bucket.

## CORS for browser-direct uploads

Presigned uploads are `PUT`. Configure the bucket:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": ["https://your-app.example.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## Checklist

- [ ] Every `createServerActions` call has `getAuth` from the session.
- [ ] Upload/download handlers pass `getAuth` or sit behind `withAuth`.
- [ ] Bucket CORS allows PUT from your origin only.
- [ ] IAM is scoped to one bucket (and a prefix if you can).
- [ ] `FILE_NEXT_*` secrets never enter the client bundle.
