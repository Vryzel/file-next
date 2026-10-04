import { describe, expect, it } from "vitest";
import { gridColumnCount, selectionEdgeIndex, shouldLoadMore } from "../src/virtual-window";

describe("shouldLoadMore", () => {
  const ready = { loaded: 50, hasMore: true, loading: false };

  it("is false when paging is blocked or the window end is unknown", () => {
    expect(shouldLoadMore({ ...ready, lastIndex: 49, hasMore: false })).toBe(false);
    expect(shouldLoadMore({ ...ready, lastIndex: 49, loading: true })).toBe(false);
    expect(shouldLoadMore({ ...ready, lastIndex: 0, loaded: 0 })).toBe(false);
    expect(shouldLoadMore({ ...ready, lastIndex: undefined })).toBe(false);
  });

  it("is true within 8 items of the end", () => {
    expect(shouldLoadMore({ ...ready, lastIndex: 40 })).toBe(false);
    expect(shouldLoadMore({ ...ready, lastIndex: 41 })).toBe(true);
    expect(shouldLoadMore({ ...ready, lastIndex: 49 })).toBe(true);
  });
});

describe("selectionEdgeIndex", () => {
  const files = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("scrolls to the edge that entered the selection", () => {
    expect(selectionEdgeIndex(files, new Set(["b"]), new Set())).toBe(1);
    expect(selectionEdgeIndex(files, new Set(["a", "b"]), new Set(["b"]))).toBe(0);
    expect(selectionEdgeIndex(files, new Set(["b", "c"]), new Set(["b"]))).toBe(2);
    expect(selectionEdgeIndex(files, new Set(["b"]), new Set(["b"]))).toBe(-1);
  });
});

describe("gridColumnCount", () => {
  it("follows the container width breakpoints", () => {
    expect(gridColumnCount(0)).toBe(3);
    expect(gridColumnCount(639)).toBe(3);
    expect(gridColumnCount(640)).toBe(5);
    expect(gridColumnCount(767)).toBe(5);
    expect(gridColumnCount(768)).toBe(6);
    expect(gridColumnCount(1023)).toBe(6);
    expect(gridColumnCount(1024)).toBe(8);
  });
});
