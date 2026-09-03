/**
 * Server actions — tenant comes from getAuth(), never from the client.
 */
import { z } from "zod";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asS3Key, asTenantId, type TenantId } from "@/types/branded";
import type { AuthContext } from "../auth/with-auth";
import type { MetadataStore, FileNode } from "../metadata/store";
import type { FileSystem } from "../storage/filesystem";
import type { createWriteThrough } from "../sync/write-through";

type CreateWriteThrough = ReturnType<typeof createWriteThrough>;

const NodeIdSchema = z.string().min(1, "id is required");
const PathSchema = z.string().nullable();

export const ListFilesInputSchema = z.object({
  parentId: PathSchema,
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
});

export const DeleteFileInputSchema = z.object({
  id: NodeIdSchema,
  recursive: z.boolean().optional(),
});

export const MoveFileInputSchema = z.object({
  id: NodeIdSchema,
  newParentId: PathSchema,
  newName: z.string().min(1).max(255).optional(),
});

export const CopyFileInputSchema = z.object({
  id: NodeIdSchema,
  newParentId: PathSchema,
  newName: z.string().min(1).max(255).optional(),
});

export const SetMetadataInputSchema = z.object({
  id: NodeIdSchema,
  metadata: z.record(z.string()),
  replace: z.boolean().optional(),
});

export const CreateFolderInputSchema = z.object({
  parentId: PathSchema,
  name: z.string().min(1).max(255),
});

export const PrepareUploadInputSchema = z.object({
  parentId: PathSchema,
  name: z.string().min(1).max(255),
  contentType: z.string().min(1),
  contentLength: z.number().int().nonnegative(),
});

export const ConfirmUploadInputSchema = z.object({
  id: NodeIdSchema,
  parentId: PathSchema,
  name: z.string().min(1).max(255),
  contentType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
});

