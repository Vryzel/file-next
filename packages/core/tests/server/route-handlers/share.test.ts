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
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("content-disposition") ?? "").toContain("secret.txt");
  });

  it("redirects instead of buffering when the object exceeds maxBytes", async () => {
    const store = createMemoryStore();
    const fs = createMemoryFileSystem({ store });
    const created = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "big.bin",
      kind: "file",
      size: 5,
      mimeType: "application/octet-stream",
      s3Key: "big.bin",
      ownerId: USER,
    });
    if (!created.ok) throw new Error("setup");
    await fs.forTenant(TENANT).adapter.write({
      key: asS3Key("big.bin"),
      body: new TextEncoder().encode("hello"),
      contentType: "application/octet-stream",
    });
    const share = await store.createShare({ tenantId: TENANT, nodeId: created.value.id });
    if (!share.ok) throw new Error("share");

    const handler = createShareRouteHandler({ store, fs, maxBytes: 1 });
    const res = await handler(
      new Request(`https://app.example/api/share/${share.value.token}`),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("in-memory://");
    expect(await res.text()).toBe("");
  });

  it("passes Range through to the adapter read", async () => {
    const store = createMemoryStore();
    const created = await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "note.txt",
      kind: "file",
      size: 5,
      mimeType: "text/plain",
      s3Key: "note",
      ownerId: USER,
    });
    if (!created.ok) throw new Error("setup");
    const share = await store.createShare({ tenantId: TENANT, nodeId: created.value.id });
    if (!share.ok) throw new Error("share");
    const body = new Uint8Array([104, 101, 108, 108, 111]);
    let seenRange: string | undefined;
    const fs = {
      forTenant: () => ({
        adapter: {
          stat: async () => ({
            ok: true as const,
            value: { size: 5, contentType: "text/plain", key: asS3Key("note") },
          }),
          read: async (input: { range?: string }) => {
            seenRange = input.range;
            return {
              ok: true as const,
              value: { body: input.range ? body.subarray(0, 1) : body, contentType: "text/plain" },
            };
          },
          createPresignedDownloadUrl: async () => ({
            ok: true as const,
            value: { url: "https://signed.example/obj" },
          }),
        },
      }),
    };
    const res = await createShareRouteHandler({ store, fs: fs as never })(
      new Request(`https://app.example/api/share/${share.value.token}`, {
        headers: { range: "bytes=0-0" },
      }),
    );
    expect(res.status).toBe(200);
    expect(seenRange).toBe("bytes=0-0");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body.subarray(0, 1));
  });

  it("returns 404 for an unknown token", async () => {
    const store = createMemoryStore();
    const fs = createMemoryFileSystem({ store });
    const handler = createShareRouteHandler({ store, fs });
    const res = await handler(new Request("https://app.example/api/share/nope"));
    expect(res.status).toBe(404);
  });
});
