import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  addAgent,
  createAction,
  createResponse,
  createTopic,
  importReceipt,
  initForum,
  resolveTopic,
  updateAction,
  validateForum,
} from "../dist/index.js";
import { removeTemporaryDirectory, temporaryDirectory } from "./helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeTemporaryDirectory));
});

test("runs the evidence-to-decision flow without promoting a response", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({
    directory: root,
    owner: "owner",
    ownerName: "Forum Owner",
    name: "Example Forum",
    repository: "https://github.com/example/forum.git",
    git: false,
  });
  await addAgent(root, { id: "codex", name: "Codex", type: "ai", runtime: "codex" });
  await addAgent(root, { id: "web-agent", name: "Web Agent", type: "ai", runtime: "web" });
  await createTopic(root, {
    id: "launch",
    title: "Choose a launch path",
    owner: "owner",
    resolutionOwner: "owner",
  });

  const response = await createResponse(root, {
    topicId: "launch",
    agent: "codex",
    kind: "analysis",
    summary: "Compared two launch paths",
    evidence: "Both paths were tested in isolated fixtures.",
    outcome: "Path A has fewer moving parts.",
    next: "The owner reviews the evidence.",
  });
  assert.match(response.response_id, /^response_/);

  const receiptPath = join(parent, "receipt.json");
  await writeFile(
    receiptPath,
    JSON.stringify({
      agent: "web-agent",
      summary: "Reviewed the public documentation",
      evidence: "The quickstart contains all required commands.",
      outcome: "No missing step was found.",
      work_status: "completed",
      next_owner: "human",
      next_step: "The owner decides whether to adopt the result.",
      confidence: "high",
      source_session_id: "session-example-001",
    }),
  );
  const receipt = await importReceipt(root, {
    topicId: "launch",
    input: receiptPath,
    submittedBy: "owner",
  });
  assert.equal(receipt.metadata.capture_mode, "imported");
  assert.equal(receipt.metadata.agent, "web-agent");
  assert.equal(receipt.metadata.submitted_by, "owner");

  const firstAction = await createAction(root, {
    topicId: "launch",
    title: "Review both pieces of evidence",
    owner: "owner",
    createdBy: "owner",
  });
  await updateAction(root, {
    topicId: "launch",
    actionId: firstAction.action_id,
    status: "ready",
    note: "Evidence is ready for review.",
  });

  const resolution = await resolveTopic(root, {
    topicId: "launch",
    owner: "owner",
    summary: "Adopt path A",
    decision: "Use path A for the first release.",
  });
  await createAction(root, {
    topicId: "launch",
    title: "Execute the adopted launch path",
    owner: "owner",
    createdBy: "owner",
    sourceResolution: resolution.resolution_id,
  });

  await assert.rejects(
    () =>
      createResponse(root, {
        topicId: "launch",
        agent: "codex",
        kind: "analysis",
        summary: "Late response",
        evidence: "Too late",
        outcome: "None",
        next: "None",
      }),
    (error) => error.code === "AF_TOPIC_CLOSED",
  );

  const validation = await validateForum(root);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.deepEqual(validation.counts, {
    agents: 3,
    topics: 1,
    responses: 2,
    receipts: 1,
    resolutions: 1,
    actions: 2,
    invitations: 0,
    joinRequests: 0,
  });
});

test("only the declared resolution owner can resolve a topic", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({ directory: root, owner: "owner", git: false });
  await addAgent(root, { id: "reviewer", name: "Reviewer", type: "human" });
  await createTopic(root, {
    id: "decision",
    title: "Decision",
    owner: "owner",
    resolutionOwner: "owner",
  });
  await assert.rejects(
    () =>
      resolveTopic(root, {
        topicId: "decision",
        owner: "reviewer",
        summary: "Unauthorized",
        decision: "This must not be adopted.",
      }),
    (error) => error.code === "AF_RESOLUTION_OWNER",
  );
});
