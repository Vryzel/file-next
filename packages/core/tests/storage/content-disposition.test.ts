import { describe, expect, it } from "vitest";
import { signedContentDisposition } from "@/storage/content-disposition";

describe("signedContentDisposition", () => {
  it("defaults to attachment", () => {
    expect(signedContentDisposition(undefined, "text/html")).toBe("attachment");
    expect(signedContentDisposition("attachment", "image/png")).toBe("attachment");
  });

  it("allows inline only for non-executing preview types", () => {
    expect(signedContentDisposition("inline", "image/png")).toBe("inline");
    expect(signedContentDisposition("inline", "application/pdf")).toBe("inline");
    expect(signedContentDisposition("inline", "text/plain; charset=utf-8")).toBe("inline");
  });

  it("refuses inline for html and svg", () => {
    expect(signedContentDisposition("inline", "text/html")).toBe("attachment");
    expect(signedContentDisposition("inline", "image/svg+xml")).toBe("attachment");
    expect(signedContentDisposition("inline", "")).toBe("attachment");
  });
});
