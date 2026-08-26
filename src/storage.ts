import { constants } from "node:fs";
import {
  access,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import YAML from "yaml";
import { ForumError } from "./error.js";

export const RECORD_SIZE_LIMIT = 1024 * 1024;

export function safePath(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments);
  const rel = relative(resolve(root), target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return target;
  throw new ForumError("MAF_PATH_ESCAPE", `path escapes Forum root: ${target}`, 2);
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverForumRoot(start = process.cwd()): Promise<string> {
  let current = resolve(start);
  try {
    if ((await stat(current)).isFile()) current = dirname(current);
  } catch {
    throw new ForumError("MAF_PATH_MISSING", `path does not exist: ${current}`, 2);
  }
  while (true) {
    if (await pathExists(resolve(current, "forum.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new ForumError("MAF_NOT_A_FORUM", `forum.yaml not found from ${start}`, 2);
}

export async function readTextLimited(target: string, limit = RECORD_SIZE_LIMIT): Promise<string> {
  const info = await stat(target);
  if (info.size > limit) {
    throw new ForumError("MAF_FILE_TOO_LARGE", `${target} exceeds ${limit} bytes`, 2);
  }
  return readFile(target, "utf8");
}

export async function readYaml<T>(target: string): Promise<T> {
  const text = await readTextLimited(target);
  try {
    return YAML.parse(text) as T;
  } catch (error) {
    throw new ForumError("MAF_INVALID_YAML", `${target}: ${String(error)}`, 2);
  }
}

export async function writeNew(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  let handle: FileHandle | undefined;
  try {
    handle = await open(target, "wx", 0o644);
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ForumError("MAF_IMMUTABLE_EXISTS", `refusing to overwrite ${target}`, 2);
    }
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
  if (!handle) throw new ForumError("MAF_WRITE_FAILED", `could not open ${target}`, 1);
  await handle.close();
}

export async function replaceAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o644, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeYamlNew(target: string, value: unknown): Promise<void> {
  await writeNew(target, YAML.stringify(value, { lineWidth: 0 }));
}

export async function replaceYaml(target: string, value: unknown): Promise<void> {
  await replaceAtomic(target, YAML.stringify(value, { lineWidth: 0 }));
}

export function formatMarkdown(metadata: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(metadata, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

export function parseMarkdown(
  text: string,
  target = "record",
): {
  metadata: Record<string, unknown>;
  body: string;
} {
  if (!text.startsWith("---\n")) {
    throw new ForumError("MAF_FRONTMATTER", `${target}: missing YAML frontmatter`, 2);
  }
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new ForumError("MAF_FRONTMATTER", `${target}: unterminated frontmatter`, 2);
  const parsed = YAML.parse(text.slice(4, end));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ForumError("MAF_FRONTMATTER", `${target}: frontmatter must be an object`, 2);
  }
  return { metadata: parsed as Record<string, unknown>, body: text.slice(end + 5).trim() };
}

export async function listFiles(directory: string, extension?: string): Promise<string[]> {
  if (!(await pathExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && (!extension || entry.name.endsWith(extension)))
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

export async function listDirectories(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

export async function assertNoSymlinks(root: string): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const target = safePath(root, relative(root, directory), entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) {
        throw new ForumError("MAF_SYMLINK", `symlink is not allowed: ${relative(root, target)}`, 2);
      }
      if (info.isDirectory()) await walk(target);
    }
  };
  await walk(root);
}
