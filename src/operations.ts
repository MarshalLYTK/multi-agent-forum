import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asForumError, ForumError } from "./error.js";
import {
  type ActionStatus,
  type AgentRecord,
  type AgentType,
  type ForumConfig,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  type TopicRecord,
  type TopicStatusRecord,
  type ValidationResult,
} from "./model.js";
import { assertSchema } from "./schema.js";
import {
  assertNoSymlinks,
  discoverForumRoot,
  formatMarkdown,
  listDirectories,
  listFiles,
  parseMarkdown,
  pathExists,
  readTextLimited,
  readYaml,
  replaceAtomic,
  replaceYaml,
  safePath,
  writeNew,
  writeYamlNew,
} from "./storage.js";
import {
  assertIdentifier,
  assertSafeSource,
  decodeEnvelope,
  encodeEnvelope,
  isRecord,
  makeForumId,
  makeRecordId,
  nowIso,
  parseFutureDate,
  requireString,
  sha256,
} from "./utils.js";

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/],
];

const ABSOLUTE_PATH_PATTERNS: Array<[string, RegExp]> = [
  ["macOS absolute user path", /\/Users\/[A-Za-z0-9._-]+\//],
  ["Linux absolute user path", /\/home\/[A-Za-z0-9._-]+\//],
  ["Windows absolute user path", /[A-Za-z]:\\Users\\[^\\\s]+\\/],
];

function defaultPermissions(): ForumConfig["permissions"] {
  return {
    topics: "create",
    responses: "create",
    receipts: "create",
    actions: "propose",
    resolutions: "owner-only",
    structure: "owner-only",
    main_push: "denied",
    credentials: "denied",
  };
}

async function loadForum(start?: string): Promise<{ root: string; forum: ForumConfig }> {
  const root = await discoverForumRoot(start);
  const forum = await readYaml<ForumConfig>(safePath(root, "forum.yaml"));
  assertSchema("forum", forum, "forum.yaml");
  return { root, forum };
}

async function loadAgent(root: string, agentId: string): Promise<AgentRecord> {
  assertIdentifier(agentId, "agent id");
  const path = safePath(root, "agents", `${agentId}.yaml`);
  if (!(await pathExists(path)))
    throw new ForumError("AF_AGENT_MISSING", `agent not found: ${agentId}`, 2);
  const agent = await readYaml<AgentRecord>(path);
  assertSchema("agent", agent, path);
  if (agent.status !== "active") {
    throw new ForumError("AF_AGENT_INACTIVE", `agent is not active: ${agentId}`, 2);
  }
  return agent;
}

function topicDirectory(root: string, topicId: string): string {
  return safePath(root, "topics", assertIdentifier(topicId, "topic id"));
}

async function loadTopic(
  root: string,
  topicId: string,
): Promise<{
  directory: string;
  topic: TopicRecord;
  status: TopicStatusRecord;
}> {
  const directory = topicDirectory(root, topicId);
  if (!(await pathExists(directory)))
    throw new ForumError("AF_TOPIC_MISSING", `topic not found: ${topicId}`, 2);
  const topic = await readYaml<TopicRecord>(safePath(directory, "topic.yaml"));
  const status = await readYaml<TopicStatusRecord>(safePath(directory, "status.yaml"));
  assertSchema("topic", topic, `${topicId}/topic.yaml`);
  assertSchema("status", status, `${topicId}/status.yaml`);
  return { directory, topic, status };
}

function assertTopicWritable(status: TopicStatusRecord, operation: string): void {
  if (status.state === "resolved" || status.state === "archived") {
    throw new ForumError(
      "AF_TOPIC_CLOSED",
      `${operation} is not allowed while topic ${status.topic_id} is ${status.state}`,
      2,
    );
  }
}

export async function initForum(options: {
  directory: string;
  owner: string;
  ownerName?: string;
  name?: string;
  repository?: string;
  git?: boolean;
}): Promise<Record<string, unknown>> {
  const target = resolve(options.directory);
  const owner = assertIdentifier(options.owner, "owner id");
  const existed = await pathExists(target);
  if (existed) {
    const entries = await readdir(target);
    if (entries.some((entry) => entry !== ".git")) {
      throw new ForumError("AF_INIT_NOT_EMPTY", `target directory is not empty: ${target}`, 2);
    }
  } else {
    await mkdir(target, { recursive: true });
  }

  const createdAt = nowIso();
  const forum: ForumConfig = {
    schema_version: SCHEMA_VERSION,
    protocol_version: PROTOCOL_VERSION,
    forum_id: makeForumId(),
    name: options.name?.trim() || basename(target),
    owner,
    created_at: createdAt,
    permissions: defaultPermissions(),
    ...(options.repository ? { repository: options.repository } : {}),
  };
  const ownerRecord: AgentRecord = {
    schema_version: SCHEMA_VERSION,
    agent_id: owner,
    name: options.ownerName?.trim() || owner,
    type: "human",
    status: "active",
    created_at: createdAt,
  };
  assertSchema("forum", forum);
  assertSchema("agent", ownerRecord);

  try {
    for (const directory of ["agents", "topics", "invitations", "join-requests"]) {
      await mkdir(safePath(target, directory), { recursive: true });
    }
    await writeYamlNew(safePath(target, "forum.yaml"), forum);
    await writeYamlNew(safePath(target, "agents", `${owner}.yaml`), ownerRecord);
    await writeNew(safePath(target, ".gitignore"), ".agent-forum-local/\n.DS_Store\n*.log\n");
    const templatePath = fileURLToPath(
      new URL("../templates/default/FORUM_README.md", import.meta.url),
    );
    await writeNew(safePath(target, "README.md"), await readFile(templatePath, "utf8"));
    if (options.git !== false && !(await pathExists(safePath(target, ".git")))) {
      execFileSync("git", ["init", "-b", "main", target], { stdio: "ignore" });
    }
  } catch (error) {
    if (!existed) await rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return { root: target, forum_id: forum.forum_id, owner, protocol_version: PROTOCOL_VERSION };
}

export async function doctorForum(start?: string): Promise<Record<string, unknown>> {
  const { root, forum } = await loadForum(start);
  const validation = await validateForum(root);
  const checks: Array<Record<string, unknown>> = [
    {
      name: "node",
      ok: Number(process.versions.node.split(".")[0]) >= 22,
      value: process.versions.node,
    },
    {
      name: "protocol",
      ok: forum.protocol_version === PROTOCOL_VERSION,
      value: forum.protocol_version,
    },
    { name: "validation", ok: validation.ok, errors: validation.errors.length },
  ];
  try {
    const value = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    checks.push({ name: "git", ok: value === "true", value });
  } catch {
    checks.push({ name: "git", ok: false, value: "not a Git worktree" });
  }
  return { ok: checks.every((check) => check.ok === true), root, forum_id: forum.forum_id, checks };
}

export async function addAgent(
  start: string | undefined,
  options: { id: string; name: string; type: AgentType; runtime?: string },
): Promise<AgentRecord> {
  const { root } = await loadForum(start);
  const id = assertIdentifier(options.id, "agent id");
  const agent: AgentRecord = {
    schema_version: SCHEMA_VERSION,
    agent_id: id,
    name: requireString(options.name, "agent name"),
    type: options.type,
    status: "active",
    created_at: nowIso(),
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };
  assertSchema("agent", agent);
  await writeYamlNew(safePath(root, "agents", `${id}.yaml`), agent);
  return agent;
}

export async function listAgents(start?: string): Promise<AgentRecord[]> {
  const { root } = await loadForum(start);
  const result: AgentRecord[] = [];
  for (const path of await listFiles(safePath(root, "agents"), ".yaml")) {
    const agent = await readYaml<AgentRecord>(path);
    assertSchema("agent", agent, relative(root, path));
    result.push(agent);
  }
  return result;
}

export async function showAgent(start: string | undefined, id: string): Promise<AgentRecord> {
  const { root } = await loadForum(start);
  return loadAgent(root, id);
}

export async function createTopic(
  start: string | undefined,
  options: {
    id: string;
    title: string;
    owner: string;
    resolutionOwner: string;
    prompt?: string;
    context?: string;
  },
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const id = assertIdentifier(options.id, "topic id");
  await loadAgent(root, options.owner);
  await loadAgent(root, options.resolutionOwner);
  const target = topicDirectory(root, id);
  if (await pathExists(target))
    throw new ForumError("AF_TOPIC_EXISTS", `topic already exists: ${id}`, 2);
  const temporary = safePath(root, "topics", `.tmp-${id}-${Date.now()}`);
  const createdAt = nowIso();
  const topic: TopicRecord = {
    schema_version: SCHEMA_VERSION,
    topic_id: id,
    title: requireString(options.title, "topic title"),
    created_at: createdAt,
  };
  const status: TopicStatusRecord = {
    schema_version: SCHEMA_VERSION,
    topic_id: id,
    state: "open",
    owner: options.owner,
    resolution_owner: options.resolutionOwner,
    updated_at: createdAt,
  };
  assertSchema("topic", topic);
  assertSchema("status", status);
  try {
    for (const directory of ["responses", "resolutions", "actions"]) {
      await mkdir(safePath(temporary, directory), { recursive: true });
    }
    await writeYamlNew(safePath(temporary, "topic.yaml"), topic);
    await writeYamlNew(safePath(temporary, "status.yaml"), status);
    await writeNew(
      safePath(temporary, "prompt.md"),
      `# Prompt\n\n${options.prompt?.trim() || "Describe the goal and acceptance criteria."}\n`,
    );
    await writeNew(
      safePath(temporary, "context.md"),
      `# Context\n\n${options.context?.trim() || "Add known facts, constraints, and sources."}\n`,
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { topic, status };
}

export async function listTopics(start?: string): Promise<Array<Record<string, unknown>>> {
  const { root } = await loadForum(start);
  const result: Array<Record<string, unknown>> = [];
  for (const directory of await listDirectories(safePath(root, "topics"))) {
    if (basename(directory).startsWith(".tmp-")) continue;
    const { topic, status } = await loadTopic(root, basename(directory));
    result.push({
      ...topic,
      state: status.state,
      owner: status.owner,
      resolution_owner: status.resolution_owner,
    });
  }
  return result;
}

export async function showTopic(
  start: string | undefined,
  topicId: string,
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const { directory, topic, status } = await loadTopic(root, topicId);
  return {
    topic,
    status,
    counts: {
      responses: (await listFiles(safePath(directory, "responses"), ".md")).length,
      resolutions: (await listFiles(safePath(directory, "resolutions"), ".md")).length,
      actions: (await listFiles(safePath(directory, "actions"), ".md")).length,
    },
  };
}

export async function createResponse(
  start: string | undefined,
  options: {
    topicId: string;
    agent: string;
    kind: string;
    summary: string;
    evidence: string;
    outcome: string;
    next: string;
    supersedes?: string;
  },
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const { directory, status } = await loadTopic(root, options.topicId);
  assertTopicWritable(status, "response creation");
  await loadAgent(root, options.agent);
  const responseId = makeRecordId("response");
  const metadata: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    response_id: responseId,
    topic_id: options.topicId,
    agent: options.agent,
    submitted_by: options.agent,
    capture_mode: "direct",
    created_at: nowIso(),
    kind: options.kind,
    summary: requireString(options.summary, "summary"),
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
  };
  assertSchema("response", metadata);
  const body = `# Response\n\n## Evidence\n\n${requireString(options.evidence, "evidence")}\n\n## Outcome\n\n${requireString(options.outcome, "outcome")}\n\n## Next\n\n${requireString(options.next, "next")}`;
  const target = safePath(directory, "responses", `${responseId}.md`);
  await writeNew(target, formatMarkdown(metadata, body));
  return { response_id: responseId, path: relative(root, target), metadata };
}

export async function importReceipt(
  start: string | undefined,
  options: { topicId: string; input: string; submittedBy: string },
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const { directory, status } = await loadTopic(root, options.topicId);
  assertTopicWritable(status, "receipt import");
  await loadAgent(root, options.submittedBy);
  let receipt: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readTextLimited(resolve(options.input)));
    if (!isRecord(parsed)) throw new Error("receipt must be an object");
    receipt = parsed;
  } catch (error) {
    throw new ForumError("AF_RECEIPT_JSON", `invalid receipt JSON: ${String(error)}`, 2);
  }
  assertSchema("receipt", receipt, "receipt input");
  const workingAgent = requireString(receipt.agent, "receipt.agent");
  await loadAgent(root, workingAgent);
  const sourceValue = receipt.source_artifact ?? receipt.source_session_id;
  const source = assertSafeSource(requireString(sourceValue, "receipt source"), "receipt source");
  const responseId = makeRecordId("receipt");
  const metadata: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    response_id: responseId,
    topic_id: options.topicId,
    agent: workingAgent,
    submitted_by: options.submittedBy,
    capture_mode: "imported",
    created_at: nowIso(),
    kind: "implementation",
    summary: receipt.summary,
    source,
    receipt_version: "1",
    work_status: receipt.work_status,
    next_owner: receipt.next_owner,
    next_step: receipt.next_step,
    confidence: receipt.confidence,
  };
  assertSchema("response", metadata);
  const body = `# Work Receipt\n\n## Evidence\n\n${receipt.evidence}\n\n## Outcome\n\n${receipt.outcome}\n\n## Next\n\n${receipt.next_step}`;
  const target = safePath(directory, "responses", `${responseId}.md`);
  await writeNew(target, formatMarkdown(metadata, body));
  return { response_id: responseId, path: relative(root, target), metadata };
}

export async function resolveTopic(
  start: string | undefined,
  options: {
    topicId: string;
    owner: string;
    summary: string;
    decision: string;
    supersedes?: string;
  },
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const { directory, status } = await loadTopic(root, options.topicId);
  assertTopicWritable(status, "resolution creation");
  if (options.owner !== status.resolution_owner) {
    throw new ForumError(
      "AF_RESOLUTION_OWNER",
      `resolution owner is ${status.resolution_owner}, not ${options.owner}`,
      2,
    );
  }
  await loadAgent(root, options.owner);
  const resolutionId = makeRecordId("resolution");
  const createdAt = nowIso();
  const metadata: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    resolution_id: resolutionId,
    topic_id: options.topicId,
    owner: options.owner,
    created_at: createdAt,
    summary: requireString(options.summary, "summary"),
    ...(options.supersedes ? { supersedes: options.supersedes } : {}),
  };
  assertSchema("resolution", metadata);
  const target = safePath(directory, "resolutions", `${resolutionId}.md`);
  await writeNew(
    target,
    formatMarkdown(
      metadata,
      `# Resolution\n\n## Decision\n\n${requireString(options.decision, "decision")}`,
    ),
  );
  const updated: TopicStatusRecord = {
    ...status,
    state: "resolved",
    updated_at: createdAt,
    resolved_at: createdAt,
    current_resolution: resolutionId,
  };
  try {
    await replaceYaml(safePath(directory, "status.yaml"), updated);
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
  return { resolution_id: resolutionId, path: relative(root, target), status: updated };
}

export async function createAction(
  start: string | undefined,
  options: {
    topicId: string;
    title: string;
    owner: string;
    createdBy: string;
    sourceResolution?: string;
    note?: string;
  },
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const { directory, status } = await loadTopic(root, options.topicId);
  if (status.state === "archived") {
    throw new ForumError("AF_TOPIC_ARCHIVED", "cannot create an action in an archived topic", 2);
  }
  if (status.state === "resolved" && options.sourceResolution !== status.current_resolution) {
    throw new ForumError(
      "AF_ACTION_RESOLUTION",
      "an action added after resolution must reference the current resolution",
      2,
    );
  }
  await loadAgent(root, options.owner);
  await loadAgent(root, options.createdBy);
  const actionId = makeRecordId("action");
  const createdAt = nowIso();
  const metadata: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    action_id: actionId,
    topic_id: options.topicId,
    title: requireString(options.title, "action title"),
    owner: options.owner,
    created_by: options.createdBy,
    status: "proposed",
    created_at: createdAt,
    updated_at: createdAt,
    ...(options.sourceResolution ? { source_resolution: options.sourceResolution } : {}),
  };
  assertSchema("action", metadata);
  const target = safePath(directory, "actions", `${actionId}.md`);
  await writeNew(
    target,
    formatMarkdown(metadata, `# Action\n\n## Notes\n\n${options.note?.trim() || "No notes."}`),
  );
  return { action_id: actionId, path: relative(root, target), metadata };
}

