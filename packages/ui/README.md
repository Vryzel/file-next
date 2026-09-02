# @vryzel/file-next-ui

Ready-to-use file explorer for `@vryzel/file-next`. Tailwind classes. Compose the pieces, or drop in `FileExplorer`.

```bash
pnpm add @vryzel/file-next-ui
```

Scan the package in `tailwind.config`:

```js
content: ["./node_modules/@vryzel/file-next-ui/dist/**/*.{js,mjs}"]
```

## Default explorer

```tsx
import { FileExplorer } from "@vryzel/file-next-ui";

<FileExplorer
  className="h-[70vh] rounded-[10px] border border-border"
  tenantId="acme"
  parentId={null}
  listFiles={listFiles}
  searchFiles={searchFiles}
  listTrash={listTrash}
  requestUpload={requestUpload}
  actions={actions}
  onOpenFolder={setFolder}
/>
```

Pass `labels` to override copy. Pass `className` on any piece to restyle.

Put `UploadQueueProvider` on a layout if uploads should survive unmounting the page.

## Pieces

`ExplorerToolbar`, `ExplorerListView`, `ExplorerGridView`, `ExplorerContextMenu`, `Breadcrumbs`, `EmptyState`, `ErrorState`, `FileIcon`, `FilePreviewDialog`, `CreateFolderDialog`, `ConfirmDeleteDialog`, `ExplorerSelectionToast`, `ExplorerUploadStatus`.
