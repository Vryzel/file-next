"use server";

import { getActions } from "./file-next-store";
import type { FileSystemError } from "file-next";

export async function createDemoFile(): Promise<
  { ok: true; value: void } | { ok: false; error: FileSystemError }
> {
  const actions = getActions();
  const folder = await actions.createFolder({ parentId: null, name: `demo-${Date.now()}` });
  if (!folder.ok) return folder;
  return { ok: true, value: undefined };
}
