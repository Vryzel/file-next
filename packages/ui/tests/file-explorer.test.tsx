import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FileExplorer } from "../src/file-explorer";

const emptyList = async () => ({
  ok: true as const,
  value: { items: [] as const },
});

describe("FileExplorer", () => {
  it("renders the default empty folder", async () => {
    render(
      <FileExplorer
        tenantId="demo"
        parentId={null}
        listFiles={emptyList}
        actions={{
          deleteFile: async () => undefined,
          moveFile: async () => undefined,
          copyFile: async () => undefined,
          renameFile: async () => undefined,
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("This folder is empty")).toBeInTheDocument();
    });
  });
});
