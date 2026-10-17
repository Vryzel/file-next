import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileExplorer } from "../src/file-explorer";
import type { FileNode } from "../src/types";

const emptyList = async () => ({
  ok: true as const,
  value: { items: [] as const },
});

const folder = (id: string, name: string) =>
  ({
    id,
    tenantId: "demo",
    name,
    kind: "folder",
    parentId: null,
    size: 0,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    deletedAt: null,
  }) as unknown as FileNode;

const listWith = (items: ReadonlyArray<FileNode>) => async () => ({
  ok: true as const,
  value: { items },
});

const actions = {
  deleteFile: async () => undefined,
  moveFile: async () => undefined,
  copyFile: async () => undefined,
  renameFile: async () => undefined,
};

const busyList = () => {
  let release = () => {};
  const promise = new Promise<{ ok: true; value: { items: ReadonlyArray<FileNode> } }>(
    resolve => {
      release = () => resolve({ ok: true, value: { items: [folder("f1", "Designs")] } });
    },
  );
  return { list: () => promise, release: () => release() };
};

describe("FileExplorer", () => {
  it("renders the default empty folder", async () => {
    render(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={emptyList}
        actions={actions}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("This folder is empty")).toBeInTheDocument();
    });
  });

  it("shows a loading layer and swallows re-opening the same folder until the listing lands", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const rows = [folder("f1", "Designs")];
    const next = busyList();
    const { rerender } = render(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={listWith(rows)}
        onOpenFolder={onOpenFolder}
        actions={actions}
      />,
    );
    const row = await screen.findByText("Designs");

    await user.dblClick(row);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);

    // The listing for the new folder hangs, so the stale row stays on screen
    // behind the loading layer.
    rerender(
      <FileExplorer
        tenantId="demo"
        parentId="f1"
        listFiles={next.list}
        onOpenFolder={onOpenFolder}
        actions={actions}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    await user.dblClick(row);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);

    next.release();
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    await user.dblClick(await screen.findByText("Designs"));
    expect(onOpenFolder).toHaveBeenCalledTimes(2);
  });
});