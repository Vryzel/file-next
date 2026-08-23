import { describe, expect, it } from "vitest";
import { sanitizeFts5Query, sanitizeLikePattern } from "@/metadata/sanitize";

describe("sanitizeFts5Query", () => {
  it("wraps a simple phrase in double quotes", () => {
    expect(sanitizeFts5Query("hello world")).toBe('"hello world"');
  });

  it("makes FTS5 column syntax literal by wrapping in a phrase", () => {
    // `name:foo` is FTS5 column-filter syntax. Phrase-wrapping makes it literal.
    expect(sanitizeFts5Query("name:foo")).toBe('"name:foo"');
  });

  it("makes FTS5 wildcard syntax literal", () => {
    // `*` and `?` are FTS5 wildcards. Inside a phrase they are literal.
    expect(sanitizeFts5Query("*wild*")).toBe('"*wild*"');
  });

  it("makes FTS5 grouping/operator syntax literal", () => {
    expect(sanitizeFts5Query("(parens)")).toBe('"(parens)"');
  });

  it("doubles embedded double quotes (FTS5 phrase-escape)", () => {
    // FTS5 escapes an embedded `"` by doubling it inside a phrase.
    expect(sanitizeFts5Query('say "hi"')).toBe('"say ""hi"""');
  });

  it("treats FTS5 keywords (AND/OR/NOT/NEAR) as literal in a phrase", () => {
    expect(sanitizeFts5Query("foo AND bar")).toBe('"foo AND bar"');
    expect(sanitizeFts5Query("foo OR bar")).toBe('"foo OR bar"');
    expect(sanitizeFts5Query("foo NOT bar")).toBe('"foo NOT bar"');
    expect(sanitizeFts5Query("foo NEAR bar")).toBe('"foo NEAR bar"');
  });

  it("returns an empty phrase for an empty query", () => {
    // Caller treats empty query as "no results" — the sanitizer must
    // produce a valid (empty) FTS5 phrase, not crash.
    expect(sanitizeFts5Query("")).toBe('""');
  });

  it("preserves a whitespace-only query as a phrase of spaces", () => {
    expect(sanitizeFts5Query("   ")).toBe('"   "');
  });

  it("preserves Unicode and diacritics inside the phrase", () => {
    // Tokenizer handles folding; the sanitizer does not strip Unicode.
    expect(sanitizeFts5Query("café naïve")).toBe('"café naïve"');
  });
});

describe("sanitizeLikePattern", () => {
  it("escapes a literal %", () => {
    expect(sanitizeLikePattern("100%")).toBe("100\\%");
  });

  it("escapes a literal _", () => {
    expect(sanitizeLikePattern("under_score")).toBe("under\\_score");
  });

  it("escapes a literal backslash (must come first)", () => {
    // Order matters: \ first so we don't double-escape our own escapes.
    expect(sanitizeLikePattern("back\\slash")).toBe("back\\\\slash");
  });

  it("escapes a mix of all three meta-characters", () => {
    expect(sanitizeLikePattern("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });

  it("passes through a plain string unchanged", () => {
    expect(sanitizeLikePattern("plain text 123")).toBe("plain text 123");
  });

  it("returns an empty string for an empty query", () => {
    expect(sanitizeLikePattern("")).toBe("");
  });

  it("preserves a whitespace-only query", () => {
    expect(sanitizeLikePattern("   ")).toBe("   ");
  });

  it("preserves Unicode and diacritics", () => {
    expect(sanitizeLikePattern("café naïve")).toBe("café naïve");
  });
});
