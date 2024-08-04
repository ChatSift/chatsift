# src

Please do not modify the [`db.ts` file](./db.ts) in this directory. It is automatically managed by Prisma+Kysely.
Use `yarn prisma generate` in the root directory to reflect schema changes.

A couple of things to note about this codebase:

- There are areas where we leverage sort of out-of-pattern factory singletons. This is preferred over just binding
  a proper factory in the container because it:
  1. Allows us to rely on implicit resolution of the factory without the need to `@inject()` a symbol.
  2. Is less boilerplate overall.
- One thing to note about this approach is that we do theoretically risk a footgun here, but because
  those factory classes are so incredibly simple and should always return `IX` (interfaces), it should never
  ever be an issue.
- When we use `snake_case` in our own types, it's generally because those properties are directly mapped from Discord's
  API.
- Generally, we only use `constructor(private readonly foo: Foo)` to signal a dependency being injected,
  other sorts of parameters should be taken in as usual and assigned in the constructor.
