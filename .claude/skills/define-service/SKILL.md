---
name: define-service
description: Create or extend a service class at src/services/<Resource>Service.ts with one method per endpoint, plus its interface — the orchestration + business-rule layer. Use when the user asks to "add a service method", "implement the business logic for <verb> <resource>", "wire <verb> on the service", or after defining a context. Args expected -- "<resource> <verb>", e.g. "order create".
---

# define-service

Creates (or extends) `src/services/<Resource>Service.ts` and its interface
`src/services/interfaces/I<Resource>Service.ts`. The method takes a context, applies business rules,
delegates persistence to the repository, and returns a **model** (not a DTO — the controller maps it).

## Args

`<resource> <verb>` — `<resource>` lower-camel singular; the service class is `<Resource>Service`
(PascalCase). `${Verb}${Resource}` = PascalCase verb + resource.

## Hard rules

- Follow `references/service-class.ts.tmpl` and `references/service-method.ts.tmpl`.
- Class is `@Service()`; repository injected via constructor (`constructor(@Inject() private readonly <resource>Repository: InMemory<Entity>Repository) {}`).
- Each method signature: `public async <verb>(context: ${Verb}${Resource}Context): Promise<<Entity>>`.
  Also add the signature to `I<Resource>Service`.
- Method takes a **context**, returns a **model**. Never accept raw DTOs or return DTOs/envelopes here.
- **Throw `AppError` subclasses** for business failures — `NotFoundError` (missing), `ConflictError`
  (duplicate), `BadRequestError` (invalid state). Never format HTTP here; the middleware does.
- Set server-owned fields explicitly (`status = <Enum>.ACTIVE`, etc.); the repository sets id + `createdAt`.
- If the service file already exists, **append** the method and interface entry — don't rewrite the class.

## Steps

1. Confirm the context (`define-context`) and repository (`define-repository`) exist.
2. If `src/services/<Resource>Service.ts` is missing, copy `references/service-class.ts.tmpl`; else open it.
3. Add the method from `references/service-method.ts.tmpl`; add its signature to `interfaces/I<Resource>Service.ts`.
4. `npm run build`.
5. Optionally back it with a unit test via **write-unit-test** `src/services/<Resource>Service.ts`.
6. Report.

## Report

```
Service:   src/services/<Resource>Service.ts (<created|extended>)
Interface: src/services/interfaces/I<Resource>Service.ts
Method:    <verb>(context) -> <Entity>
Next:      define-controller <resource> <verb>.
```

## References

@references/service-class.ts.tmpl
@references/service-method.ts.tmpl
