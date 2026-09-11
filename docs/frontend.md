# Frontend conventions (`apps/website`)

Everything an agent needs before writing UI code. [roadmap/01-architecture.md](roadmap/01-architecture.md) covers
the backend; this covers the dashboard.

**There is a second app now.** `apps/appeals` (`unban.app`, #232 P3) is built on the same `@chatsift/web-core`
substrate and everything below about the theme, the component library and the lint rules applies to it unchanged.
What does _not_ carry over is anything dashboard-specific: it has no session of the kind described here (its own
lives behind `isAppealsAuthed`, in a differently-named cookie on a different eTLD+1), no guild context, no
realtime WS, and none of the 14 components that stayed in `apps/website/src/components/common/`. It is also
client-rendered throughout -- no `prefetch()`, no server components that fetch. When something reads as "the
dashboard does X", check whether X is a property of the substrate or of the dashboard before copying it across.

The short version, if you read nothing else:

1. **Tailwind's default palette is disabled.** `bg-black`, `text-white`, `text-red-500` compile to nothing.
2. **Use `@chatsift/web-core/components/Button`**, never a raw `<button>`.
3. **Search `@chatsift/web-core/components/` and `src/components/common/` before building anything** -- the component probably exists.

## Stack

Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4. Path alias `@/*` → `src/*`.

- **React Compiler is on** (`next.config.mjs`, `reactCompiler: true`), and `react-compiler/react-compiler` is an
  ESLint **error**, not a warning. Don't hand-write `useMemo`/`useCallback` to work around something the compiler
  already handles, and don't write code that violates the rules of React -- it won't lint.
- `typescript.ignoreBuildErrors` is `false`. A type error fails the build.
- Lint config is `eslint-config-neon` (root `eslint.config.js`). Enforced style worth knowing up front: **interfaces
  over type aliases**, **alphabetically sorted JSX props**, `readonly` props on interfaces, tabs, single quotes.
  Prop interfaces are named `XProps` and declared directly above the component. Method-style props
  (`onChange(value: string): void`) are non-readonly; data props are `readonly`.
- `next.config.mjs` defines `redirects()` for `/github`, `/support`, `/invites/ama`, `/invites/modmail`,
  `/invites/automoderator`, `/kofi` -- link to those internal paths, not the external URLs. `apps/appeals` has
  no such routes and reaches them through `SITE_URL` instead.
- **Static brand assets are synced, not committed per app.** `scripts/sync-web-core-assets.mjs` copies the
  Author fonts and `favicon.ico` out of `packages/private/web-core/assets/` into each app's `public/assets/` on
  every `build`, `dev` and `start`; both destinations are gitignored. Add a shared asset there, not to an app.
  The favicon lands at `/assets/favicon.ico` and is wired through `metadata.icons`, **not** as a root
  `public/favicon.ico` -- Next's file convention for that would take precedence over the metadata.
- `images.remotePatterns` only allows `cdn.discordapp.com/icons/**` and `/app-icons/**`. Any other remote image host
  needs a config change.

## Theme and colour tokens

**Read [`packages/private/web-core/src/styles/theme.css`](../packages/private/web-core/src/styles/theme.css)
before picking any colour class.** It is the entire theme, shared by every app in `apps/` -- this is Tailwind v4 CSS-first config and **there is no `tailwind.config.*` file
anywhere in the repo**.

This is the part that trips agents up:

```css
@theme {
	--color-*: initial;
	/* ... every token the app actually has, defined below ... */
}
```

That kills Tailwind's **entire** default palette. `bg-black`, `text-white`, `text-gray-500`, `border-red-400`,
`bg-white/60` and every other stock colour utility compile to **nothing at all** -- no error, no warning, no style.
The class lands in the DOM and does nothing. Only the tokens below exist:

| Category              | Tokens                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Surfaces              | `base`, `card`, `accent` (white, no dark pair), `overlay` (modal scrim, theme-independent)     |
| Text                  | `primary`, `secondary`, `disabled`                                                             |
| Layered fills/borders | `on-primary`, `on-secondary`, `on-tertiary`                                                    |
| Semantic              | `misc-accent` (blue -- primary CTA + focus ring), `misc-danger`, `misc-warning`, `misc-system` |

Every one of these except `accent` and `overlay` has an explicit `-dark` sibling (`--color-card-dark`,
`--color-misc-warning-dark`, …).

**Dark mode is manual.** It's class-based (`@custom-variant dark (&:where(.dark, .dark *))`, driven by next-themes
with `attribute="class"`), and the `-dark` tokens do **not** apply automatically -- you write both halves yourself:

```tsx
<div className="bg-card dark:bg-card-dark text-primary dark:text-primary-dark">
```

Forgetting the `dark:` half is silent: the component just renders the light colour in dark mode.

Two more things worth knowing:

