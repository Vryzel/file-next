# @vryzel/file-next-ui

Ready-made file explorer for Next.js. Import `FileExplorer`, pass server callbacks, done. Or compose the pieces.

```bash
pnpm add @vryzel/file-next-ui
```

Scan the package so Tailwind keeps the classes:

```js
// tailwind.config.ts
content: [
  "./app/**/*.{ts,tsx}",
  "./node_modules/@vryzel/file-next-ui/dist/**/*.{js,mjs}",
]
```

Your theme must define the usual shadcn CSS variables (`--background`, `--foreground`, `--border`, `--primary`, `--muted`, `--destructive`, `--card`, `--ring`, …).

## Quick path

```tsx
"use client";
import { FileExplorer } from "@vryzel/file-next-ui";

<FileExplorer
  className="h-[70vh] overflow-hidden rounded-[10px] border border-border bg-card"
  tenantId="acme"
  parentId={folderId}
  listFiles={listFiles}
  searchFiles={searchFiles}
  listTrash={listTrash}
  requestUpload={requestUpload}
  actions={{
    deleteFile,
    moveFile,
    copyFile,
    renameFile,
    createFolder,
    restoreNode,
    createShare,
  }}
  onOpenFolder={(folder) => setFolderId(folder.id)}
  breadcrumbs={crumbs}
  onBreadcrumbNavigate={(seg) => setFolderId(seg.id === "root" ? null : seg.id)}
/>
```

`listFiles` / `searchFiles` / `listTrash` return:

```ts
Promise<
  | { ok: true; value: { items: FileNode[]; nextCursor?: string } }
  | { ok: false; error: { code: string; message: string } }
>
```

Revive dates if they crossed the server action boundary (`new Date(node.updatedAt)`). `FileExplorer` also revives them.

Keep callback identities stable (`useCallback` or module scope).

## Use cases

### 1. Default explorer (batteries)

What you get with `FileExplorer`:

- List / grid, sort, persisted view (`persistViewKey`)
- Search, trash, upload (multi-file + OS drop)
- New folder / rename dialogs (not `window.prompt`)
- Multi-select, shift-click, ⌘A, copy/paste, drag onto folders
- Pagination (`limit` 50 + Load more)
- Quota footer, selection toast, upload queue

```tsx
<FileExplorer
  persistViewKey="my-app.files.view"
  usedBytes={used}
  quotaBytes={quota}
  refreshKey={refreshKey}
  onPreview={openPreview}
  onDownload={download}
  extraFileAction={{ label: "Create quote", onSelect: (f) => router.push(`/quotes/new?file=${f.id}`) }}
  protectedIds={linkedIds}  // cannot move to trash
  labels={{ search: "Buscar", emptyFolder: "Carpeta vacía" }}
  {...props}
/>
```

### 2. Uploads that survive navigation

Put the provider on a layout. Unmounting the files page will not kill XHR.

```tsx
// app/(dashboard)/layout.tsx
import { UploadQueueProvider } from "@vryzel/file-next-ui";

<UploadQueueProvider requestUpload={requestUpload} confirmUpload={onUploaded}>
  {children}
</UploadQueueProvider>
```

`FileExplorer` uses the nearest provider; if none exists it creates its own.

### 3. Preview dialog

```tsx
import { FileExplorer, FilePreviewDialog, canPreviewFile } from "@vryzel/file-next-ui";

const [preview, setPreview] = useState<{ file: FileNode; src: string } | null>(null);

<FileExplorer
  onPreview={async (file) => {
    const src = await signedUrl(file);
    if (canPreviewFile(file)) setPreview({ file, src });
    else window.open(src, "_blank");
  }}
  onDownload={async (file) => window.open(await signedUrl(file), "_blank")}
/>
<FilePreviewDialog
  file={preview?.file ?? null}
  src={preview?.src ?? ""}
  onClose={() => setPreview(null)}
  onDownload={(file) => void signedUrl(file).then((src) => window.open(src, "_blank"))}
/>
```

`src` is yours (presigned GET). The dialog does not call S3.

### 4. Compose your own shell

```tsx
import {
  Breadcrumbs,
  ExplorerToolbar,
  ExplorerListView,
  ExplorerGridView,
  EmptyState,
  ErrorState,
  FileIcon,
} from "@vryzel/file-next-ui";
import { useFileExplorer } from "@vryzel/file-next-headless";

const explorer = useFileExplorer({ listFiles, tenantId, parentId });

return (
  <div className="flex h-[70vh] flex-col rounded-[10px] border">
    <Breadcrumbs segments={crumbs} onNavigate={go} className="px-4 py-3" />
    <ExplorerToolbar
      view={explorer.view}
      onViewChange={explorer.setView}
      query={query}
      onQueryChange={setQuery}
      sortKey={sortKey}
      sortDirection={sortDir}
      onSortChange={setSort}
    />
    {explorer.status === "error" ? (
      <ErrorState error={explorer.error!} onRetry={explorer.refetch} />
    ) : explorer.files.length === 0 ? (
      <EmptyState title="Empty folder" description="Drop files here." />
    ) : explorer.view === "list" ? (
      <ExplorerListView files={explorer.files} {...selectionAndDrag} />
    ) : (
      <ExplorerGridView files={explorer.files} {...selectionAndDrag} />
    )}
  </div>
);
```

Every piece takes `className`.

### 5. Copy / i18n

```tsx
<FileExplorer
  labels={{
    search: "Buscar",
    upload: "Subir",
    newFolder: "Nueva carpeta",
    emptyFolder: "Esta carpeta está vacía",
    moveToTrash: "Mover a la papelera",
  }}
/>
```

Partial overlay on English defaults. Or wrap several pieces:

```tsx
import { ExplorerLabelsProvider, defaultLabels } from "@vryzel/file-next-ui";

<ExplorerLabelsProvider labels={{ search: "Buscar" }}>
  <ExplorerToolbar ... />
</ExplorerLabelsProvider>
```

### 6. Icons only

```tsx
import { FileIcon } from "@vryzel/file-next-ui";
<FileIcon kind={file.kind} mimeType={file.mimeType} className="size-6" />
```

## Pieces

| Export | Role |
|---|---|
| `FileExplorer` | Default composed explorer |
| `ExplorerToolbar` | Search, upload, new folder, sort, trash, list/grid |
| `ExplorerListView` / `ExplorerGridView` | Rows / cards + drag |
| `ExplorerContextMenu` | Right-click / overflow menu |
| `Breadcrumbs` | Path |
| `EmptyState` / `ErrorState` | Empty / error |
| `FileIcon` | Mime icon |
| `FilePreviewDialog` | Image/pdf/video/text overlay |
| `CreateFolderDialog` / `ConfirmDeleteDialog` | Modals |
| `ExplorerSelectionToast` / `ExplorerClipboardToast` | Multi-select / copy |
| `UploadQueueProvider` / `ExplorerUploadStatus` | Upload queue |
| `defaultLabels` | English copy |

## Not this package

Server wiring → `@vryzel/file-next`. Hooks without UI → `@vryzel/file-next-headless`.
