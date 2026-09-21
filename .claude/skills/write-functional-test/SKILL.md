---
name: write-functional-test
description: Add a BaseFunctionalTest subclass for an existing controller endpoint using Supertest against the real createApp() server. Use when the user asks to "add a functional test", "test the <verb> <resource> endpoint", "backfill integration coverage", or when an endpoint exists but lacks end-to-end coverage. Args expected -- "<Controller>.<method>", e.g. "ItemController.create".
---

# write-functional-test

Adds one file: `test/functional/<resource>/<Verb><Resource>.test.ts`. It subclasses
`test/functional/BaseFunctionalTest`, which boots the real app via `createApp()` and resets the in-memory
stores, and exercises the endpoint with Supertest against `this.app`.

## Args

`<Controller>.<method>` (e.g. `ItemController.create`). The method must already be implemented — this skill
is for **backfill**. (For a brand-new endpoint, build it with the `define-*` skills first.)

## Hard rules

`references/functional-test.ts.tmpl` is the canonical skeleton — match its shape:

- One test file per endpoint; mirror the controller surface 1:1.
- Subclass `BaseFunctionalTest` (`test/functional/BaseFunctionalTest.ts`) — it already wires the app and
  resets the in-memory stores in `setup()`/`teardown()`. Don't build the app yourself.
- **Named-method-on-class** pattern (`public async testSuccess()`), not lambdas inside `test()`. Reach the
  app via `this.app`. Name the instance `t` (`const t = new <Verb><Resource>Test()`) and bridge every method
  through `describe`/`test` at the bottom.
- Rename the placeholder scenarios (`testSuccess`, `testValidationFailure`, ...) to the real cases the
  endpoint needs; keep the `test` prefix.
- In the happy-path method, keep the numbered step comments: `// 1. setup state`, `// 2. build request`,
  `// 3. HTTP`, `// 4. envelope`, `// 5. shape`.
- **Assert on the `{ message, data, errors }` envelope directly** with `expect` (there is no ValidatorHelper):
  - success: `response.status`, `response.body.message`, `response.body.errors` is `[]`, then drill into `response.body.data`.
  - error: `response.status` (422 validation / 409 conflict / 404 not-found), and `response.body.errors[0].field`.
- Build requests with the DTO builder (`new CreateItemRequestBuilder().setName('x').build()`); for an
  intentionally-invalid body (validation-failure cases) send a raw partial object instead.
- No DB, no `mongodb-memory-server`, no `nock`. State is created by calling the endpoints (e.g. POST then GET).
- Import order: `supertest` → `vitest` → DTO types (`../../../src/...`) → `BaseFunctionalTest` last.

## Steps

1. Read `src/controllers/<Controller>.ts` for the route, verb, request DTO, response DTO; read the service
   method for the branches to cover (conflict, not-found, ...).
2. Read `references/helper-patterns.md`. If the same multi-line state setup repeats 3+ times, add a small
   static helper under `test/functional/helpers/`; otherwise inline.
3. Copy `references/functional-test.ts.tmpl` → `test/functional/<resource>/<Verb><Resource>.test.ts`. Fill in
   route, body, and assertions; drop scenarios that don't apply.
4. Run `npm test -- <Verb><Resource>` (or `npm test`).
5. If a test fails, read the assertion. The goal is to document real behavior — if it surprises you, flag it
   to the user rather than bending the test or source.
6. Report.

## Report

```
Endpoint: <HTTP_VERB> /api/<resource-plural>[/:id]
Test:     test/functional/<resource>/<Verb><Resource>.test.ts
Cases:    <count>
Surprise: <behavior that didn't match expectations — empty if none>
```

## References

@references/functional-test.ts.tmpl
@references/helper-patterns.md
