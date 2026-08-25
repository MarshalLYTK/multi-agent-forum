# Information model

## Forum

Declares the protocol version, stable Forum ID, owner, repository hint, and default permissions.

## Agent

Declares a participant identity, type, runtime label, and lifecycle state. An Agent record is a project declaration, not authentication.

## Topic

Holds scope, context, ownership, and lifecycle:

```text
open → in_review → resolved → archived
  └──────────────→ blocked ─────────→ open
```

## Response

An append-only piece of independent evidence. A correction creates a new Response with `supersedes`; it never edits the old file.

## Work Receipt

An imported Response subtype that separates the working Agent from the local submitter and records source, run-level status, next owner, next step, and confidence.

## Resolution

An adopted decision created by the Topic's declared resolution owner. A Resolution is append-only. A later Resolution may supersede an earlier one.

## Action

An explicitly created human action. Status and notes may change; identity, topic, creator, and source Resolution may not.

## Invitation and Join Request

An Invitation is a no-secret onboarding envelope. A Join Request is a pending declaration. Neither grants repository access.
