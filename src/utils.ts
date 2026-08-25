import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, normalize, win32 } from "node:path";
import { ForumError } from "./error.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function assertIdentifier(value: string, label = "identifier"): string {
  if (!IDENTIFIER.test(value)) {
    throw new ForumError(
      "AF_INVALID_ID",
      `${label} must match ${IDENTIFIER.source}; received ${JSON.stringify(value)}`,
      2,
    );
  }
  return value;
}

export function makeRecordId(prefix: string): string {
  const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  return `${prefix}_${stamp}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

export function makeForumId(): string {
  return `forum-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSafeSource(value: string, label = "source"): string {
  if (isAbsolute(value) || win32.isAbsolute(value)) {
    throw new ForumError(
      "AF_ABSOLUTE_SOURCE",
      `${label} must be a URL, session ID, or relative path`,
      2,
    );
  }
  const normalized = normalize(value).replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ForumError("AF_SOURCE_ESCAPE", `${label} cannot escape the Forum root`, 2);
  }
  return value;
}

export function parseFutureDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ForumError("AF_INVALID_DATE", `invalid date: ${value}`, 2);
  }
  if (date.getTime() <= Date.now()) {
    throw new ForumError("AF_EXPIRED_DATE", `date must be in the future: ${value}`, 2);
  }
  return date.toISOString();
}

export function encodeEnvelope(value: unknown): string {
  return `AF1_${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

export function decodeEnvelope(code: string): unknown {
  if (!code.startsWith("AF1_")) {
    throw new ForumError("AF_INVITE_PREFIX", "Join Code must start with AF1_", 2);
  }
  try {
    return JSON.parse(Buffer.from(code.slice(4), "base64url").toString("utf8"));
  } catch {
    throw new ForumError("AF_INVITE_FORMAT", "Join Code is not valid base64url JSON", 2);
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ForumError("AF_REQUIRED", `${label} is required`, 2);
  }
  return value.trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
