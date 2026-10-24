import { DEMO_QUOTA_BYTES } from "../../lib/constants";
import { DEMO_TENANT, DEMO_USER, getWriteThrough } from "../../lib/file-next-store";

const readLimited = async (req: Request, max: number): Promise<Uint8Array | null> => {
  const declared = req.headers.get("content-length");
  if (declared != null && Number(declared) > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

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
  const body = await readLimited(req, DEMO_QUOTA_BYTES);
  if (!body) {
    return Response.json(
      { ok: false, error: { code: "PayloadTooLarge", message: "Upload exceeds the demo quota" } },
      { status: 413 },
    );
  }
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
      { ok: false, error: { code: result.error.code, message: "Upload failed" } },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, value: { id: result.value.id } });
}
