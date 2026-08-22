import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplorerToolbar } from "@/components/file-next/explorer-toolbar";

describe("ExplorerToolbar", () => {
  it("searches and toggles trash when those callbacks are provided", () => {
    const onQueryChange = vi.fn();
    const onTrashToggle = vi.fn();
    render(
      <ExplorerToolbar
        view="list"
        onViewChange={() => undefined}
        query=""
        onQueryChange={onQueryChange}
        trashOpen={false}
        onTrashToggle={onTrashToggle}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search files"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByLabelText("Trash"));

    expect(onQueryChange).toHaveBeenCalledWith("invoice");
    expect(onTrashToggle).toHaveBeenCalledTimes(1);
  });
});
