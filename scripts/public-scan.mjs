import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const ignoredFiles = new Set(["package-lock.json"]);
const externalDenylist = (process.env.AGENT_FORUM_DENYLIST ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const patterns = [
  ["macOS user path", new RegExp(["/", "Users", "/", "[A-Za-z0-9._-]+", "/"].join(""))],
  ["Linux user path", new RegExp(["/", "home", "/", "[A-Za-z0-9._-]+", "/"].join(""))],
  ["Windows user path", new RegExp("[A-Za-z]:\\\\" + "Users" + "\\\\[^\\\\\\s]+\\\\")],
  ["private key marker", new RegExp(["-----BEGIN ", "[A-Z ]*", "PRIVATE KEY-----"].join(""))],
  [
    "GitHub token",
    new RegExp(
      "\\b(?:" + "gh[pousr]_" + "[A-Za-z0-9]{20,}|" + "github_pat_" + "[A-Za-z0-9_]{20,})\\b",
    ),
  ],
  ["AWS access key", new RegExp("\\b" + "AKIA" + "[0-9A-Z]{16}\\b")],
];

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await collect(target)));
    if (entry.isFile() && !ignoredFiles.has(entry.name) && !entry.name.endsWith(".tgz"))
      result.push(target);
  }
  return result;
}

const findings = [];
for (const path of await collect(root)) {
  const text = await readFile(path, "utf8").catch(() => "");
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${relative(root, path)}: ${label}`);
  }
  for (const value of externalDenylist) {
    if (text.includes(value)) findings.push(`${relative(root, path)}: external denylist match`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("public scan passed\n");