const transitions: Record<ActionStatus, ActionStatus[]> = {
  proposed: ["ready", "cancelled"],
  ready: ["doing", "waiting", "done", "cancelled"],
  doing: ["waiting", "done", "cancelled"],
  waiting: ["ready", "doing", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export async function updateAction(
  start: string | undefined,
  options: { topicId: string; actionId: string; status: ActionStatus; note?: string },
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const { directory } = await loadTopic(root, options.topicId);
  const target = safePath(directory, "actions", `${options.actionId}.md`);
  if (!(await pathExists(target))) {
    throw new ForumError("AF_ACTION_MISSING", `action not found: ${options.actionId}`, 2);
  }
  const parsed = parseMarkdown(await readTextLimited(target), relative(root, target));
  assertSchema("action", parsed.metadata, relative(root, target));
  const current = parsed.metadata.status as ActionStatus;
  if (current !== options.status && !transitions[current].includes(options.status)) {
    throw new ForumError(
      "AF_ACTION_TRANSITION",
      `invalid action transition: ${current} -> ${options.status}`,
      2,
    );
  }
  const updated = { ...parsed.metadata, status: options.status, updated_at: nowIso() };
  assertSchema("action", updated);
  const note = options.note?.trim();
  const body = note ? `${parsed.body}\n\n- ${nowIso()}: ${note}` : parsed.body;
  await replaceAtomic(target, formatMarkdown(updated, body));
  return { action_id: options.actionId, status: options.status, path: relative(root, target) };
}

export async function listActions(
  start: string | undefined,
  topicId: string,
): Promise<Array<Record<string, unknown>>> {
  const { root } = await loadForum(start);
  const { directory } = await loadTopic(root, topicId);
  const result: Array<Record<string, unknown>> = [];
  for (const path of await listFiles(safePath(directory, "actions"), ".md")) {
    result.push(parseMarkdown(await readTextLimited(path), relative(root, path)).metadata);
  }
  return result;
}

export async function createInvitation(
  start: string | undefined,
  options: { repository?: string; scope: string; expiresAt: string; createdBy: string },
): Promise<Record<string, unknown>> {
  const { root, forum } = await loadForum(start);
  await loadAgent(root, options.createdBy);
  const repository = options.repository ?? forum.repository;
  if (!repository) {
    throw new ForumError("AF_REPOSITORY_REQUIRED", "repository is required for an invitation", 2);
  }
  const payload = {
    schema_version: SCHEMA_VERSION,
    invitation_id: makeRecordId("invite"),
    forum_id: forum.forum_id,
    protocol_version: PROTOCOL_VERSION,
    repository,
    scope: requireString(options.scope, "scope"),
    created_by: options.createdBy,
    created_at: nowIso(),
    expires_at: parseFutureDate(options.expiresAt),
  };
  const digest = sha256(JSON.stringify(payload));
  const record = { ...payload, status: "active", digest };
  assertSchema("invitation", record);
  await writeYamlNew(safePath(root, "invitations", `${payload.invitation_id}.yaml`), record);
  const code = encodeEnvelope({ payload, digest });
  return { invitation_id: payload.invitation_id, expires_at: payload.expires_at, code };
}

export async function revokeInvitation(
  start: string | undefined,
  invitationId: string,
): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const target = safePath(root, "invitations", `${invitationId}.yaml`);
  if (!(await pathExists(target))) {
    throw new ForumError("AF_INVITATION_MISSING", `invitation not found: ${invitationId}`, 2);
  }
  const record = await readYaml<Record<string, unknown>>(target);
  assertSchema("invitation", record, relative(root, target));
  const updated = { ...record, status: "revoked" };
  assertSchema("invitation", updated);
  await replaceYaml(target, updated);
  return { invitation_id: invitationId, status: "revoked" };
}

export async function joinForum(
  start: string | undefined,
  options: { code: string; agentId: string; name: string; type: AgentType; runtime?: string },
): Promise<Record<string, unknown>> {
  const { root, forum } = await loadForum(start);
  const decoded = decodeEnvelope(options.code);
  if (!isRecord(decoded) || !isRecord(decoded.payload) || typeof decoded.digest !== "string") {
    throw new ForumError("AF_INVITE_FORMAT", "Join Code envelope is malformed", 2);
  }
  const payload = decoded.payload;
  const digest = sha256(JSON.stringify(payload));
  if (digest !== decoded.digest) {
    throw new ForumError("AF_INVITE_TAMPERED", "Join Code digest does not match its payload", 2);
  }
  const invitationId = requireString(payload.invitation_id, "invitation_id");
  if (payload.forum_id !== forum.forum_id || payload.protocol_version !== PROTOCOL_VERSION) {
    throw new ForumError("AF_INVITE_TARGET", "Join Code targets a different Forum or protocol", 2);
  }
  const invitationPath = safePath(root, "invitations", `${invitationId}.yaml`);
  if (!(await pathExists(invitationPath))) {
    throw new ForumError("AF_INVITATION_MISSING", `invitation not found: ${invitationId}`, 2);
  }
  const invitation = await readYaml<Record<string, unknown>>(invitationPath);
  assertSchema("invitation", invitation, relative(root, invitationPath));
  if (invitation.digest !== digest || invitation.status !== "active") {
    throw new ForumError("AF_INVITE_REVOKED", "invitation is revoked or does not match", 2);
  }
  if (new Date(requireString(invitation.expires_at, "expires_at")).getTime() <= Date.now()) {
    throw new ForumError("AF_INVITE_EXPIRED", "invitation has expired", 2);
  }
  const agentId = assertIdentifier(options.agentId, "agent id");
  if (await pathExists(safePath(root, "agents", `${agentId}.yaml`))) {
    throw new ForumError("AF_AGENT_EXISTS", `agent already exists: ${agentId}`, 2);
  }
  const requestId = makeRecordId("join");
  const metadata: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    request_id: requestId,
    invitation_id: invitationId,
    forum_id: forum.forum_id,
    agent_id: agentId,
    name: requireString(options.name, "name"),
    type: options.type,
    ...(options.runtime ? { runtime: options.runtime } : {}),
    created_at: nowIso(),
    scope: invitation.scope,
    status: "pending",
  };
  assertSchema("join-request", metadata);
  const target = safePath(root, "join-requests", `${requestId}.md`);
  await writeNew(
    target,
    formatMarkdown(
      metadata,
      "# Join Request\n\nThis request declares an identity and requested scope. It grants no repository permission.",
    ),
  );
  return { request_id: requestId, path: relative(root, target), status: "pending" };
}

