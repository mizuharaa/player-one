# CONTEXT — the back-office console

For an agent rebuilding the console's look. Read the root `CONTEXT.md` first for
the domain and `CLAUDE.md` for the decisions; this file is only what the
frontend needs on top. The repo's `DESIGN.md` is the design system and wins
over anything here.

## What it is

A React 19 SPA (Vite, TanStack Router + Query + Table, Tailwind 4, i18next)
talking to the Fastify API over two HttpOnly cookies. No public users, no SEO.
It runs on fixed machines at Vietnamese upload centres and, for reviewers, over
a scoped remote session from Shenzhen.

**Three audiences, two languages.** Operators and finance (VNG, en/vi),
reviewers (PaXini, zh). Every string lives in `packages/api/src/i18n.ts` under
one key for all three locales; a parity test fails the build if a locale is
missing a key. Collectors never see this app — their surface is the phone app.

## Screens, and their real state

| Route | Screen | State |
|---|---|---|
| `/login` | Login | real |
| `/` | Home — shift figures, queue depth, needs-a-human strip | real |
| `/review` | Review — player, spans, verdict, reasons, hold, dispute | real, **the product** |
| `/pipeline` | Pipeline — upload batches, verification | real |
| `/backoffice` | Tasks / Collectors / Devices tabs | real |
| `/settle` `/settle/preflight` `/settle/bills/$id` `/settle/exceptions` | Finance | real, four screens |
| `/risk` | Risk holds and flags | real |
| `/counter` | BO-10 handover + import | **stub** by decision (ADR 0003) — leave the stub, do not build it |
| `/episodes` | BO-05 browse and filter | **stub**, no decision against building it |

The two stubs (`routes/NotBuilt.tsx`) say what the surface is for and how the
work is done today. That copy convention — honest about what is not built —
stays.

## Rules that are not taste

- **Tokens only.** `packages/design/src/tokens.ts` is the only place a colour,
  radius, shadow or duration is written. Regenerate with
  `pnpm -F @playerone/design build:css`. A value that exists only in a `.tsx`
  file is a value the phone app cannot have. A contrast test enforces AA on
  the tokens in both themes.
- **Never colour alone.** Verdict states carry a glyph as well as a colour;
  this axis decides money and red/green colour-blindness is common.
- **A full review with no pointer.** Reviewer throughput is the programme's
  ceiling; every verdict action has a keyboard path (`lib/shortcuts.ts`).
  Breaking that is a regression, not a redesign.
- **Numbers are strings.** Durations and money arrive as Postgres `numeric`
  strings (`type Decimal = string` in `lib/api.ts`). Display them; never parse
  and total them. The server computes money. The `.num` class sets
  tabular figures and is load-bearing on every table.
- **Errors say why.** A 409 names its constraint and the console shows that
  constraint's sentence via `refusalKey()`; a 500 carries `ref`, shown by
  `<Problem reference=…>`, so an operator can quote it. Keep both.
- **Copy is plain.** The owner has asked for no buzzwords and for Simplified
  Technical English. Sentences say what happened and what to do. No "Oops".

## Before claiming a visual change works

```
node packages/api/scripts/seed-console.mjs      # a real queue to look at (needs DATABASE_URL)
pnpm -F @playerone/console dev                   # API on :8080
node apps/console/scripts/shots.mjs              # every screen, both viewports, both languages
```

`shots.mjs` writes to `.impeccable/review/`. A typecheck cannot see contrast,
overflow or a gauge drawn from the wrong angle.

## Tests, and one rule about the database

Console tests run **without a database**:

```
env -u DATABASE_URL npx vitest run apps/console packages/design packages/api/test/console.test.ts
```

Keep it that way. Another track owns Postgres; running the database-backed
suite from this worktree while it does has taken the server down once already.
One database track at a time.

## Do not touch

`packages/api/src/**` except `i18n.ts` for strings; `packages/store`;
anything under `payout/domain`; `lib/api.ts` beyond adding a type the server
already sends. If the redesign needs a new field, that is an API change and it
goes to the pipeline track, not into this one.
