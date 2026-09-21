---
name: define-context
description: Create a context class + fluent builder at src/contexts/<resource>/<Verb><Resource>Context.ts — the validated call object passed from controller to service. Use when the user asks to "add a context", "wire the call object for <verb> <resource>", or right after defining a DTO and before implementing the service. Args expected -- "<resource> <verb>", e.g. "order create".
---

# define-context

Adds one file: `src/contexts/<resource>/<Verb><Resource>Context.ts` — a small class holding the
validated request plus request metadata (always `traceId`; path-param verbs also carry the id), and a
fluent builder. The controller builds it; the service consumes it.

## Args

`<resource> <verb>` — `<resource>` lower-camel singular, `<verb>` camelCase.
`${Verb}${Resource}` = PascalCase verb + resource.

## Hard rules

- Follow `references/context.ts.tmpl` — it shows both the body-verb and id-only variants.
- Two exports: the context class `${Verb}${Resource}Context` and its builder `${Verb}${Resource}ContextBuilder`.
- The context always has `traceId!: string`.
- **Body verbs** (create/update): context has `request!: ${Verb}${Resource}Request` (import the request DTO);
  builder exposes `setTraceId` + `setRequest`.
- **Path-param verbs** (find/delete by id): context has `<resource>Id!: string`; builder exposes
  `setTraceId` + `set<Resource>Id`. (Update-by-id carries both `request` and the id.)
- Builder methods return `this`; `build()` returns the context. No validation here — the controller
  already validated the request with `validateDto`.
- No barrel/index — import by path.

## Steps

1. Pick the shape from the verb (body / id / both).
2. Copy `references/context.ts.tmpl` → `src/contexts/<resource>/<Verb><Resource>Context.ts`; fill fields/setters.
3. `npm run build`.
4. Report.

## Report

```
Context: src/contexts/<resource>/<Verb><Resource>Context.ts
Carries: <request | <resource>Id | both> + traceId
Next:    define-service <resource> <verb>.
```

## Reference

@references/context.ts.tmpl
