import { createContext, createElement, useContext, type ReactNode } from "react";

export type ExplorerLabels = {
  loading: string;
  emptyFolder: string;
  emptyTrash: string;
  noMatches: string;
  dropHint: string;
  trashRetention: string;
  items: string;
  inTrash: string;
  loadMore: string;
  search: string;
  upload: string;
  newFolder: string;
  folderName: string;
  folderNameHint: string;
  folderExists: string;
  folderCreateFailed: string;
  createFolder: string;
  cancel: string;
  rename: string;
  renameHint: string;
  viewOptions: string;
  listView: string;
  gridView: string;
  sortName: string;
  sortSize: string;
  sortModified: string;
  sortKind: string;
  trash: string;
  folder: string;
  inUse: string;
  itemActions: string;
  preview: string;
  download: string;
  copy: string;
  paste: string;
  copied: string;
  copyShare: string;
  share: string;
  restore: string;
  moveToTrash: string;
  deleteForever: string;
  confirmDelete: string;
  confirmDeleteMany: string;
  confirmPurge: string;
  confirmPurgeMany: string;
  deleting: string;
  selectedCount: string;
  clearSelection: string;
  clearClipboard: string;
  uploadStatus: string;
  dismissUploads: string;
  uploadQueued: string;
  uploadDone: string;
  uploadFailed: string;
  unknownType: string;
  previewUnavailable: string;
};

export const defaultLabels: ExplorerLabels = {
  loading: "Loading…",
  emptyFolder: "This folder is empty",
  emptyTrash: "Trash is empty",
  noMatches: "No matches",
  dropHint: "Drop files here or use Upload.",
  trashRetention: "Deleted files stay here until you purge them.",
  items: "items",
  inTrash: "in trash",
  loadMore: "Load more",
  search: "Search files",
  upload: "Upload",
  newFolder: "New folder",
  folderName: "Folder name",
  folderNameHint: "Name the folder.",
  folderExists: "A folder with that name already exists.",
  folderCreateFailed: "Could not create the folder.",
  createFolder: "Create",
  cancel: "Cancel",
  rename: "Rename",
  renameHint: "Enter a new name.",
  viewOptions: "View options",
  listView: "List view",
  gridView: "Grid view",
  sortName: "Name",
  sortSize: "Size",
  sortModified: "Modified",
  sortKind: "Kind",
  trash: "Trash",
  folder: "Folder",
  inUse: "In use",
  itemActions: "Item actions",
  preview: "Preview",
  download: "Download",
  copy: "Copy",
  paste: "Paste",
  copied: "copied",
  copyShare: "Copy share link",
  share: "Share",
  restore: "Restore",
  moveToTrash: "Move to trash",
  deleteForever: "Delete forever",
  confirmDelete: "Move “{name}” to trash?",
  confirmDeleteMany: "Move {count} items to trash?",
  confirmPurge: "Delete “{name}” forever? This cannot be undone.",
  confirmPurgeMany: "Delete {count} items forever? This cannot be undone.",
  deleting: "Deleting…",
  selectedCount: "selected",
  clearSelection: "Clear selection",
  clearClipboard: "Clear clipboard",
  uploadStatus: "uploading",
  dismissUploads: "Dismiss uploads",
  uploadQueued: "Queued",
  uploadDone: "Done",
  uploadFailed: "Failed",
  unknownType: "Unknown type",
  previewUnavailable: "Preview is not available for this file.",
};

const LabelsContext = createContext<ExplorerLabels>(defaultLabels);

export function ExplorerLabelsProvider({
  labels,
  children,
}: {
  labels?: Partial<ExplorerLabels>;
  children: ReactNode;
}): React.ReactElement {
  const value = { ...defaultLabels, ...labels };
  return createElement(LabelsContext.Provider, { value }, children);
}

export function useExplorerLabels(): ExplorerLabels {
  return useContext(LabelsContext);
}

export function formatLabel(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}
