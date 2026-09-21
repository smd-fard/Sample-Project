---
name: write-unit-test
description: Co-locate a Vitest unit test (*.test.ts) next to an existing TS source file using the project's mock conventions. Use when the user asks to "add a unit test for <file>", "backfill coverage on <X>", "test the service method I just wrote", or when tests are needed after the fact. Args expected -- "<path to .ts source>", e.g. "src/services/ItemService.ts".
---

# write-unit-test

Creates a `<File>.test.ts` sibling to an existing `.ts` source file, exercising its public surface with
Vitest + `vi.fn()` mocks. Skip declarative files (plain Zod schemas, enums, models, interfaces) — there's
nothing to assert.

## Args

Path to an existing `.ts` file, e.g. `src/services/ItemService.ts`.

## Hard rules

- **Framework:** Vitest only. Import from `vitest`: `describe`, `it`, `expect`, `vi`, `beforeEach`. No Jest, no Mocha.
- **Location:** sibling to the source — `ItemService.ts` → `ItemService.test.ts` in the same directory.
  (`vitest.config.ts` already includes `src/**/*.test.ts`.)
- **Tests run against `src` via esbuild** — no build step needed (unlike the functional tests, there's no `dist` aliasing). Just `npm test`.
- **Mocks:** services take constructor-injected dependencies — pass `vi.fn()`-based stubs directly
  (`new ItemService(repoStub as any)`). Don't touch the typedi container in unit tests.
- **Errors:** the service throws `AppError` subclasses (`NotFoundError`, `ConflictError`, ...). Assert with
  `await expect(...).rejects.toBeInstanceOf(ConflictError)` (import the error from `src/common/errors`).
- Skip purely declarative files. If asked to test one, say so and point to **write-functional-test** for endpoint coverage.

## Steps

1. Read the source. Inventory exported classes/functions and their public methods.
2. For each method list: input (context) shape, constructor deps to mock, branches (not-found, conflict, success).
3. If declarative, stop and tell the user there's nothing meaningful to unit-test.
4. Read `references/unit-test-patterns.md`.
5. Write `<source-dir>/<File>.test.ts`. Match the style of any existing sibling tests.
6. Run `npm test -- <File>` (or `npm test`).
7. If red because the source has a real bug, surface it — don't silently change the source.
8. Report.

## Report

```
Source: <input path>
Test:   <source-dir>/<File>.test.ts
Cases:  <count> (branches: <list>)
```

## Reference

@references/unit-test-patterns.md
