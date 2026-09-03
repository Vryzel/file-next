import { describe, it, expect } from "vitest";
import { createShareRouteHandler } from "@/server/route-handlers/share";
import { createMemoryStore } from "@/metadata/memory-store";
import { createMemoryFileSystem } from "@/storage/factory";
import { asTenantId, asUserId, asS3Key } from "@/types/branded";

const TENANT = asTenantId("demo");
const USER = asUserId("user-1");

describe("createShareRouteHandler", () => {
  it("streams the file for a valid token without exposing the bucket", async () => {
    const store = createMemoryStore();
    const fs = createMemoryFileSystem({ store });
    const created = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "secret.txt",
      kind: "file",
      size: 5,
      mimeType: "text/plain",
      s3Key: "secret.txt",
      ownerId: USER,
    });
    if (!created.ok) throw new Error("setup");
    await fs.forTenant(TENANT).adapter.write({
      key: asS3Key("secret.txt"),
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
    });
    const share = await store.createShare({ tenantId: TENANT, nodeId: created.value.id });
    if (!share.ok) throw new Error("share");

    const handler = createShareRouteHandler({ store, fs });
    const res = await handler(
      new Request(`https://app.example/api/share/${share.value.token}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("content-disposition") ?? "").toContain("secret.txt");
  });

  it("returns 404 for an unknown token", async () => {
    const store = createMemoryStore();
    const fs = createMemoryFileSystem({ store });
    const handler = createShareRouteHandler({ store, fs });
    const res = await handler(new Request("https://app.example/api/share/nope"));
    expect(res.status).toBe(404);
  });
});
