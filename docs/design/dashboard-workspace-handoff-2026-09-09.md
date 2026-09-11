# Dashboard workspace implementation handoff

Implementation is frozen for independent QA. No browser acceptance, deployment
or commit was performed by this builder. Direction:
[dashboard-workspace-direction-2026-09-09.md](dashboard-workspace-direction-2026-09-09.md).
The supplied Autosend, Harvey and Harvest captures were inspected directly.

## Changes

- `apps/console/src/routes/Home.tsx`: replaced the previous mascot, gauge,
  marketing photograph and numerical preview with one modest page header,
  four aligned shift metrics, two operational action rows, a wide recent
  decisions table and bounded task rows. Existing shift/recent/task endpoints
  remain the source. Money uses each response's currency. Errors retain loaded
  records with a stale notice and retry; unloaded figures stay absent.
- `apps/console/src/components/shell/AppShell.tsx`: stable 240px desktop rail,
  compact native modal drawer below 960px, bottom account entry, working colored
  logo link to `/` with localized “PlayerOne — Home” accessible name, skip link,
  retained operational counters where supplied. A reviewer on `/review` uses
  real `/whoami` identity plus sign-out instead of a forbidden operator-profile
  link. Drawer key events cannot trigger underlying review shortcuts.
- `apps/console/src/components/shell/PillNav.tsx`: grouped vertical destinations;
  every existing route and partial-scope indicator retained.
- `apps/console/src/routes/Profile.tsx`: real identity/role/centre/status;
  read-only account details; explicit light/dark/device setting; existing
  language control; browser-only photo selection/reset; real sign-out.
  An 84-day calendar renders the API's own dated counts and totals, with
  selected-day counts, a single roving day tab stop and arrow/Home/End keys.
- `apps/console/src/lib/profile-api.ts`: isolated read-only profile client using
  same-origin cookies, actual status/body/reference errors and the agreed
  `GET /api/operator/profile` contract. Sign-out uses existing DELETE
  `/api/session`; successful logout clears query cache before navigation.
- `apps/console/src/components/shell/OperatorAvatar.tsx`: real uploaded image or
  reference initial; saved only in localStorage for that operator and origin.
  No avatar server mutation exists or is implied. Accepts decoded PNG/JPEG/WebP
  under 1 MB; handles storage errors and reset.
- `apps/console/src/styles/workspace.css`: scoped Archivo/lavender/paper/ink
  workspace rules, contained table/calendar scrolling, dark token support,
  visible focus, finite hover transitions and reduced-motion treatment.
- `apps/console/src/lib/workspace-copy.ts` and `lib/i18n.ts`: matching VI/EN/ZH
  copy added without replacing landing/login resources.
- `apps/console/src/router.tsx`: `/profile` uses the existing session guard;
  reviewer redirection remains unchanged.
- `apps/console/src/components/guide/Guide.tsx` and `guide/steps.ts`: removed the
  optional 3D mascot and updated Home guide targets/copy to the new layout.
  Existing focus/keyboard protection and other route guides remain.

No logo geometry/animation, login, public landing, backend, database or financial
mutation was changed in this implementation pass. `BoTask` currently has no
reference-image field; task rows therefore use a compact task glyph. No new
photography, fake task rows or fallback financial examples were added.

## Evidence and data semantics

The profile API was authored separately by `operator_profile_api`. It reports
exactly 84 Vietnam-local dates ending today, timezone `Asia/Ho_Chi_Minh`, only
the authenticated operator's audit events, excluding `.login` and
`.login_failed`. Collection `session.create` remains counted work. The UI uses
those dates and explicitly names the timezone; it does not turn errors into
zero activity. Shift statistics separately retain the existing server-day
scope and are labelled accordingly.

Author checks:

- `pnpm -F @playerone/console exec tsc --noEmit`: exit 0 after implementation.
- Final `pnpm -F @playerone/console build`: exit 0, 8.14 seconds.
- Scoped `git diff --check`: exit 0; existing LF/CRLF notices only.
- Vite still reports existing chunks over 500 kB. No claim of bundle or
  performance acceptance; a Panda chunk remains in the wider application build,
  but Home and the shared Guide no longer import/render it.

## Independent QA scenarios

1. At 1440px, check the stable rail, consistent content starts, compact metric
   alignment, wide recent rows, real empty task state, and absence of marketing
   images/mascot. Check route links and logo keyboard activation.
2. At 375px and short height/200% zoom, open/close the navigation dialog, verify
   focus return/Escape and no background keyboard actions; verify tables and
   calendar scroll inside their own regions, never the page horizontally.
3. Check VI/EN/ZH and light/dark/system preferences, account labels, long real
   references, numeric units, verdict glyph/hue and sampled text/focus contrast.
4. Verify the profile against the real endpoint, 84 dated cells, Vietnam date
   range, selected-day count and keyboard navigation. Check zero-action data,
   initial failure and failed refresh with cached nonzero data.
5. Choose/reset an avatar, navigate between Home/profile, reload, switch
   accounts, reject large/invalid files, and verify the browser-only disclosure.
   No photo upload request should occur.
6. Check actual sign-out clears operator/machine cookies, a failed sign-out
   remains visibly failed, operator profile routing works, and reviewer
   profile restrictions remain intact.
7. Verify Home shift/recent/task initial failure, retry and cached refresh
   failure independently. Check money and decision labels against API values.
8. Run the revised Home guide, including compact navigation, and ensure no 3D
   model or stale gauge instruction appears. Public login/landing remain the
   separately accepted surfaces.

Root supplied local Vite `5190` and API `8080` for independent review. Cloud
release/recovery is owned by root and is separate from these author checks.
