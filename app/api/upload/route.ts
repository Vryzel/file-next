import { DEMO_TENANT, DEMO_USER, getWriteThrough } from "../../lib/file-next-store";

export async function PUT(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) {
    return Response.json(
      { ok: false, error: { code: "InternalError", message: "Missing name" } },
      { status: 400 },
    );
  }
  const parentId = url.searchParams.get("parentId");
  const body = new Uint8Array(await req.arrayBuffer());
  const result = await getWriteThrough().writeThroughFile({
    tenantId: DEMO_TENANT,
    parentId: parentId && parentId.length > 0 ? parentId : null,
    name,
    body,
    contentType: req.headers.get("content-type") ?? "application/octet-stream",
    ownerId: DEMO_USER,
  });
  if (!result.ok) {
    return Response.json(
      { ok: false, error: { code: result.error.code, message: result.error.message } },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, value: { id: result.value.id } });
}
