import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FilePreviewDialog, canPreviewFile, clampPreviewZoom } from "../src/file-preview";
import type { FileNode } from "../src/types";

function file(name: string, mimeType: string): FileNode {
  return {
    id: "1",
    tenantId: "t" as FileNode["tenantId"],
    parentId: null,
    name,
    path: name,
    kind: "file",
    size: 1,
    mimeType,
    s3Key: "1",
    ownerId: "u" as FileNode["ownerId"],
    metadata: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
}

describe("file preview", () => {
  it("clamps zoom", () => {
    expect(clampPreviewZoom(0)).toBe(1);
    expect(clampPreviewZoom(9)).toBe(4);
  });

  it("previews images and text, not html", () => {
    expect(canPreviewFile(file("a.png", "image/png"))).toBe(true);
    expect(canPreviewFile(file("a.txt", "text/plain"))).toBe(true);
    expect(canPreviewFile(file("a.html", "text/html"))).toBe(false);
  });

  it("zooms an image without a dialog card", () => {
    render(
      <FilePreviewDialog
        file={file("shot.png", "image/png")}
        src="https://example.test/shot.png"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    const img = screen.getByRole("img", { name: "shot.png" });
    expect(img).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(img).toHaveStyle({ transform: "translate(0px, 0px) scale(1.25)" });
    expect(screen.queryByText("image/png")).toBeNull();
  });
});
