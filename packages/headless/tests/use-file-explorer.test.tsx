import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { asTenantId, asUserId, type FileNode } from "@vryzel/file-next";
import { useFileExplorer } from "@/use-file-explorer";

const makeNode = (id: string, kind: FileNode["kind"]): FileNode => ({
  id,
  tenantId: asTenantId("demo"),
  parentId: null,
  name: id,
  path: `/${id}`,
  kind,
  size: 0,
  mimeType: "",
  s3Key: id,
  ownerId: asUserId("user-1"),
  metadata: {},
  createdAt: new Date("2026-07-29T00:00:00Z"),
  updatedAt: new Date("2026-07-29T00:00:00Z"),
  deletedAt: null,
});

const files = [makeNode("source", "file"), makeNode("folder", "folder")];

const renderExplorer = (onMove: ReturnType<typeof vi.fn>) => {
  const listFiles = vi.fn(async () => ({
    ok: true as const,
    value: { items: files },
  }));
  return renderHook(() =>
    useFileExplorer({
      tenantId: asTenantId("demo"),
      parentId: null,
      listFiles,
      onMove,
    }),
  );
};

describe("useFileExplorer drag/drop", () => {
  it("moves the dragged item to a folder and clears drag state", async () => {
    const onMove = vi.fn();
    const { result } = renderExplorer(onMove);
    await waitFor(() => expect(result.current.files).toHaveLength(2));

    act(() => result.current.beginDrag("source"));
    act(() => result.current.setDropTarget("folder"));
    act(() => result.current.commitDrop("folder"));

    expect(onMove).toHaveBeenCalledWith({
      itemIds: ["source"],
      destinationFolderId: "folder",
    });
    expect(result.current.draggingId).toBeNull();
    expect(result.current.dropTargetId).toBeNull();
  });

  it("rejects non-folder destinations", async () => {
    const onMove = vi.fn();
    const { result } = renderExplorer(onMove);
    await waitFor(() => expect(result.current.files).toHaveLength(2));

    act(() => result.current.beginDrag("folder"));
    act(() => result.current.commitDrop("source"));

    expect(onMove).not.toHaveBeenCalled();
  });
});
