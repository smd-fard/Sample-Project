---
name: define-controller
description: Create or extend a controller at src/controllers/<Resource>Controller.ts with one endpoint per route, plus its interface and registration in createApp() — the HTTP layer. Use when the user asks to "add an endpoint", "expose <verb> <resource> over HTTP", "wire the route for <verb> <resource>", or after implementing the service method. Args expected -- "<resource> <verb>", e.g. "order create".
---

# define-controller

Creates (or extends) `src/controllers/<Resource>Controller.ts` and its interface
`src/controllers/interfaces/I<Resource>Controller.ts`, and registers the controller in
`src/index.ts`'s `createApp()` `controllers: [...]` array (first endpoint only).

The endpoint validates the body, builds a context, delegates to the service, maps the returned model to
a response DTO, and wraps it in the `{ message, data, errors }` envelope via `ApiResult.data`.

## Args

`<resource> <verb>` — `<resource>` lower-camel singular; controller class is `<Resource>Controller`.
`${Verb}${Resource}` = PascalCase verb + resource.

## Hard rules

- Follow `references/controller-class.ts.tmpl` and `references/controller-method.ts.tmpl`.
- Class is `@Service()` **and** `@JsonController('/<resource-plural>')`. The global `routePrefix: '/api'`
  in `createApp()` means the full path is `/api/<resource-plural>/...`.
- One method per endpoint, decorated with the HTTP verb (`@Post()`, `@Get('/:<resource>Id')`,
  `@Patch('/:<resource>Id')`, `@Delete('/:<resource>Id')`). Use `@HttpCode(201)` on create.
- **Validate the body** with `validateDto(body, ${Verb}${Resource}RequestSchema)` — never trust `@Body()` directly.
- Build the context via its builder (`new ${Verb}${Resource}ContextBuilder().setTraceId(randomUUID())...build()`),
  delegate to the injected service, then map model → response DTO and return `ApiResult.data(message, dto)`.
- Return type is `Promise<ApiEnvelope<${Resource}Response>>`. Add the signature to `I<Resource>Controller`.
- Do **not** try/catch — thrown `AppError`s are handled by `ErrorHandlerMiddleware`.
- If the controller file already exists, **append** the method (and interface entry); don't rewrite the class
  and don't re-register it in `createApp()`.
- New controller only: add it to the `controllers` array in `src/index.ts` and import it there.

## Steps

1. Confirm the service method (`define-service`) and request/response DTOs exist.
2. If `src/controllers/<Resource>Controller.ts` is missing, copy `references/controller-class.ts.tmpl` and register the class in `createApp()` (`src/index.ts`); else open it.
3. Add the endpoint from `references/controller-method.ts.tmpl`; add its signature to `interfaces/I<Resource>Controller.ts`.
4. `npm run build`.
5. Cover it end-to-end with **write-functional-test** `<Resource>Controller.<verb>`.
6. Report.

## Report

```
Controller: src/controllers/<Resource>Controller.ts (<created|extended>)
Interface:  src/controllers/interfaces/I<Resource>Controller.ts
Route:      <HTTP_VERB> /api/<resource-plural>[/:id]
Registered: createApp() controllers [] (<yes|already present>)
Next:       write-functional-test <Resource>Controller.<verb>.
```

## References

@references/controller-class.ts.tmpl
@references/controller-method.ts.tmpl
