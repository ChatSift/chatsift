# Frontend conventions (`apps/website`)

Everything an agent needs before writing UI code. [roadmap/01-architecture.md](roadmap/01-architecture.md) covers
the backend; this covers the dashboard.

The short version, if you read nothing else:

1. **Tailwind's default palette is disabled.** `bg-black`, `text-white`, `text-red-500` compile to nothing.
2. **Use `@/components/common/Button`**, never a raw `<button>`.
3. **Search `src/components/common/` before building anything** — the component probably exists.

## Stack

Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4. Path alias `@/*` → `src/*`.

- **React Compiler is on** (`next.config.mjs`, `reactCompiler: true`), and `react-compiler/react-compiler` is an
  ESLint **error**, not a warning. Don't hand-write `useMemo`/`useCallback` to work around something the compiler
  already handles, and don't write code that violates the rules of React — it won't lint.
- `typescript.ignoreBuildErrors` is `false`. A type error fails the build.
- Lint config is `eslint-config-neon` (root `eslint.config.js`). Enforced style worth knowing up front: **interfaces
  over type aliases**, **alphabetically sorted JSX props**, `readonly` props on interfaces, tabs, single quotes.
  Prop interfaces are named `XProps` and declared directly above the component. Method-style props
  (`onChange(value: string): void`) are non-readonly; data props are `readonly`.
- `next.config.mjs` defines `redirects()` for `/github`, `/support`, `/invites/ama`, `/invites/modmail`, `/kofi` —
  link to those internal paths, not the external URLs.
- `images.remotePatterns` only allows `cdn.discordapp.com/icons/**` and `/app-icons/**`. Any other remote image host
  needs a config change.

## Theme and colour tokens

**Read [`apps/website/src/styles/globals.css`](../apps/website/src/styles/globals.css) before picking any colour
class.** It is the entire theme — this is Tailwind v4 CSS-first config and **there is no `tailwind.config.*` file
anywhere in the repo**.

Line 11 is the part that trips agents up:

```css
@theme {
	--color-*: initial;
	/* ... every token the app actually has, defined below ... */
}
```

That kills Tailwind's **entire** default palette. `bg-black`, `text-white`, `text-gray-500`, `border-red-400`,
`bg-white/60` and every other stock colour utility compile to **nothing at all** — no error, no warning, no style.
The class lands in the DOM and does nothing. Only the tokens below exist:

| Category              | Tokens                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Surfaces              | `base`, `card`, `accent` (white, no dark pair), `overlay` (modal scrim, theme-independent)    |
| Text                  | `primary`, `secondary`, `disabled`                                                            |
| Layered fills/borders | `on-primary`, `on-secondary`, `on-tertiary`                                                   |
| Semantic              | `misc-accent` (blue — primary CTA + focus ring), `misc-danger`, `misc-warning`, `misc-system` |

Every one of these except `accent` and `overlay` has an explicit `-dark` sibling (`--color-card-dark`,
`--color-misc-warning-dark`, …).

**Dark mode is manual.** It's class-based (`@custom-variant dark (&:where(.dark, .dark *))`, driven by next-themes
with `attribute="class"`), and the `-dark` tokens do **not** apply automatically — you write both halves yourself:

```tsx
<div className="bg-card dark:bg-card-dark text-primary dark:text-primary-dark">
```

Forgetting the `dark:` half is silent: the component just renders the light colour in dark mode.

Two more things in `globals.css` worth knowing:

- `@source` only scans `../components/**` and `../app/**`. A component in a **new** source directory outside those
  two is invisible to Tailwind and none of its classes will be generated.
- `tw-animate-css` is imported — that's where `data-[entering]:animate-in`, `fade-in`, `zoom-in-95` etc. come from
  (see `ConfirmModal.tsx`).

## Components

Search before you build. Route-local components live in `_components/` folders colocated under `src/app/...`;
anything reusable lives under `src/components/`.

### `src/components/common/` — the shared library

Import as `@/components/common/X`.

- **Primitives** — `Button`, `Heading`, `Skeleton`, `EmptyState`, `ScrollArea`, `Tooltip`, `Avatar`,
  `GenericAvatar`, `GuildIcon`, `Logo`, `Emoji`
- **Form fields** — `TextField`, `TextAreaField`, `RawJsonField`, `SnowflakeInput`, `EmojiInput`, `SearchBar`,
  `ChannelSelect`, `RoleSelect`, `ForumTagSelect`, `FormActions` (the submit+cancel pair), `TemplatePlaceholdersHint`
- **Overlays / feedback** — `ConfirmModal`, `ErrorBanner`
- **Navigation / infra** — `Breadcrumb`, `BreadcrumbDropdown`, `NavGate`, `Providers`, `RefreshServerDataButton`,
  `DiscordMarkdown`

Other directories: `components/dashboard/` (breadcrumb wiring, `ResyncCard`, `ScopedSessionBanner`),
`components/nav/`, `components/footer/`, `components/user/`, `components/marketing/`, and `components/icons/`.

### `Button`

Always `@/components/common/Button` — not a raw `<button>`, and not `react-aria-components`' `Button` imported
directly. It exists to do two things you'd otherwise have to repeat at every call site:

- **Automatic pending state.** It awaits an async `onPress` and disables itself for the duration. Write
  `onPress={async () => mutateAsync(...)}` and skip the manual `isPending` bookkeeping.
- **Error-banner safety net.** An uncaught error out of `onPress` gets logged and surfaced as a banner instead of
  becoming a silent failure plus an unhandled rejection. It's a fallback, not the primary path — forms that render
  their own field-level errors still catch internally.

