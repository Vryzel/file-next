import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@/metadata/memory-store";
import { asTenantId, asUserId, asS3Key } from "@/types/branded";

const tenant = asTenantId("acme");
const user = asUserId("u1");

describe("MetadataStore extras", () => {
  it("restore, trash, share, quota helpers", async () => {
    const store = createMemoryStore();
    const created = await store.createNode({
      tenantId: tenant,
      parentId: null,
      name: "a.txt",
      kind: "file",
      size: 4,
      mimeType: "text/plain",
      s3Key: asS3Key("id-1"),
      ownerId: user,
      id: "id-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const sum = await store.sumSize({ tenantId: tenant });
    expect(sum.ok && sum.value).toBe(4);

    await store.deleteNode({ tenantId: tenant, id: "id-1" });
    const trash = await store.listTrash({ tenantId: tenant });
    expect(trash.ok && trash.value.items).toHaveLength(1);

    const restored = await store.restoreNode({ tenantId: tenant, id: "id-1" });
    expect(restored.ok && restored.value.deletedAt).toBeNull();

    const share = await store.createShare({ tenantId: tenant, nodeId: "id-1" });
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    const resolved = await store.resolveShare({ token: share.value.token });
    expect(resolved.ok && resolved.value?.id).toBe("id-1");
    await store.revokeShare({ tenantId: tenant, token: share.value.token });
    const gone = await store.resolveShare({ token: share.value.token });
    expect(gone.ok && gone.value).toBeNull();

    await store.deleteNode({ tenantId: tenant, id: "id-1" });
    const purged = await store.purgeNode({ tenantId: tenant, id: "id-1" });
    expect(purged.ok && purged.value.s3Keys).toEqual(["id-1"]);
    const trashAfter = await store.listTrash({ tenantId: tenant });
    expect(trashAfter.ok && trashAfter.value.items).toHaveLength(0);
    const liveGone = await store.purgeNode({ tenantId: tenant, id: "id-1" });
    expect(liveGone.ok).toBe(false);
  });
});
