# ADR 0002 — the back office is a React SPA, and the design system is shared

**Status** Accepted
**Date** 2026-08-25
**Affects** BO-01→BO-14, QR-*, the console shipped on `feat/review-console`
**Supersedes** the "no build step anywhere" reading of the console's constraints

## Context

Two documents written on the same day disagreed about what the back office is.

`Player One App Preliminary Architecture` (the draw.io stack diagram, 24 Aug
08:55) specifies the back office as **React 19, Vite, TanStack Router and Query,
Tailwind, shadcn/ui and i18next**, with TanStack Table for every queue and
Recharts for operations statistics. It specifies the Path C upload-centre client
as **Electron 32 with the back office component library**, and the collector app
as **React Native 0.82**.

`PRODUCT.md` and the design draft, written the same evening, recorded the
opposite: server-rendered HTML plus plain ES modules, with React "ruled out for
this surface" and a no-build-step property described as load-bearing. The console
on `feat/review-console` was built that way — `console.ts`, `shell.ts` and a
43 KB hand-written `assets/review.js`.

The stated reason for no build step was that upload centres sit on a LAN and must
keep working with the link down. That reason does not survive contact with the
diagram's own upload-centre row: an Electron app is a compiled artifact and works
offline precisely because it was built. A Vite SPA served from the local machine
has the same property — once the bundle is on disk, the link being down is
irrelevant. **Offline tolerance is a property of shipping a compiled artifact to
the centre, not of avoiding a compiler.**

What the no-build-step rule does protect is the *server*: an operator at a
counter must never be waiting on a compile step between a bug and a fix, and the
ingest engine must never need a database. Those are separate claims and both
still hold.

## Decision

The back-office console is a **React 19 SPA**: Vite, TanStack Router, TanStack
Query, Tailwind, shadcn/ui, i18next, TanStack Table, Recharts. It talks to the
existing `/v1` API over a cookie session. The Fastify server keeps serving JSON
and media and stops serving markup.

Design tokens and the component contract are authored once in `packages/design`
and consumed by the console, the Electron upload-centre client and the React
Native collector app.

**Every line of review server logic is kept.** `money.ts`, `review.ts`,
`media.ts`, `session.ts`, `cookies.ts`, `i18n.ts` and migration `0004` are
untouched, and their tests are the net under the rewrite. What is replaced is the
view layer: `console.ts`, `shell.ts`, `assets/review.css` and `assets/review.js`.

## Consequences

- The design system is implemented **once**, not twice by hand. This is the main
  reason the decision was taken: the stereo-pair mark, the two-brand palette and
  Cú's four states are worth authoring once and consuming in three places.
- The repo gains a build step for one workspace. `pnpm test` must still pass with
  **no database and no sample corpus** — that property is load-bearing and is not
  what this ADR trades away.
- The console's remaining architectural hole is unchanged and still owed:
  reviewers sign in with upload-centre operator credentials, where PLT-10
  requires a scoped, fully-logged remote reviewer role.
- `feat/review-console` should be pushed and merged **before** the rewrite starts,
  so the server logic lands on `main` independently of the view layer that is
  about to be thrown away.

## The rule that replaces "no build step anywhere"

> The engine must never need a database. The server must never need a build step.
> Interactive surfaces are React and are built. Offline tolerance is achieved by
> shipping a compiled artifact, not by refusing to compile.
