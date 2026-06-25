/**
 * Local FileSystemError — see the rationale in use-uploader.ts.
 * Kept in a separate file so both hooks can share it without
 * one importing the other.
 */

export type FileSystemErrorCode =
  | "NetworkError"
  | "InternalError"
  | "NotFound"
  | "Conflict"
  | "Unauthorized"
  | "Forbidden"
  | (string & {}); // allow arbitrary codes from the server

export class FileSystemError extends Error {
  readonly code: FileSystemErrorCode;
  readonly retryable: boolean;
  constructor(input: {
    readonly code: FileSystemErrorCode;
    readonly retryable: boolean;
    readonly message: string;
    readonly cause?: unknown;
  }) {
    super(input.message);
    this.name = "FileSystemError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}