async function walkRecordFiles(root: string, directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) return [];
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = safePath(root, relative(root, directory), entry.name);
    if (entry.isDirectory()) result.push(...(await walkRecordFiles(root, target)));
    if (entry.isFile() && /\.(?:md|ya?ml|json)$/.test(entry.name)) result.push(target);
  }
  return result;
}

function scanText(path: string, text: string, errors: string[]): void {
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) errors.push(`${path}: possible ${label}`);
  }
  for (const [label, pattern] of ABSOLUTE_PATH_PATTERNS) {
    if (pattern.test(text)) errors.push(`${path}: contains ${label}`);
  }
}

export async function validateForum(start?: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: ValidationResult["counts"] = {
    agents: 0,
    topics: 0,
    responses: 0,
    receipts: 0,
    resolutions: 0,
    actions: 0,
    invitations: 0,
    joinRequests: 0,
  };

  let root: string;
  let forum: ForumConfig;
  try {
    ({ root, forum } = await loadForum(start));
    await assertNoSymlinks(root);
  } catch (error) {
    return { ok: false, errors: [asForumError(error).message], warnings, counts };
  }

  const agents = new Map<string, AgentRecord>();
  for (const path of await listFiles(safePath(root, "agents"), ".yaml")) {
    try {
      const record = await readYaml<AgentRecord>(path);
      assertSchema("agent", record, relative(root, path));
      if (basename(path, ".yaml") !== record.agent_id)
        throw new Error("filename does not match agent_id");
      if (agents.has(record.agent_id)) throw new Error(`duplicate agent id: ${record.agent_id}`);
      agents.set(record.agent_id, record);
      counts.agents += 1;
    } catch (error) {
      errors.push(`${relative(root, path)}: ${asForumError(error).message}`);
    }
  }
  if (!agents.has(forum.owner)) errors.push(`forum owner is not registered: ${forum.owner}`);

  for (const directory of await listDirectories(safePath(root, "topics"))) {
    if (basename(directory).startsWith(".tmp-")) {
      errors.push(`${relative(root, directory)}: incomplete temporary topic directory`);
      continue;
    }
    counts.topics += 1;
    let topic: TopicRecord;
    let status: TopicStatusRecord;
    try {
      topic = await readYaml<TopicRecord>(safePath(directory, "topic.yaml"));
      status = await readYaml<TopicStatusRecord>(safePath(directory, "status.yaml"));
      assertSchema("topic", topic, `${relative(root, directory)}/topic.yaml`);
      assertSchema("status", status, `${relative(root, directory)}/status.yaml`);
      if (basename(directory) !== topic.topic_id || topic.topic_id !== status.topic_id) {
        throw new Error("topic directory, topic_id, and status.topic_id must match");
      }
      if (!agents.has(status.owner))
        errors.push(`${topic.topic_id}: owner is not registered: ${status.owner}`);
      if (!agents.has(status.resolution_owner)) {
        errors.push(
          `${topic.topic_id}: resolution owner is not registered: ${status.resolution_owner}`,
        );
      }
    } catch (error) {
      errors.push(`${relative(root, directory)}: ${asForumError(error).message}`);
      continue;
    }

    const responseIds = new Set<string>();
    for (const path of await listFiles(safePath(directory, "responses"), ".md")) {
      try {
        const parsed = parseMarkdown(await readTextLimited(path), relative(root, path));
        assertSchema("response", parsed.metadata, relative(root, path));
        const id = requireString(parsed.metadata.response_id, "response_id");
        if (basename(path, ".md") !== id) throw new Error("filename does not match response_id");
        if (parsed.metadata.topic_id !== topic.topic_id)
          throw new Error("response topic_id mismatch");
        if (!agents.has(requireString(parsed.metadata.agent, "agent"))) {
          throw new Error(`response agent is not registered: ${String(parsed.metadata.agent)}`);
        }
        if (!agents.has(requireString(parsed.metadata.submitted_by, "submitted_by"))) {
          throw new Error(
            `response submitter is not registered: ${String(parsed.metadata.submitted_by)}`,
          );
        }
        if (responseIds.has(id)) throw new Error(`duplicate response id: ${id}`);
        responseIds.add(id);
        if (
          parsed.metadata.capture_mode === "direct" &&
          parsed.metadata.agent !== parsed.metadata.submitted_by
        ) {
          throw new Error("direct response must have agent == submitted_by");
        }
        if (
          parsed.metadata.capture_mode === "imported" &&
          typeof parsed.metadata.source !== "string"
        ) {
          throw new Error("imported response must preserve a source");
        }
        if (
          status.resolved_at &&
          new Date(requireString(parsed.metadata.created_at, "created_at")).getTime() >
            new Date(status.resolved_at).getTime()
        ) {
          throw new Error("response was created after the topic was resolved");
        }
        counts.responses += 1;
        if (parsed.metadata.receipt_version === "1") counts.receipts += 1;
      } catch (error) {
        errors.push(`${relative(root, path)}: ${asForumError(error).message}`);
      }
    }

    const resolutionIds = new Set<string>();
    for (const path of await listFiles(safePath(directory, "resolutions"), ".md")) {
      try {
        const parsed = parseMarkdown(await readTextLimited(path), relative(root, path));
        assertSchema("resolution", parsed.metadata, relative(root, path));
        const id = requireString(parsed.metadata.resolution_id, "resolution_id");
        if (basename(path, ".md") !== id) throw new Error("filename does not match resolution_id");
        if (parsed.metadata.topic_id !== topic.topic_id)
          throw new Error("resolution topic_id mismatch");
        if (parsed.metadata.owner !== status.resolution_owner)
          throw new Error("resolution owner mismatch");
        resolutionIds.add(id);
        counts.resolutions += 1;
      } catch (error) {
        errors.push(`${relative(root, path)}: ${asForumError(error).message}`);
      }
    }
    if (status.state === "resolved" && !status.current_resolution) {
      errors.push(`${topic.topic_id}: resolved topic has no current_resolution`);
    }
    if (status.current_resolution && !resolutionIds.has(status.current_resolution)) {
      errors.push(
        `${topic.topic_id}: current_resolution does not exist: ${status.current_resolution}`,
      );
    }

    for (const path of await listFiles(safePath(directory, "actions"), ".md")) {
      try {
        const parsed = parseMarkdown(await readTextLimited(path), relative(root, path));
        assertSchema("action", parsed.metadata, relative(root, path));
        const id = requireString(parsed.metadata.action_id, "action_id");
        if (basename(path, ".md") !== id) throw new Error("filename does not match action_id");
        if (parsed.metadata.topic_id !== topic.topic_id)
          throw new Error("action topic_id mismatch");
        if (!agents.has(requireString(parsed.metadata.owner, "owner")))
          throw new Error("action owner missing");
        if (!agents.has(requireString(parsed.metadata.created_by, "created_by"))) {
          throw new Error("action creator missing");
        }
        if (
          parsed.metadata.source_resolution &&
          !resolutionIds.has(requireString(parsed.metadata.source_resolution, "source_resolution"))
        ) {
          throw new Error("action source_resolution does not exist");
        }
        counts.actions += 1;
      } catch (error) {
        errors.push(`${relative(root, path)}: ${asForumError(error).message}`);
      }
    }
  }

  for (const path of await listFiles(safePath(root, "invitations"), ".yaml")) {
    try {
      const record = await readYaml<Record<string, unknown>>(path);
      assertSchema("invitation", record, relative(root, path));
      if (basename(path, ".yaml") !== record.invitation_id) throw new Error("filename mismatch");
      counts.invitations += 1;
    } catch (error) {
      errors.push(`${relative(root, path)}: ${asForumError(error).message}`);
    }
  }
  for (const path of await listFiles(safePath(root, "join-requests"), ".md")) {
    try {
      const parsed = parseMarkdown(await readTextLimited(path), relative(root, path));
      assertSchema("join-request", parsed.metadata, relative(root, path));
      if (basename(path, ".md") !== parsed.metadata.request_id)
        throw new Error("filename mismatch");
      counts.joinRequests += 1;
    } catch (error) {
      errors.push(`${relative(root, path)}: ${asForumError(error).message}`);
    }
  }

  const scanRoots = [
    safePath(root, "forum.yaml"),
    safePath(root, "agents"),
    safePath(root, "topics"),
    safePath(root, "invitations"),
    safePath(root, "join-requests"),
  ];
  for (const scanRoot of scanRoots) {
    if (!(await pathExists(scanRoot))) continue;
    const info = await stat(scanRoot);
    const paths = info.isDirectory() ? await walkRecordFiles(root, scanRoot) : [scanRoot];
    for (const path of paths) scanText(relative(root, path), await readTextLimited(path), errors);
  }

  if (counts.topics === 0) warnings.push("Forum has no topics yet");
  return { ok: errors.length === 0, errors, warnings, counts };
}