export const SearchFilesInputSchema = z.object({
  query: z.string(),
  parentId: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export const RestoreNodeInputSchema = z.object({
  id: NodeIdSchema,
});

export const CreateShareInputSchema = z.object({
  id: NodeIdSchema,
});

export const ResolveShareInputSchema = z.object({
  token: z.string().min(1),
});

export const RevokeShareInputSchema = z.object({
  token: z.string().min(1),
});

const zodErr = (message: string, parsed: z.SafeParseError<unknown>) =>
  err(
    new FileSystemError({
      code: "InternalError",
      message,
      retryable: false,
      cause: { code: "ZodError", message: parsed.error.message, issues: parsed.error.issues },
    }),
  );

export interface ServerActionsDeps {
  readonly store: MetadataStore;
  readonly writeThrough: CreateWriteThrough;
  readonly fs: FileSystem;
  readonly getAuth: () => AuthContext | Promise<AuthContext>;
}

export const createServerActions = (deps: ServerActionsDeps) => {
  const { store, writeThrough, fs, getAuth } = deps;

  const wrap = (e: unknown, code: FileSystemError["code"], message: string): FileSystemError => {
    if (e instanceof FileSystemError) return e;
    return new FileSystemError({
      code,
      message: `${message}: ${e instanceof Error ? e.message : String(e)}`,
      retryable: true,
    });
  };

  const authTenant = async (): Promise<AuthContext> => getAuth();

  const listFiles = async (
    input: z.infer<typeof ListFilesInputSchema>,
  ): Promise<Result<ListFilesOutput, FileSystemError>> => {
    const parsed = ListFilesInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid listFiles input", parsed);
    try {
      const auth = await authTenant();
      return store.listChildren({
        tenantId: asTenantId(auth.tenantId),
        parentId: parsed.data.parentId,
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "listFiles failed"));
    }
  };

  const deleteFile = async (
    input: z.infer<typeof DeleteFileInputSchema>,
  ): Promise<Result<void, FileSystemError>> => {
    const parsed = DeleteFileInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid deleteFile input", parsed);
    try {
      const auth = await authTenant();
      return writeThrough.deleteThroughFile({
        tenantId: auth.tenantId,
        id: parsed.data.id,
        recursive: parsed.data.recursive,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "deleteFile failed"));
    }
  };

  const moveFile = async (
    input: z.infer<typeof MoveFileInputSchema>,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = MoveFileInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid moveFile input", parsed);
    try {
      const auth = await authTenant();
      return store.moveNode({
        tenantId: asTenantId(auth.tenantId),
        id: parsed.data.id,
        newParentId: parsed.data.newParentId,
        newName: parsed.data.newName,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "moveFile failed"));
    }
  };

  const copyFile = async (
    input: z.infer<typeof CopyFileInputSchema>,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = CopyFileInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid copyFile input", parsed);
    try {
      const auth = await authTenant();
      return writeThrough.copyThroughFile({
        tenantId: auth.tenantId,
        id: parsed.data.id,
        newParentId: parsed.data.newParentId,
        newName: parsed.data.newName,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "copyFile failed"));
    }
  };

  const setMetadata = async (
    input: z.infer<typeof SetMetadataInputSchema>,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = SetMetadataInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid setMetadata input", parsed);
    try {
      const auth = await authTenant();
      return store.updateMetadata({
        tenantId: asTenantId(auth.tenantId),
        id: parsed.data.id,
        metadata: parsed.data.metadata,
        replace: parsed.data.replace,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "setMetadata failed"));
    }
  };

  const createFolder = async (
    input: z.infer<typeof CreateFolderInputSchema>,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = CreateFolderInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid createFolder input", parsed);
    try {
      const auth = await authTenant();
      return store.createNode({
        tenantId: asTenantId(auth.tenantId),
        parentId: parsed.data.parentId,
        name: parsed.data.name,
        kind: "folder",
        size: 0,
        mimeType: "",
        s3Key: "",
        ownerId: auth.userId,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "createFolder failed"));
    }
  };

  const prepareUpload = async (
    input: z.infer<typeof PrepareUploadInputSchema>,
  ): Promise<Result<PrepareUploadOutput, FileSystemError>> => {
    const parsed = PrepareUploadInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid prepareUpload input", parsed);
    try {
      const auth = await authTenant();
      const id =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `upl-${Date.now()}`;
      const signed = await fs.forTenant(auth.tenantId).adapter.createPresignedUploadUrl({
        key: asS3Key(id),
        contentType: parsed.data.contentType,
        expiresIn: 900,
      });
      if (!signed.ok) return signed;
      return ok({
        id,
        key: id,
        url: signed.value.url,
        method: signed.value.method,
        headers: signed.value.requiredHeaders ?? {},
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "prepareUpload failed"));
    }
  };

  const confirmUpload = async (
    input: z.infer<typeof ConfirmUploadInputSchema>,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = ConfirmUploadInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid confirmUpload input", parsed);
    try {
      const auth = await authTenant();
      return writeThrough.confirmUpload({
        tenantId: auth.tenantId,
        id: parsed.data.id,
        parentId: parsed.data.parentId,
        name: parsed.data.name,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
        ownerId: auth.userId,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "confirmUpload failed"));
    }
  };

  const searchFiles = async (
    input: z.infer<typeof SearchFilesInputSchema>,
  ): Promise<Result<ListFilesOutput, FileSystemError>> => {
    const parsed = SearchFilesInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid searchFiles input", parsed);
    try {
      const auth = await authTenant();
      return store.search({
        tenantId: asTenantId(auth.tenantId),
        query: parsed.data.query,
        parentId: parsed.data.parentId,
        limit: parsed.data.limit,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "searchFiles failed"));
    }
  };

  const listTrash = async (
    input: { limit?: number; cursor?: string } = {},
  ): Promise<Result<ListFilesOutput, FileSystemError>> => {
    try {
      const auth = await authTenant();
      return store.listTrash({
        tenantId: asTenantId(auth.tenantId),
        limit: input.limit,
        cursor: input.cursor,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "listTrash failed"));
    }
  };

  const restoreNode = async (
    input: z.infer<typeof RestoreNodeInputSchema>,
  ): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = RestoreNodeInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid restoreNode input", parsed);
    try {
      const auth = await authTenant();
      return store.restoreNode({
        tenantId: asTenantId(auth.tenantId),
        id: parsed.data.id,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "restoreNode failed"));
    }
  };

  const purgeNode = async (
    input: z.infer<typeof RestoreNodeInputSchema>,
  ): Promise<Result<void, FileSystemError>> => {
    const parsed = RestoreNodeInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid purgeNode input", parsed);
    try {
      const auth = await authTenant();
      return writeThrough.purgeThroughFile({
        tenantId: auth.tenantId,
        id: parsed.data.id,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "purgeNode failed"));
    }
  };

  const createShare = async (
    input: z.infer<typeof CreateShareInputSchema>,
  ): Promise<Result<{ token: string }, FileSystemError>> => {
    const parsed = CreateShareInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid createShare input", parsed);
    try {
      const auth = await authTenant();
      return store.createShare({
        tenantId: asTenantId(auth.tenantId),
        nodeId: parsed.data.id,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "createShare failed"));
    }
  };

  const resolveShare = async (
    input: z.infer<typeof ResolveShareInputSchema>,
  ): Promise<Result<FileNode | null, FileSystemError>> => {
    const parsed = ResolveShareInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid resolveShare input", parsed);
    try {
      return store.resolveShare({ token: parsed.data.token });
    } catch (e) {
      return err(wrap(e, "InternalError", "resolveShare failed"));
    }
  };

  const revokeShare = async (
    input: z.infer<typeof RevokeShareInputSchema>,
  ): Promise<Result<void, FileSystemError>> => {
    const parsed = RevokeShareInputSchema.safeParse(input);
    if (!parsed.success) return zodErr("Invalid revokeShare input", parsed);
    try {
      const auth = await authTenant();
      return store.revokeShare({
        tenantId: asTenantId(auth.tenantId),
        token: parsed.data.token,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "revokeShare failed"));
    }
  };

  return {
    listFiles,
    deleteFile,
    moveFile,
    copyFile,
    setMetadata,
    createFolder,
    prepareUpload,
    confirmUpload,
    searchFiles,
    listTrash,
    restoreNode,
    purgeNode,
    createShare,
    resolveShare,
    revokeShare,
  };
};

export interface ListFilesOutput {
  readonly items: ReadonlyArray<FileNode>;
  readonly nextCursor?: string;
}

export interface PrepareUploadOutput {
  readonly id: string;
  readonly key: string;
  readonly url: string;
  readonly method: "PUT" | "POST";
  readonly headers: Record<string, string>;
  readonly expiresAt: string;
}

export type { TenantId };
