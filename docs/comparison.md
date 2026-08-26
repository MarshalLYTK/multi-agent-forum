# Comparison with adjacent projects

This comparison describes public project scopes; it is not a quality ranking.

## GNAP

[GNAP](https://github.com/farol-team/gnap) defines Git-native agents, tasks, runs, and messages. It is a compact coordination protocol and leaves broader governance to the application layer.

## Barony

[Barony](https://github.com/vggg/barony) provides runtime-neutral personas, capability declarations, findings and decision ledgers, handoffs, divergence status, worktrees, guards, audit, and runtime adapters.

## Multi-Agent Forum

Multi-Agent Forum deliberately covers less orchestration. Its core objects make these states distinct:

```text
independent evidence → human review → adopted resolution → explicit human action
```

The most specific feature is a model-neutral imported Work Receipt that preserves the working Agent, local submitter, and real source without granting the remote Agent Git access.

Choose GNAP when tasks/runs/messages are the primary coordination substrate. Choose Barony when persona capabilities, handoffs, ledgers, worktrees, and audit are the main need. Choose Multi-Agent Forum when the main risk is silently promoting agent output or completion claims into accepted project truth.
