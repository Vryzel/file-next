// @vitest-environment node
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilePreviewDialog } from "../src/file-preview";
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

describe("pdf preview server render", () => {
  it("does not frame an absolute URL before the client can blob it", () => {
    for (const src of [
      "https://app.example.com/api/files/1",
      "http://localhost/api/files/1",
      "http://localhost:3000/api/files/evil.pdf",
    ]) {
      const html = renderToString(
        createElement(FilePreviewDialog, {
          file: file("evil.pdf", "application/pdf"),
          src,
          onClose: () => {},
          onDownload: () => {},
        }),
      );
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain(src);
      expect(html).toContain("Loading");
    }
  });
});
