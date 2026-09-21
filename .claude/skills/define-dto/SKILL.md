---
name: define-dto
description: Add a request and/or response DTO (plain Zod schema + inferred type) under src/dtos/<resource>/ following the project's DTO conventions. Use when the user asks to "add a DTO", "define the request/response for <verb> <resource>", "add the create/update body", or describes the shape of an endpoint's input or output. Args expected -- "<resource> <verb> [request|response|both]", e.g. "order create both".
---

# define-dto

Adds request and/or response schema files under `src/dtos/<resource>/`:

- `src/dtos/<resource>/requests/<Verb><Resource>Request.ts`
- `src/dtos/<resource>/responses/<Verb><Resource>Response.ts`

Each DTO is a Zod schema constant, an inferred type, and a fluent **builder** (extends the local
`BaseBuilder`, which validates on `build()`). The response schema is the shape the controller maps the
model into; builders are mainly for constructing DTOs by hand in tests/fixtures.

## Args

`<resource> <verb> [request|response|both]` — `<resource>` lower-camel singular (e.g. `order`),
`<verb>` camelCase (`create`, `update`, `find`, `search`). Third arg defaults to `both`.
`${Verb}${Resource}` = PascalCase verb + PascalCase resource (e.g. `CreateOrder`).

## Hard rules

- **Three exports per file**: `export const ${Verb}${Resource}RequestSchema = z.object({...})`, then
  `export type ${Verb}${Resource}Request = z.infer<typeof ${Verb}${Resource}RequestSchema>`, then
  `export class ${Verb}${Resource}RequestBuilder extends BaseBuilder<typeof ${Verb}${Resource}RequestSchema>`
  with one `setX()` per field (`this.data.x = x; return this;`) and a `super(${Verb}${Resource}RequestSchema)`
  constructor. Same triple for Response.
- Import `BaseBuilder` from `../../../common/dto/BaseBuilder` (depth is 3 from `src/dtos/<resource>/{requests,responses}/`).
- Follow `references/request-dto.ts.tmpl` and `references/response-dto.ts.tmpl`.
- **Server-owned fields are excluded from requests** — never accept `<entity>Id`, `status`, `createdAt`
  on a create/update request; they belong on the response only.
- Response schemas include the id and `createdAt`. Enum fields use `z.enum(SomeEnum)` (import from `src/enums/`).
- Add real constraints (`.min`, `.max`, `.email()`, `.optional()`) — don't leave bare `z.string()` where a bound is obvious.
- File names and export names use `${Verb}${Resource}`; a single shared response (e.g. `ItemResponse`)
  may drop the verb when every verb returns the same shape — follow the existing resource's choice.
- No barrel/index files — import schemas by path.

## Steps

1. Decide request/response/both from the third arg.
2. For a request: copy `references/request-dto.ts.tmpl` → `src/dtos/<resource>/requests/<Verb><Resource>Request.ts`; fill fields with Zod + constraints (omit server-owned fields) and add one builder setter per field.
3. For a response: copy `references/response-dto.ts.tmpl` → `src/dtos/<resource>/responses/<Verb><Resource>Response.ts`; include id, fields, enum status, `createdAt`, and a builder setter per field. If the resource already has a shared `<Resource>Response`, reuse it instead of creating a verb-specific one.
4. `npm run build`.
5. Report.

## Report

```
Request:  src/dtos/<resource>/requests/<Verb><Resource>Request.ts   (schema + type + builder, or n/a)
Response: src/dtos/<resource>/responses/<Verb><Resource>Response.ts  (schema + type + builder, or n/a)
Next:     define-context <resource> <verb>.
```

## References

@references/request-dto.ts.tmpl
@references/response-dto.ts.tmpl
