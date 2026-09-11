# PlayerOne operator workspace — refined build brief

## World and purpose

Replace the current editorial dashboard with a precise working ledger for a
Vietnamese upload-centre operator: what needs attention, what was reviewed,
what those decisions mean, and where to act next. This is an Operate surface.
The visual world is a paper workspace inside a restrained lavender shell, with
an anchored navigation rail and fine ruled sections. Brand appears in the
PlayerOne wordmark, careful typography and selected states. The landing's
cinematic media, oversized headings and Truc performance do not belong here.

The owner's Autosend reference supplies sidebar hierarchy and consistent column
starts. Harvey supplies one clear workspace title, a compact summary and orderly
work rows. Harvest supplies tabular figures, time units and explicit date scope.
Translate those organizing principles into PlayerOne's tasks, handovers, human
review and approved effective minutes; never import competitor metrics or copy
their branding. Mobbin MCP is not exposed in this session. Use the owner's four
provided captures and the prior MCP evidence in `mobbin-reference-research-2026-09-09.md`.

## Composition and evidence

| Area | What it says | Visual carrier | Required evidence / boundary |
| --- | --- | --- | --- |
| Navigation | Where I am and what I can do next | Stable narrow left rail; grouped labelled destinations; selected row; profile anchored at bottom | Preserve existing routes and permission boundaries. Every visible action works. Mobile uses an accessible modal drawer. |
| Workspace header | Current task, signed-in centre and data freshness | One modest heading, one supporting line, consistent action position | Existing session/reference metadata; no invented greeting name or office location. |
| Shift summary | Today's reviewed work and outcomes | One compact aligned strip of tabular values with explicit units and scope | Existing shift response; failed/unavailable values stay absent with retry. No trend curve without history. |
| Work requiring attention | Which queue or unresolved episode needs a person | Wide ruled list, concise state labels and clear destination actions | Actual queue and unresolved counts. Financial state retains verdict glyph plus hue. |
| Recent work | What happened, to which recording, and when | Structured rows with stable columns, bounded descriptions and recognizable verdicts | Existing recent data. Empty/error/loading states retain the same geometry. No stock image filler. |
| Tasks | What work the operator is managing | Compact task rows, with occasional small task-owned reference thumbnail | Use a real task image URL only where API evidence supplies it; otherwise use a category glyph. Never reuse landing footage, portraits or unrelated images as task evidence. |
| Operator profile | Who is signed in and which preferences they control | Profile avatar, identity/role/centre details, concise settings rows | Real authenticated identity. An avatar preference saved only in this browser must say so; never pretend it is a server profile upload. |
| Activity | On which days this operator has recorded actions | GitHub-like twelve-week calendar, quiet legend, selected-day detail and accessible text summary | Authenticated own-operator audit events grouped by explicit timezone/date. State exact range and counted action scope; empty data stays empty, errors never become zero. This is not earnings, performance ranking or automatic approval. |

## Interaction and responsive behavior

Desktop keeps the sidebar stable and gives the work area one consistent left
edge. Avoid arbitrary indentation between headings, summaries and lists. On
smaller screens move the same destinations into a labelled drawer, stack summary
values predictably and keep any wide table's overflow inside its own region.
The profile/settings route must remain usable at 375px and in VI/EN/ZH. Preserve
dark-theme support and visible keyboard focus.

Motion communicates navigation or a change of state: brief finite section
entrances, restrained row hover and a calendar day selection. Use the existing
GSAP discipline when it adds value, preserve full content if import fails, and
honor reduced motion. No persistent animation ticker, mascot, video backdrop,
scroll hijacking, fake live pulses or count-up financial figures in the console.

Settings must expose working language/theme choices and sign out. Operator
identity and permissions are read-only unless an existing supported mutation
exists. Profile picture selection may be a clearly labelled browser preference
with reset; do not invent an upload endpoint. Preserve HTTP errors and actual
role-specific actions rather than hiding backend failures behind cosmetic success.

## Delivery

Root directs. The UI builder owns Home/shared shell/profile styles and copy.
A separate builder owns any needed narrowly scoped authenticated read-only
profile/activity endpoint. A non-author audits both. The currently healthy
Railway deployment remains available while the next source snapshot is built.
Only after bounded independent checks should the new console replace it.

Acceptance focuses on consistent edges and column alignment, every navigation
destination, real session identity, own-user activity isolation, day semantics,
empty/error states, mobile scrolling, keyboard access, motion cleanup and sampled
rendered contrast. No fabricated data, financial mutation or unrelated backend
rewrite is part of this redesign.

The main PlayerOne logo is also a navigation control: from the authenticated
console it links to `/`, with a localized home label and visible focus. Existing
reviewer route guards still apply. Public landing/login branding links to the
public product home rather than silently entering a protected operator route.