export async function guardForum(start?: string): Promise<Record<string, unknown>> {
  const { root } = await loadForum(start);
  const validation = await validateForum(root);
  if (!validation.ok) {
    throw new ForumError("AF_VALIDATION_FAILED", "Forum validation failed", 2, validation.errors);
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new ForumError(
      "AF_GIT_BASELINE",
      "guard needs an initial Git commit before it can prove immutability",
      2,
    );
  }
  const output = execFileSync("git", ["diff", "--name-status", "HEAD", "--", "."], {
    cwd: root,
    encoding: "utf8",
  });
  const violations: string[] = [];
  const changes: string[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const fields = line.split("\t");
    const status = fields[0] ?? "";
    const paths = fields.slice(1);
    changes.push(line);
    for (const path of paths) {
      const immutable =
        /^topics\/[^/]+\/(responses|resolutions)\/[^/]+\.md$/.test(path) ||
        /^join-requests\/[^/]+\.md$/.test(path) ||
        /^agents\/[^/]+\.yaml$/.test(path) ||
        path === "forum.yaml";
      const deletedAction =
        status.startsWith("D") && /^topics\/[^/]+\/actions\/[^/]+\.md$/.test(path);
      if ((immutable && !status.startsWith("A")) || deletedAction) {
        violations.push(`${status}: immutable or protected path changed: ${path}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new ForumError(
      "AF_GUARD_REJECTED",
      "guard rejected protected history changes",
      2,
      violations,
    );
  }
  return { ok: true, changes, validation };
}
