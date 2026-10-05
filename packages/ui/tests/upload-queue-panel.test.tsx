import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExplorerUploadStatus } from "../src/explorer-upload-status";
import type { UploadQueueItem } from "../src/use-upload-queue";

function item(id: string, status: UploadQueueItem["status"]): UploadQueueItem {
  return {
    id,
    name: `${id}.txt`,
    size: 10,
    type: "text/plain",
    parentId: null,
    status,
    progress: status === "uploading" ? 40 : 0,
  };
}

describe("ExplorerUploadStatus queue controls", () => {
  it("cancels the queue and removes one file", () => {
    const onCancel = vi.fn();
    const onRemove = vi.fn();
    render(
      <ExplorerUploadStatus
        items={[item("a", "success"), item("b", "uploading"), item("c", "queued")]}
        onDismiss={vi.fn()}
        onCancel={onCancel}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from queue c.txt" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith("c");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
