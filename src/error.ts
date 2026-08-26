export class ForumError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode = 1, details?: unknown) {
    super(message);
    this.name = "ForumError";
    this.code = code;
    this.exitCode = exitCode;
    if (details !== undefined) this.details = details;
  }
}

export function asForumError(error: unknown): ForumError {
  if (error instanceof ForumError) return error;
  if (error instanceof Error) return new ForumError("MAF_UNEXPECTED", error.message, 1);
  return new ForumError("MAF_UNEXPECTED", String(error), 1);
}
