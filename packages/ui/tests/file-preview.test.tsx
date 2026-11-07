import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  FilePreviewDialog,
  canPreviewFile,
  clampPreviewZoom,
  pdfFrameMode,
} from "../src/file-preview";
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clamps zoom", () => {
    expect(clampPreviewZoom(0)).toBe(1);
    expect(clampPreviewZoom(9)).toBe(4);
  });

  it("previews images and text, not html", () => {
    expect(canPreviewFile(file("a.png", "image/png"))).toBe(true);
    expect(canPreviewFile(file("a.txt", "text/plain"))).toBe(true);
    expect(canPreviewFile(file("a.html", "text/html"))).toBe(false);
  });

  it("shows a spinner instead of a blank frame until the PDF is ready", async () => {
    let resolveFetch: (value: {
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    render(
      <FilePreviewDialog
        file={file("plate.pdf", "application/pdf")}
        src={`${window.location.origin}/api/files/1`}
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByRole("status", { name: "Loading…" })).toBeTruthy();
    expect(screen.queryByTitle("plate.pdf")).toBeNull();

    URL.createObjectURL ??= () => "blob:missing";
    URL.revokeObjectURL ??= () => {};
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    resolveFetch({
      ok: true,
      arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
    });
    const frame = await screen.findByTitle("plate.pdf");
    expect(frame.className).toContain("h-full");
    expect(frame.className).not.toContain("opacity-0");
    expect(screen.getByRole("status", { name: "Loading…" })).toBeTruthy();
    fireEvent.load(frame);
    expect(screen.queryByRole("status", { name: "Loading…" })).toBeNull();
    expect(frame).toHaveAttribute("src", "blob:preview");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not sandbox a PDF, and keeps text locked down", async () => {
    const { rerender } = render(
      <FilePreviewDialog
        file={file("plate.pdf", "application/pdf")}
        src="https://cdn.example/plate.pdf"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    expect(await screen.findByTitle("plate.pdf")).not.toHaveAttribute("sandbox");

    rerender(
      <FilePreviewDialog
        file={file("notes.txt", "text/plain")}
        src="https://cdn.example/notes.txt"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByTitle("notes.txt")).toHaveAttribute("sandbox", "");
  });

  it("reframes a same-origin PDF as application/pdf so the host CSP cannot block the viewer", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => bytes,
      }),
    );
    URL.createObjectURL ??= () => "blob:missing";
    URL.revokeObjectURL ??= () => {};
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(
      <FilePreviewDialog
        file={file("plate.pdf", "application/pdf")}
        src={`${window.location.origin}/api/files/1`}
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("plate.pdf")).toHaveAttribute("src", "blob:preview");
    });
    expect(screen.getByTitle("plate.pdf")).not.toHaveAttribute("sandbox");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/pdf");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams a cross-origin PDF and blobs a same-origin one", () => {
    expect(pdfFrameMode("https://cdn.example/a.pdf", "http://localhost:3000")).toBe("direct");
    expect(pdfFrameMode("/api/files/1", "http://localhost:3000")).toBe("blob");
    expect(pdfFrameMode("http://localhost:3000/api/files/1", "http://localhost:3000")).toBe(
      "blob",
    );
    expect(pdfFrameMode("javascript:alert(1)", "http://localhost:3000")).toBe("blob");
  });

  it("does not frame a same-origin URL when the fetch fails", async () => {
    const src = `${window.location.origin}/api/files/1`;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    render(
      <FilePreviewDialog
        file={file("evil.pdf", "application/pdf")}
        src={src}
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Preview is not available for this file.")).toBeTruthy();
    });
    expect(document.body.innerHTML).not.toContain(src);
    vi.unstubAllGlobals();
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
    const img = screen.getByRole("img", { name: "shot.png", hidden: true });
    fireEvent.load(img);
    expect(img).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(img).toHaveStyle({ transform: "translate(0px, 0px) scale(1.25)" });
    expect(screen.queryByText("image/png")).toBeNull();
  });
});
