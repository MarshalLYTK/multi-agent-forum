import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";
import { removeTemporaryDirectory, temporaryDirectory } from "./helpers.mjs";

const cli = resolve(import.meta.dirname, "..", "dist", "cli.js");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeTemporaryDirectory));
});

function run(cwd, ...args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("CLI quickstart emits JSON and validates a Forum", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const initialized = JSON.parse(
    run(parent, "init", "demo", "--owner", "owner", "--name", "Demo", "--json"),
  );
  assert.equal(initialized.owner, "owner");
  run(parent, "agent", "add", "codex", "--name", "Codex", "--root", "demo", "--json");
  run(
    parent,
    "topic",
    "create",
    "example",
    "--title",
    "Example",
    "--owner",
    "owner",
    "--resolution-owner",
    "owner",
    "--root",
    "demo",
    "--json",
  );
  run(
    parent,
    "response",
    "create",
    "--topic",
    "example",
    "--agent",
    "codex",
    "--kind",
    "analysis",
    "--summary",
    "Summary",
    "--evidence",
    "Evidence",
    "--outcome",
    "Outcome",
    "--next",
    "Owner reviews",
    "--root",
    "demo",
    "--json",
  );
  const validation = JSON.parse(run(parent, "validate", "--root", "demo", "--json"));
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(validation.counts.responses, 1);

  const dryRun = JSON.parse(
    run(
      parent,
      "agent",
      "add",
      "unused",
      "--name",
      "Unused",
      "--root",
      "demo",
      "--dry-run",
      "--json",
    ),
  );
  assert.equal(dryRun.dry_run, true);
  const agents = JSON.parse(run(parent, "agent", "list", "--root", "demo", "--json"));
  assert.equal(
    agents.some((agent) => agent.agent_id === "unused"),
    false,
  );
});

test("CLI returns a stable machine-readable error", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const result = spawnSync(process.execPath, [cli, "unknown", "--json"], {
    cwd: parent,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  const error = JSON.parse(result.stderr);
  assert.equal(error.error.code, "AF_COMMAND");
});
