---
description: Generate a detailed implementation plan from the feature spec
argument-hint: (no arguments needed — reads the latest spec from _design/index.md)
allowed-tools: Read, Write, Glob, Grep
---

# Generate Implementation Plan

Ultrathink through the latest feature spec and produce a thorough, technically detailed implementation plan. Always adhere to any rules or requirements in any CLAUDE.md files.

## Step 1. Locate the feature spec

Read `_design/index.md` (the spec table of contents) and take the **last row** of the table — that is the latest spec.

- If the table has no rows, abort: "No specs found in `_design/index.md`. Create a spec first with /define-spec."
- Derive `feature_slug` from that row's `Title` column (it stores the slug). Confirm it against the row's `Spec` link, which points to `./<feature_slug>/spec.md`.
- Verify `_design/<feature_slug>/spec.md` exists. If it does not, list all `_design/*/spec.md` paths and ask the user which feature to plan.
- If `_design/<feature_slug>/plan.md` already exists, ask:
    > `_design/<feature_slug>/plan.md` already exists. Overwrite it?
    > Wait for confirmation. Abort if no.

## Step 2. Gather context — read only what is relevant

Read in this order:

1. `_design/<feature_slug>/spec.md` — the authoritative source of what to build.
2. The root `CLAUDE.md` — architecture and conventions.
3. The per-layer skill templates under `.claude/skills/define-*/references/*.tmpl` — the canonical pattern every new layer follows. Skim the ones relevant to the spec.
4. The `src/common/` helpers the feature will reuse (`AppError` subclasses, `ApiResult`, `validateDto`).
5. `_design/index.md` — to understand what has already shipped.

## Step 3. Ultrathink and draft the plan

Think deeply — reason step by step — before writing a single line of the plan. Cover:

**Build order**: which layers must exist before others depend on them. In this single web server the canonical order is:

- Enums + Models — `src/enums/`, `src/models/`
- DTOs (request/response Zod schemas) — `src/dtos/<resource>/`
- Contexts (validated call objects) — `src/contexts/<resource>/`
- Repositories (interface + in-memory impl) — `src/repositories/`
- Services (orchestration + business rules) — `src/services/`
- Controllers (HTTP endpoints, registered in `createApp()`) — `src/controllers/`

**File-by-file detail**: for every significant file to create or modify — its path, its purpose, its key members (exported classes, methods, fields, enums, schemas), and any non-obvious decision. Err on the side of more detail.

**Reuse**: map every requirement to an existing helper in `src/common/` (the `AppError` subclasses, `ApiResult`, `validateDto`, `BaseBuilder`, `ErrorHandlerMiddleware`). Never invent an abstraction if an existing one fits. List these explicitly in the Reuse map section.

**Test coverage**: for each layer, name the Vitest test files and what each must cover (unit tests siblings for service branches — not-found/conflict/success; functional tests under `test/functional/<resource>/` via `BaseFunctionalTest` + Supertest for happy-path + 422/409/404).

**Risks**: surface integration seams, spec ambiguities, or execution gotchas that could cause surprises. Be specific — name files or interactions.

## Step 4. Write `_design/<feature_slug>/plan.md`

Use this exact structure. All sections are required. No code snippets — prose and file paths only.

```
# Implementation Plan — <Title>

> Source spec: `./spec.md` (feature `<feature_slug>`, PoC: <PoC extracted from spec>).

## Context

[2–4 sentences: what problem this solves, how it fits the platform. Drawn from the spec Summary.]

## Approach

[3–6 sentences: build-order rationale, which existing service to mirror, key architectural decisions, what is explicitly deferred.]

## Implementation steps

### 1. <Layer name, e.g. "Enums + Model for `<resource>`">

[Reference pattern if applicable, e.g. "Follow the define-* skill templates exactly."]

Create:

- `path/to/file.ts` — purpose and key members (exported types, schemas, methods, enum values).
- ...

### 2. <Next layer>

...

## Critical files

**To create**

- `path/` (full tree as described)

**To modify**

- `path/to/file` (<what changes and why, e.g. "append workspace entry", "add enum value">)

## Reuse map

[Bulleted list: ClassName/function — package/path. List every framework primitive this feature consumes from shared, shared-sdk, and clients.]

## Verification

[Numbered checklist of commands or checks in dependency order: install, build, typecheck, lint, test, smoke-test (health endpoint, happy-path curl, rejection cases).]

## Open items the spec already calls out (no plan change needed)

- [Items explicitly deferred in the spec. Copy them faithfully; do not add new scope.]

## Risks / things to watch during execution

- [Specific risks: race conditions, missing SDK methods, spec ambiguities, transition-graph edge cases, etc. Name the files or interactions involved.]
```

## Step 5. Final output

After saving the file, update @\_design/index.md. The `Plan` column must link to the new plan file as `./<feature_slug>/plan.md` (clickable). Finally, respond with exactly:

```
Plan file: _design/<feature_slug>/plan.md
Title: <feature_title>
Sections: Context | Approach | <N> implementation steps | Critical files | Reuse map | Verification | Open items | Risks
```

Do not repeat the plan contents in chat.