**It has no `variant` or `size` prop.** It takes `react-aria-components`' `ButtonProps` verbatim and merges your
`className` over its base styles. Styling is per call site, so match the existing recipes rather than inventing
colours — [`components/common/FormActions.tsx`](../apps/website/src/components/common/FormActions.tsx) is the
canonical pair:

```tsx
// primary
className = 'px-3 py-2.5 bg-misc-accent text-accent rounded-md hover:opacity-90 transition-opacity ...';
// secondary
className = 'px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark ...';
```

For a form's submit/cancel pair, don't restyle two Buttons — use `FormActions`.

Related: `components/marketing/LinkButton.tsx` **does** have a real `variant` API (`'ghost' | 'primary'`, plus
`href`/`external`). It's an anchor, for static/marketing links that must work without JS — not a substitute for
`Button` in interactive dashboard UI.

Destructive or irreversible actions go through `ConfirmModal` (role `alertdialog`), not a bare button.

### Accessibility

Interactive components are built on `react-aria-components` (Button, Dialog/Modal/ModalOverlay, Tooltip, Popover,
Link) plus a few Radix packages (avatar, dropdown-menu, navigation-menu, scroll-area). Reach for those rather than
hand-rolling keyboard/focus handling — and note `jsx-a11y` is part of the lint config, so a raw `<div onClick>` will
be caught.

### Icons

Two sources: `react-icons/fa` for generic UI icons (`FaSearch`, `FaTrash`, …), and hand-rolled local `Svg*`
components in `src/components/icons/` for brand/Discord-specific ones (`SvgDiscord`, `SvgModmail`, `SvgAMA`,
`SvgTrash`, …, plus `icons/channels/`). **Prefer the local one when it exists.**

## Forms

**No react-hook-form.** The pattern is plain `useState`: one object for the form values, one for field errors, an
`updateField(field, value)` helper that clears that field's error as the user types, and a `handleSubmit` that calls
`event.preventDefault()`. Canonical example:
`src/app/dashboard/[id]/modmail/snippets/new/_components/CreateSnippetForm.tsx`.

**Never declare a local zod schema.** Client-side validation reuses the API's own schemas, so the two can't drift:

```ts
import { createSnippetBodySchema } from '@chatsift/api/modmail-schemas';

const parsed = createSnippetBodySchema.safeParse(values);
```

Then map failures to fields with the helpers in `src/api/formErrors.ts` — `mapIssuesToFieldErrors(issues, fields)`
for local validation, `mapApiErrorToFieldErrors(error, { fields, fallbackField, entityName, failureVerb })` for a
rejected request. The error type itself (`APIError`, `fieldError()`, `conflictField`, `validationErrors`) is in
`src/api/error.ts`; the app-wide banner queue is `src/api/errorBanner.ts`.

## Data fetching

TanStack Query v5, **one hook per endpoint**, all under `src/api/routes/` (`ama.ts`, `auth.ts`, `guilds.ts`,
`modmail.ts`, `modmailThreads.ts`). Components call `useX()` / `useCreateX()` — they never call `apiFetch` directly.

- **Types come from the API contract**, never hand-written: `InferRouteContract<typeof someRoute>` off a route object
  imported from `@chatsift/api`. If a handler's response shape changes, the frontend stops typechecking.
- **Always use the hierarchical `queryKeys` helpers** in `src/api/queryClient.ts`. Never inline a key array —
  invalidation depends on the hierarchy.
- Transport is `src/api/fetch.ts` (`apiFetch`, `apiFetchBlob`, `prefetch`), which handles access-token refresh and
  cookies.
- Client defaults (`src/api/queryClient.ts`): 60s `staleTime`, no refetch-on-focus, no retry on 4xx, mutations never
  retry, a global 401 clears `me`, and the error banner only fires for background refetch failures.
- **SSR**: a server component calls `prefetch(...)` and wraps children in `<HydrationBoundary>` — see
  `src/app/layout.tsx` and `src/app/ama-answers/[shareToken]/page.tsx`.
- **Realtime**: `src/api/ws.ts` plus `src/hooks/useRealtimeInvalidate.ts` — subscribe to a channel, invalidate the
  matching query keys.

Global client state that isn't server data is jotai, with an explicit shared store in `src/api/store.ts`. Providers
are composed in `components/common/Providers.tsx` (QueryClientProvider → JotaiProvider → next-themes ThemeProvider).

## Utilities

`src/utils/util.ts` holds `cn` (`twMerge(clsx(...))` — use it for any conditional/merged `className`) alongside
`sortGuilds`, `getGuildAcronym`, `formatDate`, `dateToDatetimeLocalValue` / `datetimeLocalValueToISOString`,
`discordSnowflakeToDate`, and `parseIntegerInput`. Check there before writing a formatting or parsing helper.

Also: `src/hooks/` (`useGuildAccess`, `useURLParam`, `useClickOutside`, `isMounted`, realtime hooks), and the rest of
`src/utils/` (`site.ts` for metadata, `og.tsx` for OpenGraph image generation, `bots.tsx`, `channels.tsx`,
`crawlers.ts`, `urls.ts`, `snippetName.ts`).

## Gotcha: `DiscordMarkdown`

`@discord/markdown-wasm` breaks under Next's server bundle, so `DiscordMarkdown.tsx` must be pulled in via
`next/dynamic(..., { ssr: false })` **at every call site** — don't "clean this up" into a plain import.

## Verification

There is no runtime verification an agent can do here — no browser, no session cookie. `yarn build` and `yarn lint`
are the whole agent-side gate (a Tailwind class that compiles to nothing passes both, which is exactly why the
palette rule above matters). Dashboard behaviour is the user's half; see
[workflow.md § Verification standard](workflow.md#verification-standard).
