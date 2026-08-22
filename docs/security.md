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
