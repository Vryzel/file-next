/**
 * `setMetadata` — replace or merge user-defined metadata.
 *
 * Merge reads current metadata, unions in JS, then REPLACE.
 * COPY would ignore the new map.
 */
import { CopyObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { fromAws, type FileSystemError } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { SetMetadataInput, SetMetadataOutput } from "../adapter";
import { getMetadata } from "./get-metadata";

export const setMetadata = async (
  client: S3Client,
  config: FileSystemConfig,
  input: SetMetadataInput,
): Promise<Result<SetMetadataOutput, FileSystemError>> => {
  try {
    let metadata = input.metadata;
    if (input.replace !== true) {
      const current = await getMetadata(client, config, { key: input.key });
      if (!current.ok) return current;
      metadata = { ...(current.value as Record<string, string>), ...input.metadata };
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        CopySource: `${config.bucket}/${input.key}`,
        Metadata: metadata,
        MetadataDirective: "REPLACE",
      }),
    );
    return ok({});
  } catch (e) {
    return err(fromAws(e));
  }
};
