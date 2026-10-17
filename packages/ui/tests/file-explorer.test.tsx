import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileExplorer } from "../src/file-explorer";
import type { FileNode } from "../src/types";

const actions = {
  deleteFile: async () => undefined,
  moveFile: async () => undefined,
  copyFile: async () => undefined,
  renameFile: async () => undefined,
};

const emptyList = async () => ({
  ok: true as const,
  value: { items: [] as const },
});

function file(name: string): FileNode {
  return {
    id: name,
    tenantId: "demo" as FileNode["tenantId"],
    parentId: null,
    name,
    path: name,
    kind: "file",
    size: 12,
    mimeType: "text/plain",
    s3Key: name,
    ownerId: "owner" as FileNode["ownerId"],
    metadata: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
}

function folder(id: string, name: string): FileNode {
  return { ...file(name), id, name, kind: "folder", path: name, s3Key: name };
}

const boxProps = ["clientHeight", "clientWidth", "offsetHeight", "offsetWidth"] as const;
const boxOriginals = boxProps.map(
  (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const,
);

function stubBox(viewportHeight: number, viewportWidth = 800): void {
  const heightOf = function (this: HTMLElement) {
    const className = typeof this.className === "string" ? this.className : "";
    if (className.includes("overflow-y-auto")) return viewportHeight;
    if (this.getAttribute("data-index") != null) return 44;
    return 0;
  };
  const widthOf = function (this: HTMLElement) {
    const className = typeof this.className === "string" ? this.className : "";
    if (className.includes("overflow-y-auto")) return viewportWidth;
    return 800;
  };
  for (const key of ["clientHeight", "offsetHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: heightOf });
  }
  for (const key of ["clientWidth", "offsetWidth"] as const) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: widthOf });
  }
}

function restoreBox(): void {
  for (const [key, descriptor] of boxOriginals) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
}

describe("FileExplorer", () => {
  afterEach(restoreBox);

  it("renders the default empty folder", async () => {
    render(
      <FileExplorer tenantId="demo" parentId={null} listFiles={emptyList} actions={actions} />,
    );
    await waitFor(() => {
      expect(screen.getByText("This folder is empty")).toBeInTheDocument();
    });
  });

  it("loads the next page without a Load more button", async () => {
    stubBox(8000);
    const listFiles = vi.fn(async (input: { cursor?: string }) => {
      if (!input.cursor) {
        return {
          ok: true as const,
          value: {
            items: Array.from({ length: 50 }, (_, i) => file(`a-${String(i).padStart(2, "0")}`)),
            nextCursor: "page-2",
          },
        };
      }
      return {
        ok: true as const,
        value: {
          items: Array.from({ length: 10 }, (_, i) => file(`b-${String(i).padStart(2, "0")}`)),
        },
      };
    });
    render(<FileExplorer tenantId="demo" parentId={null} listFiles={listFiles} actions={actions} />);
    await waitFor(() => {
      expect(screen.getByText("b-00")).toBeInTheDocument();
    });
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(listFiles.mock.calls[1]?.[0].cursor).toBe("page-2");
    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
    expect(screen.getByText("a-00")).toBeInTheDocument();
  });

  it("does not repeat the mount fetch when refreshKey is already set", async () => {
    const listFiles = vi.fn(async () => ({
      ok: true as const,
      value: { items: [file("once")] },
    }));
    const listTrash = vi.fn(async () => ({
      ok: true as const,
      value: { items: [] as const },
    }));
    const view = render(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={listFiles}
        listTrash={listTrash}
        actions={actions}
        refreshKey={0}
      />,
    );
    await waitFor(() => {
      expect(listFiles).toHaveBeenCalled();
    });
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(listFiles).toHaveBeenCalledWith({ parentId: null, limit: 50, cursor: undefined });
    expect(listTrash).toHaveBeenCalledTimes(1);
    expect(listTrash).toHaveBeenCalledWith({ limit: 1 });

    view.rerender(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={listFiles}
        listTrash={listTrash}
        actions={actions}
        refreshKey={1}
      />,
    );
    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledTimes(2);
    });
    expect(listTrash).toHaveBeenCalledTimes(2);
  });

  it("mounts only the visible window of a long list", async () => {
    stubBox(360);
    const items = Array.from({ length: 80 }, (_, i) => file(`file-${String(i).padStart(2, "0")}`));
    render(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={async () => ({ ok: true as const, value: { items } })}
        actions={actions}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("file-00")).toBeInTheDocument();
    });
    const rendered = screen.getAllByText(/^file-\d{2}$/);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(80);
  });

  it("shows a loading layer and swallows re-opening the same folder until the listing lands", async () => {
    stubBox(360);
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const designs = () => folder("f1", "Designs");
    let release = () => {};
    const pending = new Promise<{ ok: true; value: { items: ReadonlyArray<FileNode> } }>(
      resolve => {
        release = () => resolve({ ok: true, value: { items: [designs()] } });
      },
    );
    const view = render(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={async () => ({ ok: true as const, value: { items: [designs()] } })}
        onOpenFolder={onOpenFolder}
        actions={actions}
      />,
    );
    const row = await screen.findByText("Designs");

    await user.dblClick(row);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);

    // Navigation starts and the next listing hangs, so the stale row is still on
    // screen — behind the loading layer, but still clickable in jsdom.
    view.rerender(
      <FileExplorer
        tenantId="demo"
        parentId="f1"
        listFiles={() => pending}
        onOpenFolder={onOpenFolder}
        actions={actions}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
    await user.dblClick(row);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    await user.dblClick(await screen.findByText("Designs"));
    expect(onOpenFolder).toHaveBeenCalledTimes(2);
  });
});
