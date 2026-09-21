# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A single TypeScript **Express 5** web server with a clean **layered architecture**. It uses
`routing-controllers` (decorator routing) + `typedi` (dependency injection) + `zod` (validation).
There is **no database** — repositories own their data in an in-memory hashmap. There is **no
separate SDK package and no shared framework**; everything lives in this one `src/` tree and leans on
a small local `src/common/` for errors and the response envelope.

## Layer flow

```
HTTP request
  → Controller   @JsonController, validates the body with validateDto(body, Schema)
  → Context      a plain builder-constructed call object (validated request + traceId/ids)
  → Service      @Service orchestration + business rules; throws AppError subclasses
  → Repository   in-memory hashmap (interface + InMemory* impl)
  → Model        a plain class (no ORM)
Controller maps the model → response DTO, wrapped by ApiResult.data(...).
Errors thrown anywhere are mapped to HTTP by ErrorHandlerMiddleware.
```

## Directory layout

```
src/
  index.ts            createApp() factory (controllers + middlewares) + listen
  common/             MINIMAL shared helpers — not a framework
    errors/           AppError + NotFoundError(404) / ConflictError(409) / ValidationError(422) / BadRequestError(400)
    http/             ApiResult (envelope) + validateDto (zod → ValidationError)
    middlewares/      ErrorHandlerMiddleware (maps AppError → HTTP)
  enums/              string enums (e.g. ItemStatus)
  models/             plain entity classes (e.g. Item)
  dtos/<resource>/    requests/ + responses/ zod schemas (+ inferred types)
  contexts/<resource>/ <Verb><Resource>Context + builder
  repositories/       <Entity>Repository interface (interfaces/) + InMemory<Entity>Repository
  services/           <Resource>Service (+ interfaces/I<Resource>Service)
  controllers/        <Resource>Controller (+ interfaces/I<Resource>Controller)
test/functional/      BaseFunctionalTest + <Verb><Resource>.test.ts (Supertest)
```

## Canonical pattern

There is no example resource yet — the layer directories under `src/` are empty placeholders. The
canonical shape for each layer lives in the skill templates at `.claude/skills/define-*/references/*.tmpl`;
generate new code with the skills rather than hand-writing it. Generate a resource in dependency order
(see "Code generation" below).

## Conventions

- **DTOs are Zod schema + inferred type + a fluent builder** — `export const <Verb><Resource>RequestSchema`,
  `export type <Verb><Resource>Request = z.infer<typeof ...>`, and a `<Verb><Resource>RequestBuilder` extending
  `BaseBuilder` (`src/common/dto/BaseBuilder.ts`, validates on `build()`). Use the builder to construct DTOs by
  hand (tests/fixtures); incoming HTTP bodies are validated via `validateDto`, not built.
- **Contexts use a small builder** — `new <Verb><Resource>ContextBuilder().setTraceId(...).set...().build()`.
- **Server-owned fields** (`status`, `<entity>Id`, `createdAt`) are never accepted on requests — the
  service/repository set them.
- **DI everywhere** — `@Service()` on controllers/services/repositories; constructor injection. The
  container is wired in `createApp()` via `useContainer(Container)`.
- **Validation** — only `validateDto(body, Schema)` in controllers; the framework never validates.
- **Errors** — throw `AppError` subclasses (`NotFoundError`, `ConflictError`, `ValidationError`,
  `BadRequestError`); never hand-format an HTTP error. `ErrorHandlerMiddleware` renders them.
- **Responses** — always the `{ message, data, errors }` envelope via `ApiResult.data(...)`.
- **Repositories** return entities or `null`, never throw business errors; clone on read/write; exclude
  soft-deleted (`status === DELETED`) from default queries; expose `clear()` for tests.

## Commands

```bash
npm run build      # tsc (typecheck + emit to dist/)
npm run dev        # ts-node-dev watch
npm start          # node dist/index.js
npm test           # vitest run (functional tests against createApp())
npm run test:watch # vitest watch
```

## Code generation

This repo ships `.claude/skills` that generate each layer to these conventions. Order:
**define-enum / define-model → define-dto → define-context → define-repository → define-service →
define-controller**, then **write-unit-test / write-functional-test**. `implement-plan` orchestrates a
`_design/<slug>/plan.md` across these skills.
