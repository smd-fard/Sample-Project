---
name: define-enum
description: Create a TypeScript string enum at src/enums/<Name>.ts following the project's enum conventions. Use when the user asks to "add an enum", "define a status/type enum", "I need a <X>Status", or whenever a fixed set of named string constants is needed (lifecycle states, kinds, roles). Args expected -- "<Name> [VALUE1 VALUE2 ...]", e.g. "OrderStatus PENDING PAID SHIPPED".
---

# define-enum

Adds one file: `src/enums/<Name>.ts` — a string enum where each value equals its key. Enums are the
simplest layer; other layers (models, DTOs) import them.

## Args

`<Name> [VALUE1 VALUE2 ...]` — `<Name>` is PascalCase (e.g. `OrderStatus`). Optional space-separated
UPPER_SNAKE values; if omitted, infer sensible members from the request and leave a `// TODO` to confirm.

## Hard rules

- **String enums only** — value must equal key: `ACTIVE = 'ACTIVE'`. No numeric enums.
- Members are `UPPER_SNAKE_CASE`.
- One short `//` comment per member when the meaning isn't obvious.
- File name matches the enum name exactly: `OrderStatus` → `src/enums/OrderStatus.ts`.
- A one-line `/** ... */` doc on the enum itself.
- Do **not** add a barrel/index — layers import the enum directly by path.

## Steps

1. Follow `references/enum.ts.tmpl`.
2. Write `src/enums/<Name>.ts` with the members.
3. `npm run build` to typecheck.
4. Report.

## Report

```
Enum:   src/enums/<Name>.ts
Values: <list>
Next:   reference it from a model (define-model) or a DTO (define-dto).
```

## Reference

@references/enum.ts.tmpl
