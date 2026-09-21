---
name: define-repository
description: Create an in-memory repository (interface + InMemory implementation) for an entity at src/repositories/ following the project's data-access conventions. Use when the user asks to "add a repository", "create the data access for <X>", "store <X> records", or after defining a model. Args expected -- "<Entity>", e.g. "Order".
---

# define-repository

Adds two files:

- `src/repositories/interfaces/<Entity>Repository.ts` — the data-access contract.
- `src/repositories/InMemory<Entity>Repository.ts` — a `@Service()` hashmap-backed implementation.

The service layer depends on the **concrete** `InMemory<Entity>Repository` for injection but should only
use methods declared on the interface, so the store can be swapped for a DB later.

## Args

`<Entity>` — PascalCase singular matching an existing `src/models/<Entity>.ts` (run **define-model** first).

## Hard rules

- Follow `references/repository-interface.ts.tmpl` and `references/in-memory-repository.ts.tmpl`.
- Interface methods return entities or `null` / arrays — **never throw business errors** (that's the service's job).
- Implementation is `@Service()` (typedi singleton — one shared `Map` across requests).
- `create()` assigns `<entity>Id = randomUUID()` and `createdAt = new Date().toISOString()`.
- **Clone on read and write** (`Object.assign(new <Entity>(), item)`) so callers can't mutate stored records.
- Exclude soft-deleted records (`status === <Enum>.DELETED`) from `findAll` / lookup-by-field queries.
- Expose a `clear(): void` method for test isolation (used by `BaseFunctionalTest`).
- `randomUUID` comes from `crypto`.

## Steps

1. Confirm `src/models/<Entity>.ts` exists.
2. Copy `references/repository-interface.ts.tmpl` → `src/repositories/interfaces/<Entity>Repository.ts`; declare the methods the services need.
3. Copy `references/in-memory-repository.ts.tmpl` → `src/repositories/InMemory<Entity>Repository.ts`; implement each method + `clear()`.
4. If `BaseFunctionalTest.resetStores()` should reset this store too, add `Container.get(InMemory<Entity>Repository).clear()` there.
5. `npm run build`.
6. Report.

## Report

```
Interface: src/repositories/interfaces/<Entity>Repository.ts
Impl:      src/repositories/InMemory<Entity>Repository.ts
Methods:   <list>
Next:      define-service <resource> <verb>. Remember to reset the store in BaseFunctionalTest.
```

## References

@references/repository-interface.ts.tmpl
@references/in-memory-repository.ts.tmpl
