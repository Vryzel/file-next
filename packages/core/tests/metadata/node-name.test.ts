import { describe, expect, it } from "vitest";
import {
  NODE_NAME_MAX_LENGTH,
  normalizeNodeName,
  numberedDuplicateName,
} from "@/metadata/node-name";

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

describe("numberedDuplicateName", () => {
  it("returns the original when n is not positive", () => {
    expect(numberedDuplicateName("report.pdf", 0)).toBe("report.pdf");
    expect(numberedDuplicateName("report.pdf", -1)).toBe("report.pdf");
  });

  it("inserts (n) before a 1-8 alphanumeric extension", () => {
    expect(numberedDuplicateName("report.pdf", 1)).toBe("report (1).pdf");
    expect(numberedDuplicateName("report.pdf", 2)).toBe("report (2).pdf");
  });

  it("treats a missing or non-alnum extension as part of the stem", () => {
    expect(numberedDuplicateName("README", 1)).toBe("README (1)");
    expect(numberedDuplicateName("notes.final-draft", 1)).toBe(
      "notes.final-draft (1)",
    );
  });

  it("trims the stem so (1) and the extension survive the 255 cap", () => {
    const name = numberedDuplicateName(`${"n".repeat(300)}.pdf`, 1);
    expect(name.endsWith(" (1).pdf")).toBe(true);
    expect(name.length).toBe(NODE_NAME_MAX_LENGTH);
  });
});
