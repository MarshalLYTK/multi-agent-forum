#!/usr/bin/env node

import { asForumError, ForumError } from "./error.js";
import type { ActionStatus, AgentType } from "./model.js";
import {
  addAgent,
  createAction,
  createInvitation,
  createResponse,
  createTopic,
  doctorForum,
  guardForum,
  importReceipt,
  initForum,
  joinForum,
  listActions,
  listAgents,
  listTopics,
  resolveTopic,
  revokeInvitation,
  showAgent,
  showTopic,
  updateAction,
  validateForum,
} from "./operations.js";

const VERSION = "0.1.0";

interface ParsedArguments {
  positionals: string[];
  options: Map<string, string | boolean>;
}

function parseArguments(tokens: string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string | boolean>();
  const booleans = new Set(["json", "dry-run", "no-git", "help", "version"]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (booleans.has(key)) {
      options.set(key, true);
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ForumError("AF_OPTION_VALUE", `--${key} requires a value`, 2);
    }
    options.set(key, value);
    index += 1;
  }
  return { positionals, options };
}

function option(parsed: ParsedArguments, key: string, required = false): string | undefined {
  const value = parsed.options.get(key);
  if (typeof value === "string") return value;
  if (required) throw new ForumError("AF_REQUIRED_OPTION", `--${key} is required`, 2);
  return undefined;
}

function positional(parsed: ParsedArguments, index: number, label: string): string {
  const value = parsed.positionals[index];
  if (!value) throw new ForumError("AF_REQUIRED_ARGUMENT", `${label} is required`, 2);
  return value;
}

function agentType(value: string | undefined): AgentType {
  const normalized = value ?? "ai";
  if (normalized !== "human" && normalized !== "ai") {
    throw new ForumError("AF_AGENT_TYPE", "agent type must be human or ai", 2);
  }
  return normalized;
}

function actionStatus(value: string): ActionStatus {
  const statuses: ActionStatus[] = ["proposed", "ready", "doing", "waiting", "done", "cancelled"];
  if (!statuses.includes(value as ActionStatus)) {
    throw new ForumError("AF_ACTION_STATUS", `invalid action status: ${value}`, 2);
  }
  return value as ActionStatus;
}

function printHelp(): void {
  process.stdout.write(`Agent Forum ${VERSION}

Usage:
  agent-forum init [directory] --owner <id> [--name <name>] [--repository <url>]
  agent-forum doctor [--root <path>]
  agent-forum agent add <id> --name <name> [--type human|ai] [--runtime <name>]
  agent-forum agent list
  agent-forum agent show <id>
  agent-forum topic create <id> --title <text> --owner <id> --resolution-owner <id>
  agent-forum topic list
  agent-forum topic show <id>
  agent-forum response create --topic <id> --agent <id> --kind <kind> --summary <text>
                              --evidence <text> --outcome <text> --next <text>
  agent-forum receipt import <json-file> --topic <id> --submitted-by <id>
  agent-forum resolve --topic <id> --owner <id> --summary <text> --decision <text>
  agent-forum action create --topic <id> --title <text> --owner <id> --created-by <id>
  agent-forum action list --topic <id>
  agent-forum action update <id> --topic <id> --status <status> [--note <text>]
  agent-forum invite create --scope <text> --expires <iso-date> --created-by <id>
  agent-forum invite revoke <id>
  agent-forum join <AF1_code> --agent <id> --name <name> [--type human|ai]
  agent-forum validate [--root <path>]
  agent-forum guard [--root <path>]

Global options:
  --root <path>  Start Forum discovery from this path
  --json         Emit machine-readable JSON
  --dry-run      Describe a write without changing files
  --help         Show this help
  --version      Show the version
`);
}

function output(value: unknown, json: boolean): void {
  if (json || typeof value !== "string") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}

function dryRun(parsed: ParsedArguments, command: string): Record<string, unknown> | undefined {
  if (!parsed.options.has("dry-run")) return undefined;
  return {
    ok: true,
    dry_run: true,
    command,
    positionals: parsed.positionals,
    options: Object.fromEntries(
      [...parsed.options.entries()].filter(([key]) => !["json", "dry-run"].includes(key)),
    ),
  };
}

