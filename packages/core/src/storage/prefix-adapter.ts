/**
 * Tenant prefix wrapper — rewrites every key/prefix so one bucket
 * can hold many tenants without the rest of the library knowing.
 *
 * Metadata stores the tenant-relative key (usually the node UUID).
 * The wrapper prepends `t/{tenantId}/` on the way in and strips it
 * on the way out.
 */
import { ok, type Result } from "@/types/result";
import type { FileSystemError } from "@/errors";
import { asS3Key, asPrefix, type S3Key, type Prefix } from "@/types/branded";
import type { S3CompatibleAdapter } from "./adapter";

export const tenantPrefix = (tenantId: string): string => `t/${tenantId}/`;

export const prefixAdapter = (
  adapter: S3CompatibleAdapter,
  prefix: string,
): S3CompatibleAdapter => {
  const strip = (key: string): string =>
    key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const pk = (key: string): S3Key => asS3Key(`${prefix}${strip(key)}`);
  const pp = (p?: Prefix): Prefix => asPrefix(`${prefix}${p ?? ""}`);

  return {
    list: async (input) => {
      const r = await adapter.list({ ...input, prefix: pp(input.prefix) });
      if (!r.ok) return r;
      return ok({
        ...r.value,
        items: r.value.items.map((item) => ({
          ...item,
          key: asS3Key(strip(item.key)),
        })),
        prefixes: r.value.prefixes.map((p) => asPrefix(strip(p))),
      });
    },
    read: (input) => adapter.read({ ...input, key: pk(input.key) }),
    write: (input) => adapter.write({ ...input, key: pk(input.key) }),
    delete: (input) => adapter.delete({ ...input, key: pk(input.key) }),
    move: (input) =>
      adapter.move({
        sourceKey: pk(input.sourceKey),
        destinationKey: pk(input.destinationKey),
      }),
    copy: (input) =>
      adapter.copy({
        sourceKey: pk(input.sourceKey),
        destinationKey: pk(input.destinationKey),
      }),
    stat: async (input) => {
      const r = await adapter.stat({ key: pk(input.key) });
      if (!r.ok) return r;
      return ok({ ...r.value, key: asS3Key(strip(r.value.key)) });
    },
    exists: (input) => adapter.exists({ key: pk(input.key) }),
    getMetadata: (input) => adapter.getMetadata({ key: pk(input.key) }),
    setMetadata: (input) =>
      adapter.setMetadata({ ...input, key: pk(input.key) }),
    createPresignedUploadUrl: (input) =>
      adapter.createPresignedUploadUrl({ ...input, key: pk(input.key) }),
    createPresignedDownloadUrl: (input) =>
      adapter.createPresignedDownloadUrl({ ...input, key: pk(input.key) }),
    getPublicUrl: (input) => adapter.getPublicUrl({ key: pk(input.key) }),
    createMultipartUpload: async (input) => {
      const r = await adapter.createMultipartUpload({
        ...input,
        key: pk(input.key),
      });
      if (!r.ok) return r;
      return ok({ ...r.value, key: asS3Key(strip(r.value.key)) });
    },
    uploadPart: (input) =>
      adapter.uploadPart({ ...input, key: pk(input.key) }),
    completeMultipartUpload: (input) =>
      adapter.completeMultipartUpload({ ...input, key: pk(input.key) }),
    abortMultipartUpload: (input) =>
      adapter.abortMultipartUpload({ ...input, key: pk(input.key) }),
  };
};

export type { Result, FileSystemError };
