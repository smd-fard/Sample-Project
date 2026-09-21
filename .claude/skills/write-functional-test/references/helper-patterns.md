# Functional-test helper patterns

Reference for `write-functional-test`. `BaseFunctionalTest` wires the app and resets in-memory state; your
test focuses on *exercising the endpoint* and *asserting the envelope*.

## Where things live

- **Base class:** `test/functional/BaseFunctionalTest.ts` — boots the real app via `createApp()`, exposes
  `this.app`, and clears the in-memory repositories in `setup()`/`teardown()` via
  `Container.get(InMemory<Entity>Repository).clear()`. When you add a new repository, add a matching
  `clear()` call in `resetStores()`.
- **Tests:** `test/functional/<resource>/<Verb><Resource>.test.ts`.
- **Helpers (optional):** `test/functional/helpers/` — small static-method classes for repeated state setup.

## Asserting the envelope (no ValidatorHelper)

Every response is `{ message: string, data: T | null, errors: { field, message }[] }`. Assert directly:

```ts
// success
expect(response.status).toBe(201);
expect(response.body.message).toBe('Item created');
expect(response.body.errors).toEqual([]);
const data = response.body.data as ItemResponse;
expect(data.itemId).toBeDefined();

// error
expect(response.status).toBe(422);            // 422 validation, 409 conflict, 404 not-found, 400 bad-request
expect(response.body.data).toBeNull();
expect(response.body.errors[0].field).toBe('name');
```

Status codes map to the `AppError` subclasses: `ValidationError` 422, `ConflictError` 409, `NotFoundError`
404, `BadRequestError` 400, anything unhandled 500.

## Creating state

There is no database — create prerequisite state by calling the endpoints themselves:

```ts
const created = await request(this.app).post('/api/items').send({ name: 'Seed' });
const itemId = (created.body.data as ItemResponse).itemId;
const found = await request(this.app).get(`/api/items/${itemId}`);
```

## Helper class shape (when setup repeats 3+ times)

```ts
import request from 'supertest';
import type { Application } from 'express';
import { CreateItemRequestBuilder } from '../../../src/dtos/item/requests/CreateItemRequest';
import type { ItemResponse } from '../../../src/dtos/item/responses/ItemResponse';

export class ItemHelper {
  static async create(app: Application, name = 'Default'): Promise<ItemResponse> {
    const body = new CreateItemRequestBuilder().setName(name).build();
    const response = await request(app).post('/api/items').send(body);
    if (response.status !== 201) {
      throw new Error(`ItemHelper.create failed: ${JSON.stringify(response.body)}`);
    }
    return response.body.data as ItemResponse;
  }
}
```

Add a helper when the same setup appears in 3+ tests or is more than two lines; otherwise inline it.

## State isolation

`BaseFunctionalTest.setup()` clears the stores before each suite. Within a single suite, tests share the
store and run in order — earlier `POST`s are visible to later tests (used deliberately in the duplicate-name
and find-after-create scenarios). If you need a clean store mid-suite, call `t['resetStores']()` in an inner
`beforeEach`.
