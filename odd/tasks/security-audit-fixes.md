# Security audit fixes

Objective: close the file-next findings from the 2026-10-24 audit. Branch: `fix/security-audit-2026-10-24` (from `main` @ 0.5.3). Delivery: feature-branch-chain (user chose this over stacked-to-main). Test runner: `pnpm test:run`.

## Specs

S1. P0-1. Cascada de `moveNode`/`deleteNode` por `path LIKE` sin `tenant_id` y sin escapar comodines. Un usuario de un tenant puede, renombrando o borrando una carpeta propia, renombrar rutas o mandar a la papelera archivos de otros tenants. Una carpeta llamada `%` borrada en recursivo manda a la papelera todo el contenido anidado de todos los tenants. Filtrar siempre por tenant y escapar el prefijo. Añadir un test de contrato de aislamiento que cree el mismo nombre de carpeta en dos tenants y compruebe que `moveNode`/`deleteNode`/`purgeNode` no tocan el otro, y que una carpeta llamada `%` o `_` solo afecta a su propio subárbol.

S2. P1-1. Subidas presignadas: la URL de PUT no firma `Content-Length`. `prepareUpload` no aplica ni `maxBytes` ni tipos permitidos. En el route handler, `maxBytes` se salta omitiendo `contentLength`. La cuota solo se mira en `confirmUpload`, y si falla el objeto se queda en el bucket. Firmar el tamaño declarado, validar el cuerpo antes de firmar, y en confirm borrar el objeto si no cumple.

S3. P2-1. Route handlers de upload/download fallan abiertos si se omite `getAuth`: download firma cualquier `?key=` del bucket. `getAuth` es obligatorio salvo un opt-in explícito `unsafeNoAuth`.

S4. P2-2. Download firma la `key` que elige el cliente dentro del prefijo del tenant, sin consultar el store. No firmar objetos en papelera, no confirmados o claves que no son un nodo vivo del tenant.

S5. P2-3. El tipo de los metadatos lo fija el cliente en `confirmUpload` y puede diferir del objeto. `image/*` deja pasar `image/svg+xml`. Usar el `Content-Type` real de `stat()` y rechazar `text/html`, `application/xhtml+xml`, `image/svg+xml`, `text/xml`, `application/xml`.

S6. P2-4. La ruta pública de share lee el objeto completo en memoria y no envía `X-Content-Type-Options: nosniff` ni `Content-Security-Policy: sandbox`. No servir el cuerpo desde el proceso de la app.

S7. P2-5. `upload`, `download`, `share` y `wrap` devuelven `error.message` interno al cliente. Mensaje genérico hacia el cliente.

S8. P2-6. `limit: z.number().int().positive()` sin `.max()`. `query: z.string()` sin longitud máxima. `listTrash` no valida el input. `z.number().int().positive().max(500)`, `z.string().max(256)`, y un esquema zod para `listTrash`.

S9. P2-7. Vista previa en `<iframe>` sin `sandbox`.

S10. P2-8 / P2-10 / P2-11. `peerDependencies.next: ">=14.2.0"`. CI sin `permissions` ni audit. Demo sin HSTS/CSP/XFO/nosniff y `PUT /api/upload` anónimo con cuerpo sin límite.

## Tasks

- T1 S1 inline done — tenant filter + LIKE escape on sqlite and postgres cascades, plus isolation test. Evidence: sqlite-store.test.ts 55 passed. Postgres suite skipped (no POSTGRES_TEST_URL listener).
- T2 S2 inline done — presigned PUT binds Content-Length; prepareUpload and the route enforce maxBytes/types; confirmUpload deletes on quota/type/size. Evidence: presigned.test.ts, upload.test.ts, write-through.test.ts.
- T3 S3 S4 inline done — route handlers throw without getAuth unless unsafeNoAuth; download 404s a key that is not a live node. Evidence: upload.test.ts, download.test.ts.
- T4 S5 inline done — confirm uses stat content type and denies active markup; image/* does not allow SVG.
- T5 S6 inline done — share sets nosniff/sandbox and redirects above maxBytes.
- T6 S7 S8 inline done — generic client errors; limit max 500; query max 256; listTrash schema.
- T7 S9 inline done — preview iframe sandbox="".
- T8 S10 inline done — next peer >=15.5.28; CI permissions + prod audit; dependabot; demo headers and capped PUT. zod bumped to ^4.6.6 (GHSA-mrhx-c7xc-m3w5, no zod 3 patch).
- T9 quote follow-up pending — consumer still on 0.5.3 until a release; quote-only findings stay in vryzel-quote

## Log

L1. 2026-10-24. Estos son los reportes de una auditoría de seguridad realizada al proyecto de file-next, las vulnerabilidades encontradas también afectan a vryzel-quote, necesito que hagas las correcciones pertinentes

L2. 2026-10-24. User: ahora continua con los fixes de seguridad. Work is on `fix/security-audit-2026-10-24` from `main` @ fbdf2e5. Do not publish. Do not touch Railway, Cloudflare, or DNS.

L3. 2026-10-24. Core suite: 378 passed, 63 skipped (postgres and S3 integration). `pnpm audit --prod --audit-level high` clean after zod 4.6.6. Postgres cascade SQL is the same shape as sqlite but was not executed against a server. Share Range is passed through again after the verifier blocker.

L4. 2026-10-24. User chose feature-branch-chain. Tracker `fix/security-audit-2026-10-24`. Children: 01 tenant isolation, 02 upload limits (includes zod 4 and upload getAuth), 03 download/share handlers, 04 demo/CI/preview/docs. Each child PR targets the previous branch. Do not merge the tracker until the chain is reviewed.