async function run(): Promise<void> {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw.includes("--help")) {
    printHelp();
    return;
  }
  if (raw.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const parsed = parseArguments(raw);
  const json = parsed.options.has("json");
  const root = option(parsed, "root");
  const command = positional(parsed, 0, "command");
  const subcommand = parsed.positionals[1];
  let result: unknown;

  if (command === "init") {
    result =
      dryRun(parsed, "init") ??
      (await initForum({
        directory: parsed.positionals[1] ?? ".",
        owner: option(parsed, "owner", true) as string,
        ...(option(parsed, "owner-name") ? { ownerName: option(parsed, "owner-name") } : {}),
        ...(option(parsed, "name") ? { name: option(parsed, "name") } : {}),
        ...(option(parsed, "repository") ? { repository: option(parsed, "repository") } : {}),
        git: !parsed.options.has("no-git"),
      }));
  } else if (command === "doctor") {
    result = await doctorForum(root);
  } else if (command === "agent" && subcommand === "add") {
    result =
      dryRun(parsed, "agent add") ??
      (await addAgent(root, {
        id: positional(parsed, 2, "agent id"),
        name: option(parsed, "name", true) as string,
        type: agentType(option(parsed, "type")),
        ...(option(parsed, "runtime") ? { runtime: option(parsed, "runtime") } : {}),
      }));
  } else if (command === "agent" && subcommand === "list") {
    result = await listAgents(root);
  } else if (command === "agent" && subcommand === "show") {
    result = await showAgent(root, positional(parsed, 2, "agent id"));
  } else if (command === "topic" && subcommand === "create") {
    result =
      dryRun(parsed, "topic create") ??
      (await createTopic(root, {
        id: positional(parsed, 2, "topic id"),
        title: option(parsed, "title", true) as string,
        owner: option(parsed, "owner", true) as string,
        resolutionOwner: option(parsed, "resolution-owner", true) as string,
        ...(option(parsed, "prompt") ? { prompt: option(parsed, "prompt") } : {}),
        ...(option(parsed, "context") ? { context: option(parsed, "context") } : {}),
      }));
  } else if (command === "topic" && subcommand === "list") {
    result = await listTopics(root);
  } else if (command === "topic" && subcommand === "show") {
    result = await showTopic(root, positional(parsed, 2, "topic id"));
  } else if (command === "response" && subcommand === "create") {
    result =
      dryRun(parsed, "response create") ??
      (await createResponse(root, {
        topicId: option(parsed, "topic", true) as string,
        agent: option(parsed, "agent", true) as string,
        kind: option(parsed, "kind", true) as string,
        summary: option(parsed, "summary", true) as string,
        evidence: option(parsed, "evidence", true) as string,
        outcome: option(parsed, "outcome", true) as string,
        next: option(parsed, "next", true) as string,
        ...(option(parsed, "supersedes") ? { supersedes: option(parsed, "supersedes") } : {}),
      }));
  } else if (command === "receipt" && subcommand === "import") {
    result =
      dryRun(parsed, "receipt import") ??
      (await importReceipt(root, {
        input: positional(parsed, 2, "receipt JSON file"),
        topicId: option(parsed, "topic", true) as string,
        submittedBy: option(parsed, "submitted-by", true) as string,
      }));
  } else if (command === "resolve") {
    result =
      dryRun(parsed, "resolve") ??
      (await resolveTopic(root, {
        topicId: option(parsed, "topic", true) as string,
        owner: option(parsed, "owner", true) as string,
        summary: option(parsed, "summary", true) as string,
        decision: option(parsed, "decision", true) as string,
        ...(option(parsed, "supersedes") ? { supersedes: option(parsed, "supersedes") } : {}),
      }));
  } else if (command === "action" && subcommand === "create") {
    result =
      dryRun(parsed, "action create") ??
      (await createAction(root, {
        topicId: option(parsed, "topic", true) as string,
        title: option(parsed, "title", true) as string,
        owner: option(parsed, "owner", true) as string,
        createdBy: option(parsed, "created-by", true) as string,
        ...(option(parsed, "resolution") ? { sourceResolution: option(parsed, "resolution") } : {}),
        ...(option(parsed, "note") ? { note: option(parsed, "note") } : {}),
      }));
  } else if (command === "action" && subcommand === "list") {
    result = await listActions(root, option(parsed, "topic", true) as string);
  } else if (command === "action" && subcommand === "update") {
    result =
      dryRun(parsed, "action update") ??
      (await updateAction(root, {
        actionId: positional(parsed, 2, "action id"),
        topicId: option(parsed, "topic", true) as string,
        status: actionStatus(option(parsed, "status", true) as string),
        ...(option(parsed, "note") ? { note: option(parsed, "note") } : {}),
      }));
  } else if (command === "invite" && subcommand === "create") {
    result =
      dryRun(parsed, "invite create") ??
      (await createInvitation(root, {
        scope: option(parsed, "scope", true) as string,
        expiresAt: option(parsed, "expires", true) as string,
        createdBy: option(parsed, "created-by", true) as string,
        ...(option(parsed, "repository") ? { repository: option(parsed, "repository") } : {}),
      }));
  } else if (command === "invite" && subcommand === "revoke") {
    result =
      dryRun(parsed, "invite revoke") ??
      (await revokeInvitation(root, positional(parsed, 2, "invitation id")));
  } else if (command === "join") {
    result =
      dryRun(parsed, "join") ??
      (await joinForum(root, {
        code: positional(parsed, 1, "Join Code"),
        agentId: option(parsed, "agent", true) as string,
        name: option(parsed, "name", true) as string,
        type: agentType(option(parsed, "type")),
        ...(option(parsed, "runtime") ? { runtime: option(parsed, "runtime") } : {}),
      }));
  } else if (command === "validate") {
    result = await validateForum(root);
  } else if (command === "guard") {
    result = await guardForum(root);
  } else {
    throw new ForumError("AF_COMMAND", `unknown command: ${parsed.positionals.join(" ")}`, 2);
  }

  output(result, json);
  if (isResultFailure(result)) process.exitCode = 2;
}

function isResultFailure(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

run().catch((error: unknown) => {
  const forumError = asForumError(error);
  const json = process.argv.includes("--json");
  if (json) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: { code: forumError.code, message: forumError.message, details: forumError.details } }, null, 2)}\n`,
    );
  } else {
    process.stderr.write(`agent-forum: ${forumError.message} [${forumError.code}]\n`);
    if (forumError.details)
      process.stderr.write(`${JSON.stringify(forumError.details, null, 2)}\n`);
  }
  process.exitCode = forumError.exitCode;
});