- `@source` declarations are split. `theme.css` declares the package's own `../components/**`; each app's
  `globals.css` declares its `../components/**` and `../app/**`. A component in a **new** source directory
  outside those is invisible to Tailwind and none of its classes will be generated -- silently.
- `tw-animate-css` is imported -- that's where `data-[entering]:animate-in`, `fade-in`, `zoom-in-95` etc. come from
  (see `ConfirmModal.tsx`).

## Components

Search before you build. Route-local components live in `_components/` folders colocated under `src/app/...`;
anything reusable lives under `src/components/`.

### `@chatsift/web-core/components/` -- the shared library

Import as `@chatsift/web-core/components/X`. This is `packages/private/web-core`, extracted so a second Next
app can reuse it. The split rule: a component lives in the package if it needs nothing from the dashboard's
session or guild data. The ones that do stayed in `apps/website/src/components/common/` and are still imported
as `@/components/common/X`.

**In the package** -- `@chatsift/web-core/components/X`:

- **Primitives** -- `Button`, `Heading`, `Skeleton`, `EmptyState`, `ScrollArea`, `Tooltip`, `Avatar`,
  `GenericAvatar`, `GenericAvatarImages`, `DiscordUserAvatar`, `Emoji`
- **Site chrome** -- `Footer` (pass `siteUrl` from an app that isn't served from `automoderator.app`: its links
  are all routes there, and it is what turns the copyright line into the way back to the main site),
  `ThemeSwitchButton`, `SiteLogo` (the ChatSift mark plus a `label`, so `unban.app` names itself while keeping
  the mark), and `nav/{NavbarShell,NavbarDesktop,NavbarMobile,LoginButton}` -- see the navbar note below
- **Social cards** -- `utils/og`'s `renderOgCard` draws the one card layout both sites unfurl with, taking a
  `siteName` for the wordmark. `utils/ogConstants` holds `OG_SIZE`/`OG_CONTENT_TYPE` in a module of their own,
  deliberately: `utils/og` pulls in `next/og` and `node:fs`, and an app's `utils/site.ts` -- which every page's
  metadata imports -- should not carry either just to know how big a card is.
- **Brand icons** -- `@chatsift/web-core/components/icons/{SvgChatSift,SvgDiscord,SvgGitHub,SvgDarkTheme,SvgLightTheme}`.
  Everything else under `apps/website/src/components/icons/` is dashboard-specific and stays there.
- **Hooks** -- `@chatsift/web-core/hooks/useIsMounted`. The only one; the rest are the dashboard's.
- **Form fields** -- `TextField`, `TextAreaField`, `RawJsonField`, `SnowflakeInput`, `ColorField`, `SearchBar`,
  `SegmentedControl` (pick one of a few -- every mode switch and on/off toggle), `FormActions` (the
  submit+cancel pair)
- **Overlays / feedback** -- `ConfirmModal`, `ErrorBanner`
- **Styling helper** -- `buttonStyles` (see below), and `@chatsift/web-core/utils/cn`

**Still app-local** -- `@/components/common/X`, because each one reaches into the dashboard's own API routes,
hooks or branding:

- **Guild pickers** -- `ChannelSelect`, `RoleSelect`, `ForumTagSelect`, `EmojiInput` (all typed against
  `@/api/routes/guilds`)
- **Navigation / session** -- `Breadcrumb`, `BreadcrumbDropdown`, `GuildIcon`, `NavGate`, `Providers`,
  `RefreshServerDataButton`
- **Discord rendering** -- `DiscordMarkdown`, `EmbedMessagePreview`, `TemplatePlaceholdersHint`

**The navbar is shared too**, and is worth understanding before touching either app's header.
`@chatsift/web-core/components/nav/` owns `NavbarShell` (the sticky, full-bleed `<header>`), `NavbarDesktop`,
`NavbarMobile` (the hamburger sheet) and `LoginButton`. Each app composes them:

```tsx
<NavbarShell mobile={<NavbarMobile account={<UserMobile />} items={items} label="ChatSift" />}>
	<NavbarDesktop account={<UserDesktop />} extraItems={<AdminNavLink />} items={items} label="ChatSift" />
</NavbarShell>
```

Only three things are per-app: the wordmark `label`, the `items`, and the `account` slot -- the last because each
app has its own session and its own `useMe`, which is exactly the part that could not be shared. Two rules fall
out of that:

- **Take link styling from the navbar, not from a copy.** `NAV_LINK_CLASS` (desktop) and `MOBILE_NAV_LINK_CLASS`
  (mobile) are exported for links that have to be their own client component to decide whether to render at all
  -- `AdminNavLink` is the one that does.
