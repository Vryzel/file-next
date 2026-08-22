import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@/storage/factory";
import { createMemoryStore } from "@/metadata/memory-store";
import { asS3Key } from "@/types/branded";

describe("createMemoryFileSystem + forTenant", () => {
  it("scopes object keys under t/{tenant}/", async () => {
    const store = createMemoryStore();
    const fs = createMemoryFileSystem({ store });
    const acme = fs.forTenant("acme");
    const key = asS3Key("node-1");
    const wrote = await acme.adapter.write({
      key,
      body: new TextEncoder().encode("hi"),
      contentType: "text/plain",
    });
    expect(wrote.ok).toBe(true);

    const raw = await fs.adapter.exists({ key: asS3Key("t/acme/node-1") });
    expect(raw.ok && raw.value.exists).toBe(true);

    const relative = await acme.adapter.exists({ key });
    expect(relative.ok && relative.value.exists).toBe(true);

    const other = await fs.forTenant("other").adapter.exists({ key });
    expect(other.ok && other.value.exists).toBe(false);
  });

  it("wires the metadata store onto FileSystem", () => {
    const store = createMemoryStore();
    const fs = createMemoryFileSystem({ store, quotaBytes: 100 });
    expect(fs.metadata).toBe(store);
    expect(fs.quotaBytes).toBe(100);
  });
});
