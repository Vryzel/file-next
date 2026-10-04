import { describe, expect, it } from "vitest";
import { uploadQueuePercent } from "../src/explorer-upload-status";
import type { UploadQueueItem } from "../src/use-upload-queue";

function item(patch: Partial<UploadQueueItem> & Pick<UploadQueueItem, "status" | "size">): UploadQueueItem {
  return {
    id: patch.id ?? patch.status,
    name: patch.name ?? patch.status,
    type: "text/plain",
    parentId: null,
    progress: 0,
    ...patch,
  };
}

describe("uploadQueuePercent", () => {
  it("weights progress by file size", () => {
    expect(
      uploadQueuePercent([
        item({ status: "success", size: 100, progress: 100 }),
        item({ status: "uploading", size: 300, progress: 50 }),
      ]),
    ).toBe(63);
  });

  it("does not treat a tiny finished file as half of a large queued file", () => {
    expect(
      uploadQueuePercent([
        item({ status: "success", size: 1, progress: 100 }),
        item({ status: "queued", size: 99, progress: 0 }),
      ]),
    ).toBe(1);
  });
});