- **The mobile sheet closes through `useCloseNavbarMobile()`, not a prop.** Anything in `account`/`extraItems`
  that navigates or signs out calls it; it is a no-op in the desktop navbar, so one component works in both. The
  slots are plain `ReactNode`s on purpose -- render props there meant defining a component inside `Navbar`'s
  render, which React reconciles as a new type every time.

`LoginButton` is deliberately the bare `Button` rather than `buttonClass('primary')`: in a navbar the account
slot is not the page's primary action. A page that wants signing in to _be_ the primary action says so on the
page (`apps/appeals`'s `SignInPrompt`).

`Providers` in particular cannot move: it calls `getBrowserQueryClient()` internally and can't take the client
as a prop, because `app/layout.tsx` is a Server Component and a `QueryClient` is not serialisable across that
boundary. Each app writes its own.

Other directories: `components/dashboard/` (breadcrumb wiring, `CommandPalette`, `ResyncCard`,
`ScopedSessionBanner`), `components/nav/`, `components/footer/`, `components/user/`, `components/marketing/`, and
`components/icons/`.

**Jump to (Cmd/Ctrl+K)** is `components/dashboard/CommandPalette.tsx`: `app/dashboard/layout.tsx` mounts its
provider inside `NavGateProvider` (so `me` is loaded whenever it can open) and `GuildNav` renders its trigger.
It offers the current server's bots and their sections, the other servers, and a "Go to" group with one row
per numbered thing: "Case by number", "Report by number" and "Thread by number" type their word for you (a bare
`42` also lists all three; `case 42` narrows to one), and "AMA by name" opens a nested page listing the sessions
by title (fetched on first open, open ones first; Backspace on an empty box comes back). Cases, reports and
threads get no such page because there are too many to list. A session title typed at the top level still
matches. Its Recent group is what `DashboardCrumbs` writes to localStorage once a trail's labels have all
resolved.

**The guild tab row is a menu too.** `app/dashboard/[id]/_components/GuildNav.tsx` builds the tabs on Radix
`NavigationMenu`: each bot tab is a link to the bot's hub _and_ the trigger for a panel of its sections
(hover opens it from `lg` up; a tap on a phone just follows the link, so the hub's cards are the menu there;
keyboard users get the hub the same way). Panels are title-only and read `utils/botSections.ts`, with
AutoModerator keeping its hub's grouping. The open tab paints `bg-on-secondary`, a shade darker than the
active tab's `bg-on-tertiary`, because hover and active already look the same. Two mechanics worth knowing
before touching it: the tabs scroll horizontally, so the panel hangs off Radix's `Viewport` outside the
scrolling box, a zero-size anchor placed by measuring the tab as it opens (not by Radix's measured
`--radix-navigation-menu-viewport-*` variables, which arrive a frame late and made the panel flash at the
previous position); and the value is controlled for the same reason, with a reset on pathname change so a
navigation always lands with the menu closed. Section lists live in `utils/{automoderator,appeals,modmail,social}Sections.ts`
-- the hubs and the breadcrumb read those directly, the palette reads them through `utils/botSections.ts` -- so
a section added to one of those files reaches all three. `cmdk` is the dependency it brought in: fuzzy
scoring, grouping, arrow-key selection and the dialog's ARIA, on the same Radix Dialog the stack already uses.

### `Button`

Always `@chatsift/web-core/components/Button` -- not a raw `<button>`, and not `react-aria-components`' `Button` imported
directly. It exists to do two things you'd otherwise have to repeat at every call site:

- **Automatic pending state.** It awaits an async `onPress` and disables itself for the duration. Write
  `onPress={async () => mutateAsync(...)}` and skip the manual `isPending` bookkeeping.
- **Error-banner safety net.** An uncaught error out of `onPress` gets logged and surfaced as a banner instead of
  becoming a silent failure plus an unhandled rejection. It's a fallback, not the primary path -- forms that render
  their own field-level errors still catch internally.

**It has no `variant` or `size` prop.** It takes `react-aria-components`' `ButtonProps` verbatim and merges your
`className` over its base styles. Don't invent colours -- take the class string from
[`buttonStyles.ts`](../packages/private/web-core/src/components/buttonStyles.ts):

```tsx
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';

<Button className={buttonClass('primary')} />        // page-level submit
<Button className={buttonClass('secondary', 'sm')} /> // a row's action, an Add next to a picker
```

Three variants (`primary`, `secondary`, `danger`) and three sizes:

- **`md`** (the default) -- a page's single submit. Reaching for it inside a card is what made AutoModerator's
  pages read as visibly heavier than the rest of the dashboard (#374).
- **`field`** -- a button on the same row as an input. Matches `TextField`'s box exactly; anything else leaves it
  visibly shorter than the control it sits beside.
- **`sm`** -- an action inside a row of text: a listed item's Remove, a detail page's action bar.

For a button paired with a `TextField`, pass it as that field's **`trailing`** prop rather than putting the two
in a flex row: inside the field, `label` stays above the pair and `helper`/`error` stay below both, so the button
can't drift down the moment either appears.

For a form's submit/cancel pair, don't restyle two Buttons -- use `FormActions`. For pick-one-of-a-few (a mode
switch, an on/off toggle), use `SegmentedControl` -- never a raw `<button>`, which has no `cursor: pointer` and so
doesn't read as clickable.

`TextField`/`TextAreaField`'s **`helper` takes a plain string** and styles it; pass a node only when you need
something a sentence can't do (a live preview, a hint with a link), and style that node yourself.

Related: `components/marketing/LinkButton.tsx` **does** have a real `variant` API (`'ghost' | 'primary'`, plus
`href`/`external`). It's an anchor, for static/marketing links that must work without JS -- not a substitute for
`Button` in interactive dashboard UI.

Destructive or irreversible actions go through `ConfirmModal` (role `alertdialog`), not a bare button.

### Accessibility

Interactive components are built on `react-aria-components` (Button, Dialog/Modal/ModalOverlay, Tooltip, Popover,
Link) plus a few Radix packages (avatar, dropdown-menu, navigation-menu, scroll-area). Reach for those rather than
hand-rolling keyboard/focus handling -- and note `jsx-a11y` is part of the lint config, so a raw `<div onClick>` will
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

Then map failures to fields with the helpers in `src/api/formErrors.ts` -- `mapIssuesToFieldErrors(issues, fields)`
for local validation, `mapApiErrorToFieldErrors(error, { fields, fallbackField, entityName, failureVerb })` for a
rejected request. The error type itself (`APIError`, `fieldError()`, `conflictField`, `validationErrors`) is in
`src/api/error.ts`; the app-wide banner queue is `src/api/errorBanner.ts`.

## Data fetching

TanStack Query v5, **one hook per endpoint**, all under `src/api/routes/` (`ama.ts`, `auth.ts`, `guilds.ts`,
`modmail.ts`, `modmailThreads.ts`). Components call `useX()` / `useCreateX()` -- they never call `apiFetch` directly.

- **Types come from the API contract**, never hand-written: `InferRouteContract<typeof someRoute>` off a route object
  imported from `@chatsift/api`. If a handler's response shape changes, the frontend stops typechecking.
- **Always use the hierarchical `queryKeys` helpers** in `src/api/queryClient.ts`. Never inline a key array --
  invalidation depends on the hierarchy.
- Transport is `src/api/fetch.ts` (`apiFetch`, `apiFetchBlob`, `prefetch`), which handles access-token refresh and
  cookies.
- Client defaults (`src/api/queryClient.ts`): 60s `staleTime`, no refetch-on-focus, no retry on 4xx, mutations never
  retry, a global 401 clears `me`, and the error banner only fires for background refetch failures.
- **SSR**: a server component calls `prefetch(...)` and wraps children in `<HydrationBoundary>` -- see
  `src/app/layout.tsx` and `src/app/ama-answers/[shareToken]/page.tsx`.
- **Realtime**: `src/api/ws.ts` plus `src/hooks/useRealtimeInvalidate.ts` -- subscribe to a channel, invalidate the
  matching query keys.

Global client state that isn't server data is jotai, with an explicit shared store in `src/api/store.ts`. Providers
are composed in `components/common/Providers.tsx` (QueryClientProvider → JotaiProvider → next-themes ThemeProvider).

## Utilities

`src/utils/util.ts` holds `cn` (`twMerge(clsx(...))` -- use it for any conditional/merged `className`) alongside
`sortGuilds`, `getGuildAcronym`, `formatDate`, `dateToDatetimeLocalValue` / `datetimeLocalValueToISOString`,
`discordSnowflakeToDate`, and `parseIntegerInput`. Check there before writing a formatting or parsing helper.

Also: `src/hooks/` (`useGuildAccess`, `useURLParam`, `useClickOutside`, `isMounted`, realtime hooks), and the rest of
`src/utils/` (`site.ts` for metadata, `og.tsx` for OpenGraph image generation, `bots.tsx`, `channels.tsx`,
`crawlers.ts`, `urls.ts`, `snippetName.ts`).

## Gotcha: `DiscordMarkdown`

`@discord/markdown-wasm` breaks under Next's server bundle, so `DiscordMarkdown.tsx` must be pulled in via
`next/dynamic(..., { ssr: false })` **at every call site** -- don't "clean this up" into a plain import.

## Verification

There is no runtime verification an agent can do here -- no browser, no session cookie. `yarn build` and `yarn lint`
are the whole agent-side gate (a Tailwind class that compiles to nothing passes both, which is exactly why the
palette rule above matters). Dashboard behaviour is the user's half; see
[workflow.md § Verification standard](workflow.md#verification-standard).
