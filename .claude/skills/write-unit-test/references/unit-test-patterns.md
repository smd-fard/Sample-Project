# Unit-test patterns

Reference for `write-unit-test`. Follow these unless existing sibling tests diverge — then match local style.

## File header

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ItemService } from './ItemService';
import { ConflictError, NotFoundError } from '../common/errors';
```

## Service-under-test scaffold

Services are constructor-injected — build a stub for each dependency and pass it directly. No typedi.

```ts
describe('ItemService', () => {
  let service: ItemService;
  let repo: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = { create: vi.fn(), findById: vi.fn(), findByName: vi.fn() };
    service = new ItemService(repo as any);
  });

  describe('create', () => {
    it('persists a new item when the name is free', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockImplementation(async (item) => ({ ...item, itemId: 'id-1', createdAt: 'now' }));

      const context = { traceId: 't', request: { name: 'Widget' } } as any;
      const result = await service.create(context);

      expect(repo.findByName).toHaveBeenCalledWith('Widget');
      expect(repo.create).toHaveBeenCalled();
      expect(result.itemId).toBe('id-1');
      expect(result.status).toBe('ACTIVE');
    });

    it('throws ConflictError on duplicate name', async () => {
      repo.findByName.mockResolvedValue({ itemId: 'x', name: 'Widget' });
      const context = { traceId: 't', request: { name: 'Widget' } } as any;
      await expect(service.create(context)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('findById', () => {
    it('throws NotFoundError when missing', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById({ traceId: 't', itemId: 'nope' } as any)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
```

## Pure-function scaffold

```ts
describe('validateDto', () => {
  it('throws ValidationError with one entry per bad field', () => {
    expect(() => validateDto({}, SomeSchema)).toThrow(ValidationError);
  });
});
```

## Mock policy

- Inject `vi.fn()` stubs through the constructor — that's the whole point of the DI layer.
- Build only the methods the test exercises; cast with `as any` to satisfy the interface.
- No `vi.mock('module')` for singletons — everything this project injects is constructor-injected.

## Coverage focus

Test what matters: each service branch (not-found, conflict, success), error mapping, and that the repo
was called with the expected args. Skip getters, constructor assignment, plain re-exports, and declarative
files (Zod schemas, enums, models).

## Building DTOs

When a test needs a request/response DTO, use its builder rather than a raw object literal — `build()`
validates against the schema, so a malformed fixture fails loudly:

```ts
const request = new CreateItemRequestBuilder().setName('Widget').build();
```

## Async

Always `await expect(...).rejects...` — never return the promise.

```ts
await expect(service.create(ctx)).rejects.toBeInstanceOf(ConflictError); // good
```
