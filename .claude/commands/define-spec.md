---
description: Create a feature spec file and branch from a short idea
argument-hint: Short feature description
allowed-tools: Read, Write, Glob, Bash(git switch:*), Bash(mkdir:*), Bash(git fetch:*), Bash(git pull:*)
---

# Draft a Feature Specification

You are helping to spin up a new feature spec for this application, from a short idea provided in the user input below. Always adhere to any rules or requirements set out in any CLAUDE.md files when responding.

User input: $ARGUMENTS

## High level behavior

Your job will be to turn the user input above into:

- A human friendly feature title in kebab-case (e.g. `create-new-form`)
- A detailed markdown spec file at `_design/<feature_slug>/spec.md`

Then save the spec file to disk and print a short summary of what you did.

## Step 1. Parse the arguments

From `$ARGUMENTS`, extract:

1. `feature_title`
    - A short, human readable title in Title Case.
    - Example: "Card Component for Dashboard Status".

2. `feature_slug`
    - A safe slug.
    - Rules:
        - Lowercase
        - Kebab-case
        - Only `a-z`, `0-9` and `-`
        - Replace spaces and punctuation with `-`
        - Collapse multiple `-` into one
        - Trim `-` from start and end
        - Maximum length 40 characters
    - Example: `card-component` or `card-component-dashboard`.

If you cannot infer a sensible `feature_title` and `feature_slug`, ask the user to clarify instead of guessing.

## Step 3. Draft the spec content

- Create a markdown spec document that Plan mode can use directly. Ensure the `_design/<feature_slug>/` directory exists (create it if missing), then save the spec at `_design/<feature_slug>/spec.md`. Use the exact structure defined in the spec template here: @\_design/template.md. Do not add technical implementation details such as code examples.
- Update @\_design/index.md (the spec table of contents) by appending a new row. Use `feature_slug` for `Title` column. The `Spec` column must link to the new spec file as `./<feature_slug>/spec.md` (clickable). Leave the `Plan` column empty. The `Summary` column must be very brief and concise.
- During defining the specification, ask who is applying the changes as the point of contact (PoC) responsible for the changes.

## Step 4. Final output to the user

After the file is saved, respond to the user with a short summary in this exact format:

```
Spec file: \_design/<feature_slug>/spec.md
Title: <feature_title>
```

Do not repeat the full spec in the chat output unless the user explicitly asks to see it. The main goal is to save the spec file and report where it lives and what branch name to use.
