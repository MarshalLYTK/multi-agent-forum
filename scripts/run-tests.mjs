import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const testsRoot = resolve(import.meta.dirname, "..", "tests");

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(target)));
    if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(target);
  }
  return files.sort();
}

const files = await collect(testsRoot);
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
