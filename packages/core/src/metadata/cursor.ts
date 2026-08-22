/**
 * Opaque keyset cursor for listChildren / search / trash.
 * Shape: base64url({ n: name, i: id }).
 */
export interface NameCursor {
  readonly n: string;
  readonly i: string;
}

export const encodeCursor = (cursor: NameCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

export const decodeCursor = (raw: string | undefined): NameCursor | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<NameCursor>;
    if (typeof value.n === "string" && typeof value.i === "string") {
      return { n: value.n, i: value.i };
    }
    return null;
  } catch {
    return null;
  }
};

export const pageCursor = <T extends { name: string; id: string }>(
  items: ReadonlyArray<T>,
  limit: number,
): string | undefined => {
  if (items.length < limit || items.length === 0) return undefined;
  const last = items[items.length - 1];
  if (!last) return undefined;
  return encodeCursor({ n: last.name, i: last.id });
};
