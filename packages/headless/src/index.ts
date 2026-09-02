/**
 * Public entry point for `@vryzel/file-next-headless`.
 *
 * This package is BEHAVIOR-ONLY: 6 React hooks that drive file
 * operations, with all server-side concerns (auth, S3 calls) injected
 * as callback arguments. Consumers wire their own action creators and
 * the headless layer just orchestrates state transitions and the
 * low-level browser APIs (XHR, fetch, reader, AbortController).
 *
 * Why dependency injection:
 *   - Keeps the headless layer free of `import "server-only"` so it
 *     can be used in client components.
 *   - Tests can supply plain async functions as the action callbacks
 *     (no real server, no RSC boundary).
 *   - Consumers can compose their own auth / middleware at the
 *     action-callback layer.
 *
 * Hooks:
 *   - `useFileBrowser`     — list with loading/empty/error states
 *   - `useFileExplorer`    — view mode, selection, and drag state on top of the list
 *   - `useUploader`        — XHR-based upload with progress + cancel
 *   - `useFileActions`     — optimistic delete/move/copy/rename with rollback
 *   - `useFileUrl`         — resolve a presigned URL for a key
 *   - `useDownloadProgress`— fetch + reader download with progress + cancel
 */
export { useFileBrowser } from "./use-file-browser";
export type {
  UseFileBrowserOptions,
  UseFileBrowserReturn,
  UseFileBrowserState,
  UseFileBrowserStatus,
  ListFilesFn,
  ListFilesInput,
  ListFilesOutput,
} from "./use-file-browser";

export { useUploader } from "./use-uploader";
export type {
  UploaderFile,
  ConfirmUploadFn,
  RequestUploadResult,
  UseUploaderOptions,
  UseUploaderReturn,
  UseUploaderState,
  UseUploaderStatus,
} from "./use-uploader";

export { useFileActions } from "./use-file-actions";
export type {
  DeleteFileInput,
  DeleteFileOutput,
  DeleteFileFn,
  MoveFileInput,
  MoveFileOutput,
  MoveFileFn,
  CopyFileInput,
  CopyFileOutput,
  CopyFileFn,
  UseFileActionsOptions,
  UseFileActionsReturn,
  UseFileActionsState,
  UseFileActionsStatus,
} from "./use-file-actions";

export { useFileUrl } from "./use-file-url";
export type {
  GetDownloadUrlInput,
  GetDownloadUrlOutput,
  GetDownloadUrlFn,
  UseFileUrlOptions,
  UseFileUrlReturn,
  UseFileUrlStatus,
} from "./use-file-url";

export { useDownloadProgress } from "./use-download-progress";
export type {
  UseDownloadProgressOptions,
  UseDownloadProgressReturn,
  UseDownloadProgressState,
  UseDownloadProgressStatus,
} from "./use-download-progress";

export { useFileExplorer } from "./use-file-explorer";
export type {
  UseFileExplorerOptions,
  UseFileExplorerReturn,
  ViewMode,
} from "./use-file-explorer";
