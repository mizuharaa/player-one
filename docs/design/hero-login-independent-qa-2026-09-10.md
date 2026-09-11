# Hero title and login layout — independent QA

**Local verdict: PASS; no blocking finding.** Independently reviewed after both builders froze. Scope is the duplicated hero slogan and login composition/reachability. No unrelated dashboard or financial sweep.

## Checks and results

- `node apps/console/scripts/hero-login-independent-qa.mjs`, followed by `--layouts-only` with corrected locale initialization: actual `vi`, `en`, and `zh-Hans` rendering at 375×812, 768×900, 1280×800, 1440×900, and 1440×600. Fifteen layout cases.
- Login starts at scrollY **0** in every case. The title is fully within the initial viewport, with no horizontal overflow. All four credential inputs and Submit can receive focus and become fully visible. No autofocus or focus effect exists in Login/Input.
- Desktop panels have equal widths and equal heights: 640/640 px at width1280; 720/720 px at width1440. At height600 the panels both grow to the content height (704.6–770.5 px across languages), allowing ordinary page scrolling. Nothing is trapped in a clipped fixed-height pane. Below960 the intended compact film-first/form-second layout was verified.
- Every reduced-motion hero displays the white film title and hides the introductory black slogan. At375 and1440, normal playback, visible Skip, and deliberately failed logo-motion import each finish with exactly one visible title, cleared pending state, and playing opening film. No page errors.
- Source review confirms settled hero state removes `data-story-active` before clearing the slogan's animation styles. CSS active/pending slogan rules also exclude the revealed-film state, preventing the previous opacity reset from displaying the slogan again.
- `pnpm -F @playerone/console typecheck`: PASS on frozen source.
- `pnpm -F @playerone/console build`: PASS, 283 modules, 7.32 seconds; existing large-chunk advisory only.

The first locale probe incorrectly used a query parameter unsupported by this app. The layout matrix was rerun using the actual `playerone.locale` storage setting and recorded the rendered HTML language. The successful rerun replaced those preliminary captures; no nominal query-only locale coverage is claimed.

## Evidence

Raw results: `scratchpad/qa/hero-login/results.json`.

- `scratchpad/qa/hero-login/hero-1440-normal.png`
- `scratchpad/qa/hero-login/login-1440-600-vi.png`
- `scratchpad/qa/hero-login/login-375-812-zh.png`
- Other viewport/language and hero lifecycle screenshots in the same directory.

These are browser viewport and focus measurements, not a physical-device performance certification. All contexts closed.

## Deployed acceptance

**Cloud PASS** on Railway deployment `530d8f8a-f25e-4518-a8af-c1585613471b`. Ran `$env:QA_DEPLOYMENT='530d8f8a-f25e-4518-a8af-c1585613471b'; node apps/console/scripts/hero-login-cloud-qa.mjs` against `https://playerone-web-production.up.railway.app`.

At 375 reduced motion and 1440 normal motion, the settled hero had the black slogan display:none, white title opacity1, and no active/pending story flags. Login started at scrollY0 with visible title and zero horizontal overflow. At1440x600 both panels measured720px wide and748.09px high; natural document scrolling accommodates the form. At375 the compact film precedes the form. Actual Tab traversal reached all four credential fields and Submit, each fully within the viewport when focused. The browser's subsequent body focus after leaving the page's last control is not a hidden form control.

Real administrator and finance form logins each returned200 and entered the dashboard. Language persistence, role-specific payment GET access and logout passed; detailed results are in `dashboard-language-payment-qa-2026-09-10.md`. No page errors or financial mutation attempts. No secrets recorded. All browser contexts closed.

Evidence: `scratchpad/qa/hero-login/cloud-results.json`, `cloud-hero-375.png`, `cloud-hero-1440.png`, `cloud-login-375.png`, `cloud-login-1440.png`. Public health check returned ready:true.
