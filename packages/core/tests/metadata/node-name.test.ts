import { describe, expect, it } from "vitest";
import { NODE_NAME_MAX_LENGTH, normalizeNodeName } from "@/metadata/node-name";

describe("normalizeNodeName", () => {
  it("trims whitespace", () => {
    const r = normalizeNodeName("  report.pdf  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("report.pdf");
  });

  it("replaces slashes so path stays a single segment", () => {
    const r = normalizeNodeName("a/b\\c.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("a-b-c.txt");
  });

  it("rejects empty, dot, and dot-dot", () => {
    for (const raw of ["", "   ", ".", ".."]) {
      const r = normalizeNodeName(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("Conflict");
    }
  });

  it("turns a lone slash into a hyphen", () => {
    const r = normalizeNodeName("/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("-");
  });

  it("truncates to 255 and keeps a short extension", () => {
    const r = normalizeNodeName(`${"n".repeat(300)}.pdf`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(NODE_NAME_MAX_LENGTH);
    expect(r.value.endsWith(".pdf")).toBe(true);
  });
});
