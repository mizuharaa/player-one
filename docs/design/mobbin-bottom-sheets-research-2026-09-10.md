**Mobbin research: PlayerOne dashboard bottom sheets**

Inspected **19 screen examples across 19 apps**, plus **seven image previews from two flows**. Best fits: Chime/PayPal for financial review, Asana/Revolut for date selection, Monarch for mobile filters, and Uniswap/Vimeo/Mercury for desktop alternatives. Preserve PlayerOne’s accepted dashboard layout; adapt only the task surfaces.

**Tool discovery and actual calls**

Discovery through the session’s tool registry exposed:

- `mcp__mobbin__search_screens`
- `mcp__mobbin__search_flows`
- `mcp__mobbin__search_sections`

All nine Mobbin calls below succeeded; no authentication error occurred. No separate detail, screenshot-fetch, or video tool was exposed. **I inspected the inline images returned by screen and flow searches**, not just their metadata. Section search was available but unnecessary.

All calls used `image_format: "jpg"` and the same task intent: “Research bottom sheets and desktop alternatives for a responsive financial operations dashboard.”

| Tool | Platform; limit | Exact query |
|---|---|---|
| `search_screens` | iOS; 5 | Bottom sheet reviewing a payment with amount recipient and confirm payment button |
| `search_screens` | iOS; 5 | Bottom sheet date picker calendar with selected date and confirmation button |
| `search_screens` | iOS; 5 | Bottom sheet filters with selected options reset and apply results button |
| `search_screens` | Web; 1 | Wise review transfer dialog with recipient amount fees and confirm button |
| `search_screens` | Web; 1 | Analytics dashboard date range picker popover with start end calendar and apply button |
| `search_screens` | Web; 1 | Financial transactions dashboard filter popover with status options |
| `search_screens` | Web; 1 | Payment confirmation modal dialog showing amount recipient cancel and confirm buttons |
| `search_flows` | iOS; 1 | Chime sending a payment to a recipient and reviewing the amount before paying |
| `search_flows` | iOS; 1 | Monarch filtering transactions by selecting filter options and applying filters |

**Screen evidence**

Each app name links to its canonical Mobbin screen; each **image** link references the returned screenshot.

“Compact,” “medium,” and “tall” are **visual estimates**, excluding the Mobbin attribution strip—not pixel measurements or implementation specifications. “No visible” means absent from the inspected frame, not necessarily unavailable in the app. Bottom action placement alone does **not** establish sticky positioning. Clipped content suggests scrolling but does not prove it.

