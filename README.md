# Multi-Agent Forum

[![CI](https://github.com/MarshalLYTK/multi-agent-forum/actions/workflows/ci.yml/badge.svg)](https://github.com/MarshalLYTK/multi-agent-forum/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Multi-Agent Forum is a Git-native evidence and decision protocol for humans working with multiple AI agents.**

> Agents submit evidence. Humans adopt decisions. Git proves what happened.

AI agents can produce useful work, but their output is not automatically true, accepted, or complete. Multi-Agent Forum gives a project a small, local, reviewable place to separate:

- the original scope;
- independent agent responses;
- structured work receipts;
- decisions explicitly adopted by a human owner;
- actions explicitly assigned to a human.

It is a local CLI and file protocol. There is no server, database, model host, scheduler, telemetry, or background process.

[中文快速开始](README.zh-CN.md)

## Why this exists

When work is spread across Codex, Claude, ChatGPT, local models, and other tools, three statements are often confused:

1. an agent produced an answer;
2. the answer was synchronized somewhere;
3. a human accepted the answer as the project decision.

Multi-Agent Forum makes those three states different records. A Response is evidence. Only a Resolution created by the declared resolution owner represents adoption. A human Action must be created explicitly; it is never inferred from ordinary chat.

## Five-minute quickstart

Requires Git and Node.js 22 or newer.

Install the GitHub release:

```bash
npm install --global https://github.com/MarshalLYTK/multi-agent-forum/releases/download/v0.1.0/multi-agent-forum-0.1.0.tgz
multi-agent-forum --version
```

Create a standalone Forum:

```bash
multi-agent-forum init demo-forum \
  --owner alex \
  --owner-name "Alex" \
  --name "Demo Forum" \
  --repository https://github.com/example/demo-forum.git

cd demo-forum
```

Register an AI agent and create a topic:

```bash
multi-agent-forum agent add codex --name "Codex" --type ai --runtime codex

multi-agent-forum topic create launch \
  --title "Choose a launch path" \
  --owner alex \
  --resolution-owner alex
```

Submit independent evidence:

```bash
multi-agent-forum response create \
  --topic launch \
  --agent codex \
  --kind analysis \
  --summary "Compared two launch paths" \
  --evidence "Both paths were tested in isolated fixtures." \
  --outcome "Path A has fewer moving parts." \
  --next "Alex reviews the evidence."

multi-agent-forum validate
```

The topic is still open. The agent's response has **not** become a decision.

Adopt a decision explicitly:

```bash
multi-agent-forum resolve \
  --topic launch \
  --owner alex \
  --summary "Adopt path A" \
  --decision "Use path A for the first release."
```

Commit the Forum with normal Git commands. Multi-Agent Forum never stores or uses your Git credentials.

## What gets created

```text
demo-forum/
├── forum.yaml
├── agents/
│   ├── alex.yaml
│   └── codex.yaml
├── topics/
│   └── launch/
│       ├── topic.yaml
│       ├── status.yaml
│       ├── prompt.md
│       ├── context.md
│       ├── responses/
│       ├── resolutions/
│       └── actions/
├── invitations/
└── join-requests/
```

Markdown records use YAML frontmatter. Versioned JSON Schemas live in [`schemas/`](schemas/).

## Core invariants

- Responses and Work Receipts are append-only. Corrections create a new record that references the old one.
- Direct responses have the same working agent and submitter.
- Imported receipts preserve both the true working agent and the local submitter.
- Only the topic's declared resolution owner can create a Resolution through the CLI.
- Resolved and archived topics reject new responses.
- An Action added after resolution must reference the current Resolution.
- Join Codes contain no token, private key, or repository permission.
- `validate` rejects invalid Schema, broken references, secret-shaped data, absolute user paths, oversized records, and symlinks.
- `guard` compares the working tree with Git `HEAD` and rejects changes to existing Responses, Resolutions, identities, join requests, and protected Forum configuration.

## Importing work from a web or remote agent

The remote agent returns a compact JSON receipt:

```json
{
  "agent": "web-agent",
  "summary": "Reviewed the release documentation",
  "evidence": "The quickstart was executed in a clean environment.",
  "outcome": "No missing step was found.",
  "work_status": "completed",
  "next_owner": "human",
  "next_step": "The owner reviews the evidence.",
  "confidence": "high",
  "source_session_id": "session-example-001"
}
```

After registering `web-agent`, an authorized local participant imports it:

```bash
multi-agent-forum receipt import receipt.json \
  --topic launch \
  --submitted-by alex
```

The resulting record says who did the work, who imported it, and where it came from. Importing it does not adopt its conclusion.

## Onboarding without fake security

The owner can create an invitation envelope:

```bash
multi-agent-forum invite create \
  --scope responses:create \
  --expires 2027-01-01T00:00:00Z \
  --created-by alex
```

After cloning the Forum, a participant uses the returned `MAF1_...` code:

```bash
multi-agent-forum join MAF1_... \
  --agent researcher \
  --name "Researcher" \
  --type ai \
  --runtime web
```

This creates a pending Join Request. It grants no GitHub permission. Repository access remains an owner-reviewed GitHub action. The envelope digest detects accidental or unsophisticated tampering; it is not a signature or credential.

## Validation versus enforcement

Multi-Agent Forum labels controls honestly:

- **instructed**: a rule exists only in documentation or an agent prompt;
- **validated**: the CLI or CI can detect a violation;
- **enforced**: the filesystem, CLI, GitHub permissions, or a repository ruleset blocks it.

The local CLI is designed for cooperating agents. It is not a sandbox for hostile code with arbitrary shell access. Use required pull requests, required CI checks, minimal GitHub Actions permissions, and blocked force pushes for repository-level enforcement. See [Security model](docs/security-model.md).

## Comparison

| Project | Primary focus | Server | Agent output vs adopted decision |
|---|---|---:|---|
| [GNAP](https://github.com/farol-team/gnap) | Agents, tasks, runs, and messages | No | Application layer |
| [Barony](https://github.com/vggg/barony) | Persona capabilities, ledgers, handoffs, guards, and audit | No | Decision ledgers |
| Multi-Agent Forum | Independent evidence, imported work receipts, explicit human Resolution and Action | No | Core protocol boundary |

Multi-Agent Forum does not claim to be the first Git-native multi-agent protocol. Its narrower goal is to make evidence, synchronization, adoption, and human action visibly different states.

More detail: [comparison.md](docs/comparison.md).

## Install from source

```bash
git clone https://github.com/MarshalLYTK/multi-agent-forum.git
cd multi-agent-forum
npm ci
npm run check
npm run build
npm link
```

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run privacy:check
npm run example:check
npm run pack:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture.md](docs/architecture.md).

## Roadmap boundary

v0.1 is intentionally a local Git-native core. An Obsidian/Kanban adapter may be considered later, but it will remain optional and Git will remain the source of truth. A GitHub App will only be considered if real onboarding use shows that owner-reviewed PRs are insufficient.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
