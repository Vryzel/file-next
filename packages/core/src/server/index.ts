/**
 * Testable server entry point.
 *
 * Re-exports server actions and route-handler factories. Import
 * target for the library's own tests — kept free of `import "server-only"`
 * so vitest can evaluate the module under jsdom without throwing.
 *
 * The CONSUMER-facing server entry is `server/entry.ts` (the
 * `./server` package.json subpath), which has `import "server-only"`
 * at the top. The split lets the test suite import the factories
 * freely while the published bundle refuses to be pulled into a
 * client component.
 *
 * Consumer pattern (in a Next.js app):
 *
 *   // app/api/upload/route.ts
 *   import { createUploadRouteHandler } from "@vryzel/file-next/server";
 *   import { getFileSystem } from "@vryzel/file-next";
 *   export const POST = createUploadRouteHandler({
 *     fs: getFileSystem(),
 *     maxBytes: 25 * 1024 * 1024,
 *     allowedContentTypes: ["image/*"],
 *   });
 *
 *   // app/actions.ts
 *   "use server";
 *   import { listFilesAction } from "@vryzel/file-next/server";
 *   export { listFilesAction };
 */
export { createServerActions } from "./actions";
export type { ServerActionsDeps, ListFilesOutput, PrepareUploadOutput } from "./actions";
export {
  ListFilesInputSchema,
  DeleteFileInputSchema,
  MoveFileInputSchema,
  CopyFileInputSchema,
  SetMetadataInputSchema,
  CreateFolderInputSchema,
  PrepareUploadInputSchema,
  ConfirmUploadInputSchema,
  SearchFilesInputSchema,
  RestoreNodeInputSchema,
  CreateShareInputSchema,
  ResolveShareInputSchema,
  RevokeShareInputSchema,
} from "./actions";
export { withAuth } from "../auth/with-auth";
export type { AuthContext } from "../auth/with-auth";
export {
  createUploadRouteHandler,
  createDownloadRouteHandler,
} from "./route-handlers";
export type {
  CreateUploadRouteHandlerOptions,
  UploadRouteHandlerRequest,
  UploadRouteHandlerResult,
  CreateDownloadRouteHandlerOptions,
  DownloadRouteHandlerResult,
} from "./route-handlers";
// withAuth + RequestContext are re-exported from the main
// "@vryzel/file-next" entry (no need to be in the server-only module).
