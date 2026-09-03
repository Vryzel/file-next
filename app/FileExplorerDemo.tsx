"use client";

import { useCallback, useEffect, useState } from "react";
import type { FileNode, FileSystemError, Result } from "@vryzel/file-next";
import { FileExplorer } from "@file-next/ui/file-explorer";
import { DEMO_QUOTA_BYTES } from "./lib/constants";
import {
  copyFileAction,
  createFolderAction,
  createShareAction,
  deleteFileAction,
  listFilesAction,
  listTrashAction,
  moveFileAction,
  restoreNodeAction,
  searchFilesAction,
  usageAction,
} from "./lib/demo-actions";

const revive = (node: FileNode): FileNode => ({
  ...node,
  createdAt: new Date(node.createdAt),
  updatedAt: new Date(node.updatedAt),
  deletedAt: node.deletedAt ? new Date(node.deletedAt) : null,
});

const unwrap = async (
  result: Promise<Result<{ items: ReadonlyArray<FileNode> }, FileSystemError>>,
): Promise<Result<{ items: FileNode[] }, FileSystemError>> => {
  const value = await result;
  if (!value.ok) return value;
  return { ok: true, value: { items: value.value.items.map(revive) } };
};

export function FileExplorerDemo(): React.ReactElement {
  const [parentId, setParentId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Array<{ id: string; name: string }>>([
    { id: "root", name: "Home" },
  ]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshUsage = useCallback(() => {
    void usageAction().then(setUsedBytes);
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshKey, refreshUsage]);

  return (
    <FileExplorer
      tenantId="acme"
      parentId={parentId}
      refreshKey={refreshKey}
      usedBytes={usedBytes}
      quotaBytes={DEMO_QUOTA_BYTES}
      breadcrumbs={crumbs}
      onBreadcrumbNavigate={(seg) => {
        if (seg.id === "root") {
          setParentId(null);
          setCrumbs([{ id: "root", name: "Home" }]);
          return;
        }
        const index = crumbs.findIndex((item) => item.id === seg.id);
        setParentId(seg.id);
        setCrumbs(crumbs.slice(0, index + 1));
      }}
      onOpenFolder={(folder) => {
        setParentId(folder.id);
        setCrumbs((current) => [...current, { id: folder.id, name: folder.name }]);
      }}
      listFiles={({ parentId: folderId }) => unwrap(listFilesAction({ parentId: folderId }))}
      searchFiles={({ query }) => unwrap(searchFilesAction({ query: query ?? "" }))}
      listTrash={() => unwrap(listTrashAction())}
      requestUpload={async (file) => ({
        url: `/api/upload?name=${encodeURIComponent(file.name)}&parentId=${parentId ?? ""}`,
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
      })}
      onMove={async ({ itemIds, destinationFolderId }) => {
        for (const id of itemIds) {
          await moveFileAction({ id, newParentId: destinationFolderId });
        }
        setRefreshKey((value) => value + 1);
      }}
      actions={{
        deleteFile: async (input) => {
          await deleteFileAction(input);
          setRefreshKey((value) => value + 1);
        },
        moveFile: async (input) => {
          await moveFileAction(input);
          setRefreshKey((value) => value + 1);
        },
        copyFile: async (input) => {
          await copyFileAction(input);
          setRefreshKey((value) => value + 1);
        },
        renameFile: async (id, newName) => {
          await moveFileAction({ id, newParentId: parentId, newName });
          setRefreshKey((value) => value + 1);
        },
        restoreNode: async (input) => {
          await restoreNodeAction(input);
          setRefreshKey((value) => value + 1);
        },
        createFolder: async (input) => {
          await createFolderAction(input);
          setRefreshKey((value) => value + 1);
        },
        createShare: async (input) => {
          const result = await createShareAction(input);
          if (!result.ok) throw result.error;
          return result.value.url;
        },
      }}
    />
  );
}
