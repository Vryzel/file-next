# @vryzel/file-next-headless

Headless React hooks for file-next. No UI, no Tailwind, no Radix. You inject server callbacks; the hook owns state.

```bash
pnpm add @vryzel/file-next-headless
```

Peer: `react`, `@vryzel/file-next`. Safe in Client Components — it never imports `server-only`.

## Quick path

```tsx
"use client";
import { useFileBrowser } from "@vryzel/file-next-headless";
import { asTenantId } from "@vryzel/file-next";
import { listFiles } from "./actions"; // "use server"

export function Folder({ parentId }: { parentId: string | null }) {
  const { status, files, error, refetch } = useFileBrowser({
    listFiles,
    tenantId: asTenantId("acme"),
    parentId,
    autoFetch: true,
  });

  if (status === "loading") return <p>Loading…</p>;
  if (status === "error") return <p>{error?.message}</p>;
  return (
    <ul>
      {files.map((f) => (
        <li key={f.id}>{f.name}</li>
      ))}
    </ul>
  );
}
```

`listFiles` must be a **stable** function (module-level or `useCallback`). A new arrow every render refetches.

## Hooks

| Hook | Use when |
|---|---|
| `useFileBrowser` | You need a list + loading/empty/error |
| `useFileExplorer` | List + view mode + selection + drag |
| `useUploader` | XHR upload with `%` and cancel |
| `useFileActions` | Optimistic delete/move/copy/rename |
| `useFileUrl` | Resolve a presigned download URL |
| `useDownloadProgress` | Browser download with progress |

If you want the full explorer UI, use `@vryzel/file-next-ui` instead of assembling these yourself.

## Use cases

### 1. List a folder — `useFileBrowser`

```tsx
const { status, files, error, refetch } = useFileBrowser({
  listFiles,          // (input) => Promise<Result<{ items }, FileSystemError>>
  tenantId,
  parentId,           // null = root
  autoFetch: true,
  limit: 50,
});
```

Statuses: `idle` → `loading` → `success` | `error`.

### 2. Custom explorer chrome — `useFileExplorer`

```tsx
const explorer = useFileExplorer({
  listFiles,
  tenantId,
  parentId,
  initialView: "list",
  onMove: async ({ itemIds, destinationFolderId }) => {
    await moveFiles({ itemIds, destinationFolderId });
  },
});

explorer.view;          // "list" | "grid"
explorer.setView("grid");
explorer.selectedId;
explorer.beginDrag(id);
explorer.commitDrop(destinationFolderId);
```

### 3. Upload with progress — `useUploader`

Uses **XHR**, not `fetch`, so `progress` is real.

```tsx
const uploader = useUploader({
  requestUpload: async (file) => ({
    url: `/api/upload?name=${encodeURIComponent(file.name)}`,
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
  }),
  confirmUpload: async () => {
    await refetch();
  },
});

<input
  type="file"
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploader.upload({
      name: file.name,
      size: file.size,
      type: file.type,
      content: file,
    });
  }}
/>
<button type="button" onClick={uploader.cancel} disabled={uploader.status !== "uploading"}>
  Cancel {uploader.progress}%
</button>
```

For a queue that survives leaving the page, use `UploadQueueProvider` from `@vryzel/file-next-ui`.

### 4. Optimistic mutations — `useFileActions`

```tsx
const [files, setFiles] = useState(listed);
const { deleteFile, moveFile, copyFile, renameFile, isPending, error } =
  useFileActions({
    files,
    setFiles,
    actions: {
      deleteFile: (input) => deleteFileAction(input),
      moveFile: (input) => moveFileAction(input),
      copyFile: (input) => copyFileAction(input),
      renameFile: async (id, newName) => {
        await moveFileAction({ id, newParentId: parentId, newName });
      },
    },
  });
```

On failure the previous list is restored.

### 5. Preview / download URL — `useFileUrl`

```tsx
const { url, status } = useFileUrl({
  getDownloadUrl: ({ key }) => getDownloadUrlAction({ key }),
  key: file.s3Key,
});
return url ? <img src={url} alt={file.name} /> : null;
```

### 6. Download with progress — `useDownloadProgress`

Starts when `url` is set. Status: `idle` | `loading` | `success` | `error` | `aborted`.

```tsx
const dl = useDownloadProgress({ url: signedUrl });
<p>{dl.status === "loading" ? `${dl.progress}%` : dl.status}</p>
<button type="button" onClick={dl.cancel}>Cancel</button>
{dl.blob ? <a href={URL.createObjectURL(dl.blob)} download>Save</a> : null}
```

## Contract

Callbacks return the same `Result` as the server:

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

Do not import `@vryzel/file-next/server` from a file that also imports these hooks.
