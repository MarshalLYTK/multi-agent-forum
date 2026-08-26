import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { addAgent, createResponse, createTopic, guardForum, initForum } from "../dist/index.js";
import { removeTemporaryDirectory, temporaryDirectory } from "./helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeTemporaryDirectory));
});

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

test("guard rejects modification of an existing response", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({ directory: root, owner: "owner", git: true });
  git(root, "config", "user.email", "tests@example.invalid");
  git(root, "config", "user.name", "Multi-Agent Forum Tests");
  await addAgent(root, { id: "codex", name: "Codex", type: "ai" });
  await createTopic(root, {
    id: "guard",
    title: "Guard history",
    owner: "owner",
    resolutionOwner: "owner",
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
  const response = await createResponse(root, {
    topicId: "guard",
    agent: "codex",
    kind: "review",
    summary: "Review",
    evidence: "Evidence",
    outcome: "Outcome",
    next: "Next",
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "add response");
  await appendFile(join(root, response.path), "\nmodified after commit\n");
  await assert.rejects(
    () => guardForum(root),
    (error) => error.code === "MAF_GUARD_REJECTED" && error.details[0].includes("responses"),
  );
});

test("guard allows new immutable records after a baseline commit", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({ directory: root, owner: "owner", git: true });
  git(root, "config", "user.email", "tests@example.invalid");
  git(root, "config", "user.name", "Multi-Agent Forum Tests");
  await addAgent(root, { id: "codex", name: "Codex", type: "ai" });
  await createTopic(root, {
    id: "guard",
    title: "Guard history",
    owner: "owner",
    resolutionOwner: "owner",
  });
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
  await createResponse(root, {
    topicId: "guard",
    agent: "codex",
    kind: "review",
    summary: "Review",
    evidence: "Evidence",
    outcome: "Outcome",
    next: "Next",
  });
  const result = await guardForum(root);
  assert.equal(result.ok, true);
});
