---
name: define-model
description: Create a plain entity class at src/models/<Entity>.ts (the in-memory record shape, no ORM) following the project's model conventions. Use when the user asks to "add a model", "create the <X> entity", "define the <X> record", or introduces a new resource that needs a stored shape. Args expected -- "<Entity> [field:type ...]", e.g. "Order customerId:string total:number status:OrderStatus".
---

# define-model

Adds one file: `src/models/<Entity>.ts` — a plain TypeScript class describing the entity as the
repository stores it. No decorators, no ORM, no validation (validation lives in DTOs/contexts).

## Args

`<Entity> [field:type ...]` — `<Entity>` is PascalCase singular (e.g. `Order`). Optional `field:type`
pairs. Always include an id field `<entity>Id: string` and `createdAt: string`.

## Hard rules

- **Plain class** — no decorators, no base class, no methods. Data container only. Follow `references/model.ts.tmpl`.
- Required fields end with `!` (`name!: string`); optional/server-set-later fields use `?`.
- Identity field is `<entity>Id!: string` (camelCase entity name + `Id`), e.g. `orderId`.
- `createdAt!: string` (ISO string — the repository sets it).
- Status/kind fields reference an enum from `src/enums/` (run **define-enum** first if missing).
- Timestamps and ids are strings (no `Date`, no ObjectId — this is an in-memory store).
- One-line `/** ... */` doc on the class.

## Steps

1. Follow `references/model.ts.tmpl`.
2. Ensure any referenced enum exists in `src/enums/` (else run **define-enum** first).
3. Write `src/models/<Entity>.ts`.
4. `npm run build`.
5. Report.

## Report

```
Model:  src/models/<Entity>.ts
Fields: <list>
Next:   define-repository <Entity>, then define-dto <resource> <verb>.
```

## Reference

@references/model.ts.tmpl
