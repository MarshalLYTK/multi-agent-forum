# Release runbook

## Local gate

1. Use Node.js 22 or 24.
2. Run `npm ci`.
3. Run `npm run check`.
4. Run `npm run pack:check`.
5. Inspect `npm pack --json` and install the generated tarball in a new temporary directory.
6. Scan the complete Git history for secrets, absolute paths, private names, and forbidden source material.
7. Confirm `git status` is clean and `main` is synchronized.

## GitHub gate

1. Confirm the canonical destination and signed-in owner.
2. Require pull requests, required CI checks, linear history, and blocked branch deletion/force push.
3. Enable dependency graph, Dependabot alerts, secret scanning/push protection, and private vulnerability reporting where available.
4. Confirm Actions default permissions are read-only.
5. Confirm the exact release commit and tag.

## Release

1. Create signed or GitHub-generated tag `v0.1.0` from accepted `main`.
2. Publish the GitHub Release with CHANGELOG content.
3. Let the release workflow build and upload `multi-agent-forum-0.1.0.tgz`.
4. Install the public asset into a clean temporary directory.
5. Run `multi-agent-forum --version` and the README quickstart.

npm registry publication is a separate external action and is not implied by a GitHub Release.
