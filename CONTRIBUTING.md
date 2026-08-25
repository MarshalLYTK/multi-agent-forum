# Contributing

Thank you for helping improve Agent Forum.

## Before opening a pull request

1. Open or reference an issue for material behavior changes.
2. Keep the v0.1 boundary: local files and Git, no server, telemetry, model runtime, credential broker, or required UI.
3. Add tests for success and failure behavior.
4. Update documentation in the same pull request.
5. Run:

```bash
npm ci
npm run check
npm run pack:check
```

## Protocol changes

Schema or lifecycle changes need an ADR-style explanation covering compatibility, migration, security impact, and why the change belongs in the core.

## Commits and licensing

Use focused commits and do not include generated caches, credentials, private data, or real user Forum content. By submitting a contribution, you agree that it is licensed under Apache-2.0, the project's license.

## Reviews

The maintainer may request smaller scope, negative tests, clearer enforcement labels, or compatibility work before merge. A prompt rule must not be described as enforced unless a mechanism blocks the operation.
