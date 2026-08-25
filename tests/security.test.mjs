import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import YAML from "yaml";
import {
  addAgent,
  createInvitation,
  createTopic,
  importReceipt,
  initForum,
  joinForum,
  revokeInvitation,
  validateForum,
} from "../dist/index.js";
import { removeTemporaryDirectory, temporaryDirectory } from "./helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(removeTemporaryDirectory));
});

async function invitationFixture() {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({
    directory: root,
    owner: "owner",
    repository: "https://github.com/example/forum.git",
    git: false,
  });
  const invitation = await createInvitation(root, {
    scope: "responses:create",
    expiresAt: "2099-01-01T00:00:00Z",
    createdBy: "owner",
  });
  return { root, invitation };
}

test("rejects a tampered Join Code and a revoked invitation", async () => {
  const { root, invitation } = await invitationFixture();
  const decoded = JSON.parse(Buffer.from(invitation.code.slice(4), "base64url").toString("utf8"));
  decoded.payload.scope = "resolutions:create";
  const tampered = `AF1_${Buffer.from(JSON.stringify(decoded)).toString("base64url")}`;
  await assert.rejects(
    () =>
      joinForum(root, {
        code: tampered,
        agentId: "researcher",
        name: "Researcher",
        type: "ai",
      }),
    (error) => error.code === "AF_INVITE_TAMPERED",
  );

  await revokeInvitation(root, invitation.invitation_id);
  await assert.rejects(
    () =>
      joinForum(root, {
        code: invitation.code,
        agentId: "researcher",
        name: "Researcher",
        type: "ai",
      }),
    (error) => error.code === "AF_INVITE_REVOKED",
  );
});

test("rejects an expired invitation", async () => {
  const { root, invitation } = await invitationFixture();
  const decoded = JSON.parse(Buffer.from(invitation.code.slice(4), "base64url").toString("utf8"));
  decoded.payload.expires_at = "2000-01-01T00:00:00.000Z";
  decoded.digest = createHash("sha256").update(JSON.stringify(decoded.payload)).digest("hex");
  const invitationPath = join(root, "invitations", `${invitation.invitation_id}.yaml`);
  await writeFile(
    invitationPath,
    YAML.stringify({ ...decoded.payload, status: "active", digest: decoded.digest }),
  );
  const expired = `AF1_${Buffer.from(JSON.stringify(decoded)).toString("base64url")}`;
  await assert.rejects(
    () =>
      joinForum(root, {
        code: expired,
        agentId: "researcher",
        name: "Researcher",
        type: "ai",
      }),
    (error) => error.code === "AF_INVITE_EXPIRED",
  );
});

test("detects secret-shaped content without storing a real secret", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({ directory: root, owner: "owner", git: false });
  await createTopic(root, {
    id: "security",
    title: "Security review",
    owner: "owner",
    resolutionOwner: "owner",
  });
  const synthetic = `${"gh"}p_${"A".repeat(24)}`;
  await writeFile(join(root, "topics", "security", "context.md"), `# Context\n\n${synthetic}\n`);
  const validation = await validateForum(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes("possible GitHub token")));
});

test("rejects absolute source paths in imported receipts", async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({ directory: root, owner: "owner", git: false });
  await addAgent(root, { id: "web-agent", name: "Web Agent", type: "ai" });
  await createTopic(root, {
    id: "import",
    title: "Import receipt",
    owner: "owner",
    resolutionOwner: "owner",
  });
  const receiptPath = join(parent, "receipt.json");
  await writeFile(
    receiptPath,
    JSON.stringify({
      agent: "web-agent",
      summary: "Summary",
      evidence: "Evidence",
      outcome: "Outcome",
      work_status: "completed",
      next_owner: "human",
      next_step: "Review",
      confidence: "high",
      source_artifact: ["", "Users", "example", "private.md"].join("/"),
    }),
  );
  await assert.rejects(
    () => importReceipt(root, { topicId: "import", input: receiptPath, submittedBy: "owner" }),
    (error) => error.code === "AF_ABSOLUTE_SOURCE",
  );
});

test("rejects symlinks inside a Forum", { skip: process.platform === "win32" }, async () => {
  const parent = await temporaryDirectory();
  temporaryDirectories.push(parent);
  const root = join(parent, "forum");
  await initForum({ directory: root, owner: "owner", git: false });
  const outside = join(parent, "outside.txt");
  await writeFile(outside, "outside");
  await symlink(outside, join(root, "linked.txt"));
  const validation = await validateForum(root);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes("symlink is not allowed")));
});
