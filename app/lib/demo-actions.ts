"use server";

import { getActions, getStore, DEMO_TENANT } from "./file-next-store";
import type { FileNode, FileSystemError, Result } from "file-next";

export async function listFilesAction(input: {
  parentId: string | null;
}): Promise<Result<{ items: FileNode[] }, FileSystemError>> {
  return getActions().listFiles(input);
}

export async function searchFilesAction(input: {
  query: string;
}): Promise<Result<{ items: FileNode[] }, FileSystemError>> {
  return getActions().searchFiles(input);
}

export async function listTrashAction(): Promise<
  Result<{ items: FileNode[] }, FileSystemError>
> {
  return getActions().listTrash();
}

export async function createFolderAction(input: {
  name: string;
  parentId: string | null;
}) {
  return getActions().createFolder(input);
}

export async function deleteFileAction(input: { id: string }) {
  return getActions().deleteFile(input);
}

export async function moveFileAction(input: {
  id: string;
  newParentId: string | null;
  newName?: string;
}) {
  return getActions().moveFile(input);
}

export async function copyFileAction(input: {
  id: string;
  newParentId: string | null;
  newName?: string;
}) {
  return getActions().copyFile(input);
}

export async function restoreNodeAction(input: { id: string }) {
  return getActions().restoreNode(input);
}

export async function createShareAction(input: { id: string }) {
  return getActions().createShare(input);
}

export async function usageAction(): Promise<number> {
  const sum = await getStore().sumSize({ tenantId: DEMO_TENANT });
  return sum.ok ? sum.value : 0;
}

export async function createDemoFile() {
  return getActions().createFolder({
    parentId: null,
    name: `demo-${Date.now()}`,
  });
}