| # | Example and screenshot | Directly observed | Interpretation / limits |
|---|---|---|---|
| 1 | [Chime: payment review](https://mobbin.com/screens/01aff7e9-7b5a-43ac-9266-5a7495767d41) · [image](https://mobbin.com/api/mcp/short/EgwXhAcI) | Handle, back chevron, “Let’s review”; recipient, amount, note and funding rows; “Pay $1” below details; dimmed dashboard. | Medium sheet. Excellent amount-specific primary action. No explicit close/cancel; all review rows fit in this frame. |
| 2 | [Cash App: payment review](https://mobbin.com/screens/465186f4-ac1f-4781-9c99-a4926edaaafc) · [image](https://mobbin.com/api/mcp/short/rJhpaG19) | Handle/back; large amount and recipient; selected funding source near bottom; irreversible-payment warning above black “Pay”; darkened green backdrop. | Tall sheet with substantial empty space. Borrow warning placement, not its height or decorative “Style it” action. |
| 3 | [Binance: confirm payment](https://mobbin.com/screens/6904ae7e-e588-4842-812a-5cad54c6b141) · [image](https://mobbin.com/api/mcp/short/yqTej3fB) | Centered heading, X, no visible handle; recipient/amount card, funding account and currency; red warning; yellow “Confirm”; dim backdrop. | Tall review sheet. Red denotes warning, not a destructive button. Generic “Confirm” is less explicit than amount-specific payment copy. |
| 4 | [Careem: transfer review](https://mobbin.com/screens/2c3a0623-cee2-425e-90e7-20883f0bfe6a) · [image](https://mobbin.com/api/mcp/short/LIrE8dmn) | Handle, recipient/amount, selected Visa with “Change,” Face ID statement, full-width transfer action; dimmed review page. | Compact summary. No visible close/cancel. Its Face ID claim belongs to Careem and supplies no security evidence for PlayerOne. |
| 5 | [PayPal: review](https://mobbin.com/screens/e05c5f89-4e79-4d86-88e2-eee948c902f5) · [image](https://mobbin.com/api/mcp/short/Oio13jYx) | Back and X surround “Review”; funding/type rows, protection caveat, fee, bold total, delivery estimate; black “Send”; dim backdrop; no handle. | Medium sheet. Strong fee/total hierarchy and explicit dismissal. Delivery/protection statements require product-specific evidence. |
| 6 | [Asana: date selection](https://mobbin.com/screens/85464f79-8b7d-4582-a185-86571b3f1e2f) · [image](https://mobbin.com/api/mcp/short/2C3YotA7) | Handle, Cancel, clear icon, Today/Tomorrow/Next Monday presets, month arrows, blue selected day, muted More and blue Done; dim backdrop. | Tall sheet. Best mobile example of explicit cancel plus commit. Muted controls do not establish programmatic disabled state. |
| 7 | [Blackbird: select dates](https://mobbin.com/screens/5f95e1c3-6845-441a-a5ca-066c914be906) · [image](https://mobbin.com/api/mcp/short/hPlvAtJ4) | “Select Dates / Select up to 4”; two highlighted dates, month arrows and Done; handle; underlying reservation sheet remains visible with its own X. | Tall, stacked sheets. Selection limit is clear; dismissal ownership is ambiguous because the visible X belongs to the underlying surface. |
| 8 | [pliability: start date](https://mobbin.com/screens/7c16bbbc-69a2-4420-848e-c6b398d47712) · [image](https://mobbin.com/api/mcp/short/ibwb5FQn) | Dark calendar over heavily dimmed page; white selected day, muted earlier dates, month navigation; separated bottom “Select Date” action. No visible handle/X/cancel. | Medium-to-tall. Clear selected state; weak visible exit affordance. Neither date restrictions nor sticky behavior were interaction-tested. |
| 9 | [Revolut: start date](https://mobbin.com/screens/82db7ac9-4a68-4aca-b027-a7427b33f4e9) · [image](https://mobbin.com/api/mcp/short/zSnQDXQi) | Handle, “Start date,” current date and Reset, month arrows, blue selected date; white Set button; darkened background. | Tall. Good field-specific title and reset separation. No visible cancel/X; Reset should not be treated as dismissal. |
| 10 | [Shopee: reminder date](https://mobbin.com/screens/41b5bf15-ea19-42b3-96c9-3d5aa04282a3) · [image](https://mobbin.com/api/mcp/short/am8cPOoS) | “Choose Reminder Date,” X, numbered day grid, selected 15, “Popular” labels and orange Confirm; dimmed bill page; no visible handle. | Medium sheet. This is day-of-month selection, not a complete dated calendar. Popularity labels would be inappropriate for financial date accuracy. |
| 11 | [UNIQLO: filters](https://mobbin.com/screens/6c59a300-a831-4c21-9a54-5db3f842c5ff) · [image](https://mobbin.com/api/mcp/short/3mDseEm1) | Handle, Filter/Reset header; collapsed categories with plus icons; explanatory note; divided bottom region containing result count and Apply; dim backdrop. | Tall. Useful grouped disclosure and action separation. No selected options or explicit close visible; expansion/scrolling unverified. |
| 12 | [Zocdoc: filters](https://mobbin.com/screens/fd867c2b-ec2a-498f-a5f6-376f353b5b4d) · [image](https://mobbin.com/api/mcp/short/7lM2lfDq) | X, section headings, radio-style distance/visit choices with counts; Clear all and yellow “Show 418 results” below divider; dim background; no handle. | Nearly full-height. Useful result-oriented CTA if count is current. The captured radios show no selected mark; footer persistence unverified. |
| 13 | [Monarch: transaction filters](https://mobbin.com/screens/0e67293e-fade-4311-811f-e3efc8f7b230) · [image](https://mobbin.com/api/mcp/short/VVGzFY2K) | Filters/X header; grouped radio choices with orange selections, section Clear, bottom Clear all/Apply; lower row clipped; underlying sheet edge visible; no handle. | Nearly full-height. Strongest domain match. Clipping suggests a scrollable body with separate actions; still frames do not prove its implementation. |
| 14 | [Google Maps: filters](https://mobbin.com/screens/532e2fc3-0a63-46a1-a85a-45f8e95fcbd4) · [image](https://mobbin.com/api/mcp/short/VCL7Q9Gd) | X/title; selected price chips include checks; selected rating/hours segments; cuisine grid partly clipped above Clear/Apply bar; layered sheet edge; no handle. | Nearly full-height. Checkmarks strengthen selection communication. Dense cuisine grid is a poor fit for compact operational filters. |
| 15 | [Lex: multi-select filter](https://mobbin.com/screens/a172c33a-d1bb-48ca-8315-063cf26190c2) · [image](https://mobbin.com/api/mcp/short/6yWqOfCq) | X/title/Clear; bordered list with two checked selections; final row clipped; separate green Apply; dim background; no handle. | Tall. Useful explicit multi-selection and clearing. Clipping suggests list overflow; scroll behavior and sticky footer are unverified. |
| 16 | [Wise: desktop transfer review](https://mobbin.com/screens/ced7c24f-5381-4d74-8c7c-313b54f94540) · [image](https://mobbin.com/api/mcp/short/hCaChJI7) | Full-page review, step indicator, top X; large recipient amount, aligned detail rows, funding source, Send now; no overlay/backdrop. | Search returned a **page, not a dialog**. Useful evidence for focused desktop review, but replacing PlayerOne’s accepted layout is out of scope. |
| 17 | [Vimeo: desktop date range](https://mobbin.com/screens/3de2cbeb-e6c0-42c4-a0c9-9123a6147b0c) · [image](https://mobbin.com/api/mcp/short/Z6bMaBgY) | Popover beneath date control; presets, labeled start/end fields, two calendars, highlighted range, Clear/Apply; shadow and undimmed dashboard; no X. | Strong desktop reference. Text fields are visible; native input type, keyboard behavior and outside-click dismissal are unknown. |
| 18 | [Mercury: desktop amount filter](https://mobbin.com/screens/4b9388c2-b8a0-40b0-ae7a-ac85cfc0d0ae) · [image](https://mobbin.com/api/mcp/short/RZCFDXSL) | Anchored Amount popover over transaction table; Direction radios with Any selected; exact/minimum/maximum amount fields; shadow, undimmed background; no footer/X. | Strongest desktop operations match. Result is an amount filter, not requested status filter. Immediate application cannot be inferred from absent Apply. |
| 19 | [Uniswap: desktop send review](https://mobbin.com/screens/41094cec-82c9-436e-884c-a8e5a3045157) · [image](https://mobbin.com/api/mcp/short/uE32YEGQ) | Compact centered dialog; Review send, help/X, amount/token, abbreviated recipient, network-cost row and Confirm send; dim backdrop; no handle. | Strong desktop modal form. For PlayerOne, preserve sufficient recipient identification and verified fees; avoid copying address truncation blindly. |

**Flow evidence and behavior limits**

- [Chime — Paying someone](https://mobbin.com/flows/6f817521-5024-49ab-baee-2f77f048c419): metadata listed 11 screens; I inspected returned previews **1, 4, 8 and 11**. Preview [4](https://mobbin.com/api/mcp/short/KVafwuSJ) shows amount entry and Next; preview [8](https://mobbin.com/api/mcp/short/xYeLvO5I) retains review details while the primary action reads **“Paying…”**. Preview [11](https://mobbin.com/api/mcp/short/vNvET1K7) shows a payment under **Unclaimed payments**. This supports distinct submission and subsequent status displays—not a claim of final settlement.
- [Monarch — Filtering transactions](https://mobbin.com/flows/7316be7d-a6b8-4cee-985d-d1a6eb49eb08): metadata listed six screens; I inspected returned previews **1, 4 and 6**. Preview [4](https://mobbin.com/api/mcp/short/W7dIqx5b) shows selected filters and Apply. Preview [6](https://mobbin.com/api/mcp/short/CZnEjiVf) shows a **two-filter badge** and “You reviewed everything!” empty state. The sequence supports visible filter-state feedback; that completion wording should not be copied to PlayerOne without corresponding evidence.

Neither flow’s inspected previews or metadata demonstrated swipe-to-dismiss, drag detents, backdrop dismissal, scroll transitions, focus behavior or animation.

**Five reusable patterns recommended for PlayerOne**

| Pattern | Small screens | Desktop | Required semantics |
|---|---|---|---|
| **Financial review** — Chime, PayPal, Uniswap | Content-sized sheet; title and explicit Cancel/close; recipient, exact amount/currency, authoritative fees/total where applicable; specific primary action. | Bounded centered dialog for short reviews; existing detail area/inline panel for longer inspection. | Preserve operator-only access and server authorization. Opening, dismissing or changing selection never executes payment. |
| **Single-date selection** — Asana, Revolut | Compact date surface with labeled value, selected date, Cancel and Set; optional useful presets. | Native date input or anchored picker near its field. | Preserve native keyboard/date behavior. Reset, clearing a value and canceling edits must have distinct meanings. |
| **Date-range selection** — Vimeo | Labeled start/end fields with a single-calendar layout if a custom picker is necessary. | Anchored popover with fields, presets and calendars where space permits. | Validate ordering and explain date boundaries/time zone. Keep draft selection separate from applied dashboard range. |
| **Grouped filters** — Monarch, UNIQLO, Mercury | Sheet with labeled groups, draft selections, Clear all and Apply; bounded scrolling body for long forms. | Anchored popovers for individual filters; inline panel for larger combinations. | Cancel discards drafts; Apply updates the query. Display active filters and an accurate count only when available. |
| **State and action continuity** — Chime flow | Keep review context visible during submission; reserve stable space for progress/error/status. | Same state model in dialog or panel. | Prevent duplicate submission while pending. Unknown outcomes remain unknown until reconciled with authoritative status; retry must respect existing payment safeguards. |

For modal sheets/dialogs, require an accessible name, focus containment and restoration, background inertness, explicit cancel/close, and Escape behavior. Closing a pending-payment surface must not imply cancellation of a submitted transaction. Nonmodal popovers/inline panels need appropriate keyboard navigation and focus return without indiscriminately trapping the whole dashboard.

Use comfortably sized touch controls, safe-area spacing and visible focus. Account for virtual keyboards and zoom when bounding height. Reduced motion should remove unnecessary sliding or bouncing; a handle must never be the only dismissal affordance. These are **proposed requirements**, not accessibility capabilities verified in the Mobbin examples.

**Pitfalls and bounded application proposal**

- Avoid nested sheets like Blackbird’s for payment work: keep the current task and its dismissal controls unambiguous.
- Do not copy tall mobile layouts or handles into desktop dialogs. Keep ordinary desktop filters near their triggers and preserve table context.
- Distinguish financial commitment from destructive actions. “Clear filters” is reversible query editing; “Cancel” exits editing; “Pay” commits money. Do not reuse payment styling or confirmation copy for deletion.
- Do not infer success from a closed overlay, an empty filtered list, elapsed time or a green icon. Do not transplant security/protection claims, sample balances, popularity labels or delivery promises.
- Treat counts and previews as data-dependent. Show truthful loading/error states rather than stale numbers presented as current.

A bounded future application would cover **three existing entry points only**: payment review, dashboard date selection and dashboard filters. Preserve dashboard navigation, layout and deliberate operator-only payment access. Use the same underlying draft/applied state across responsive presentations. Introduce no automatic payment execution.

Before accepting any implementation, verify keyboard-only open/cancel/restore, Escape, narrow screens with keyboard and zoom, reduced motion, long content with reachable actions, unchanged filter drafts after cancellation, and authoritative payment handling for pending, rejected and uncertain outcomes. **No implementation or QA was performed here.**

**Exact limitations**

Research used seven Mobbin screen searches and two flow searches; no pagination or video inspection. All 19 selected screenshots and seven returned flow previews were visually inspected; other flow screens were metadata-only. No pixel measurements, live interaction tests, DOM/accessibility inspection or backend verification occurred. Screenshot links are supplied by Mobbin and documented to expire after 30 days; canonical screen/flow links are included for durable reference.

No web search, memory research, browser automation, agents, repository inspection, credential/config reads, product/backend requests, installations, edits, commits or deployments were used. Two read-only Impeccable guidance files informed responsive analysis. No files were written.