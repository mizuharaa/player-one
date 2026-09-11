# Mobbin reference research — 2026-09-09

**Reference search only. No UI copying.** Every entry records a pattern and the
evidence for it. Nothing here authorises reproducing another product's layout,
branding or artwork. Where a pattern conflicts with our product truth, the
conflict is stated rather than resolved in the pattern's favour.

Collected by Claude (QA role) via the Mobbin MCP, for the competitor
feature-benchmarking pause before web-first / mobile-refinement resumes.

---

## A. Task marketplace — browsing available work

The closest analogue to our task hall. **Airtasker is the strongest match**: our
domain is real-world physical tasks claimed before work starts, which is its
exact shape.

| App | Link | What is worth taking |
|---|---|---|
| Airtasker | https://mobbin.com/screens/739fe201-53a2-4a1c-b6ef-d92b3e786614 | Price is the largest element on each row, right-aligned, baseline-aligned with the title. Location / date / flexibility as three icon-led metadata lines. Status word ("Open") plus offer count as the only footer. Five-tab bar: Get it done, Browse, My tasks, Messages, Account. |
| Airtasker (pull-to-refresh) | https://mobbin.com/screens/74047492-14bf-4421-be06-84f84960c6db | Refresh affordance on a live queue — relevant because our hall competes for a finite number of claimable tasks. |
| Grab Driver | https://mobbin.com/screens/f780220a-8a36-410b-a3ab-11de269e8c28 | Shift rows with time range, zone label and bonus value; "Browse / My Bookings" two-tab split. Closest to a shift-shaped rather than listing-shaped hall. |
| Angi | https://mobbin.com/screens/b2b7bce6-aaf1-4b0a-85fa-48e79f488f49 | Category-first entry: icon tiles above a carousel, each carrying a "from $X" price flag. |
| Shopee (home services) | https://mobbin.com/screens/c6c8e887-a622-4bbb-b11b-c434e3a1f968 | SEA pricing presentation — "from Rp70,000" under a photo tile, grouped by service family. Useful for VND formatting density. |
| Upwork | https://mobbin.com/screens/fcd45285-5422-4a01-86d1-02add8380c9c | Verification badge on the payer, budget band, skills chip row, and an "Action required: verify your identity" banner. |
| inDrive | https://mobbin.com/screens/04a7e279-f437-4656-b82e-c6c2f9fab3a9 | "How do you want to get income with us?" — role selection as illustrated rows. Relevant to collector onboarding, not the hall. |

**Independent corroboration of an existing finding.** A prior audit found our
TaskHall unit price rendered at 13px right-aligned, visually identical to a
"2/5 claimed" counter. Every marketplace above sets the money as the largest or
second-largest element in the row. That finding now has outside evidence.

**Boundary:** these apps run *bidding and offers*. Ours does not — a recording is
claimed against a declared task before the camera is switched on. Do not import
an offer/bid model.

---

## B. Device pairing — request, connect, confirm

Our Ego camera pairs over BLE. **BLE is currently mocked** (`MockDeviceTransport`,
no native module), so these inform the eventual real flow.

| App | Link | What is worth taking |
|---|---|---|
| GoPro Quik | https://mobbin.com/screens/1a984b04-43fa-4351-a5e5-11113b9d1e2a | Nearest hardware analogue, an actual camera. Shows the device's own screen state (a numeric code) beside the OS pairing dialog, so the user can match physical device to prompt. |
| WHOOP | https://mobbin.com/screens/a759d26d-d2a0-4ae6-a0ac-24dc437e1b31 | Names the physical indicator: "A blue light will appear on the side". Our band has a green LED; the technique transfers directly. |
| Hatch Sleep | https://mobbin.com/screens/15b22160-0cc1-482b-96a3-5448c681000e | "Press and hold the pairing button until the green light appears." One instruction, one action, one primary button. |
| Rivian | https://mobbin.com/screens/e0139a9d-e561-4d08-9b51-4c6dc1154091 | Line-drawn device-to-phone proximity diagram with a step counter (02/02). Illustration rather than a photograph avoids dating the hardware. |
| IKEA Home smart | https://mobbin.com/screens/cabb0793-c829-4915-8604-43d198747997 | "Quick-press the pairing button 4 times", inline video, and a literal confirm button: "The light is blinking". Confirmation is the user reporting device state back. |
| Philips Hue via Alexa | https://mobbin.com/screens/9d2395ba-68d7-4721-8d00-943df908679c | Numbered preconditions listed before the connect button is offered. |
| Eight Sleep | https://mobbin.com/screens/7047e51a-57c3-4ec6-8f82-21a562e3854c | Failure path first: a checklist with two exits, "My Hub is flashing blue" / "is not flashing blue". |
| Oura | https://mobbin.com/screens/99bc11da-7ba1-40e0-9ed6-c6a8c62698c4 | Identity confirmation before connect — product, finish, size, plus "This is not my Oura Ring". Directly relevant: our devices bind to one person and a mis-bind is a payout problem. |

**Pattern worth adopting, evidenced by six of eight:** state the *physical* signal
the user should see (LED colour, blink pattern) and give an explicit "it is not
doing that" branch. Our Provisioning screen currently has neither.

---

## C. Income and payout history

Our `/api/me/income` returns **history, not a balance.** Read this section with
that in mind.

| App | Link | What is worth taking |
|---|---|---|
| DoorDash Dasher | https://mobbin.com/screens/63f22cfd-d488-4c4a-9e89-8299ca8ec389 | Period total as the hero figure with its *inputs* beneath ("Active 26 min · Dashed 27 min"), then a bar history and a dated row. Our analogue: approved minutes to dong. |
| Gusto Mobile | https://mobbin.com/screens/fe28fe32-1331-4dad-8873-137abcbbdb4c | A stacked bar decomposing gross into parts with a legend, then "Review paycheck". The clearest model for showing how a figure was arrived at. |
| Airtasker | https://mobbin.com/screens/7d4cc019-c73d-4c46-a3b6-13da6fd846ad | "Earned / Outgoing" segmented control plus an all-time date filter. |
| Turo | https://mobbin.com/screens/304ac9ba-26c6-4263-ad55-a9767a209de5 | Earnings split by *reason* with a colour key, each row carrying a help affordance. Relevant to explaining why approved minutes differ from recorded minutes. |
| Upwork | https://mobbin.com/screens/ff243763-82e0-41a1-b63c-4d8c27fea8ba | 12-month earnings, transaction-history link, and an explicit staleness note: "Stats are not updated in real-time and may take up to 24 hours". |
| Whatnot | https://mobbin.com/screens/4d932004-a030-498c-869a-2cb0f70d218d | Balance split into available / processing / not-yet-eligible, with the blocking action surfaced ("Complete Seller Verification"). |
| Upside | https://mobbin.com/screens/80655bd1-5294-4e00-a312-bcec46901713 | Rows carrying a "Processing" chip *instead of* a number — a truthful way to show a payment that has not settled. |
| GoPay | https://mobbin.com/screens/4d1a1a8d-c2ec-496b-8c3f-48ec87e92ea8 | SEA formatting: "Rp59.000" totals, weekly chart, transaction rows with reference IDs. Useful for VND density and reference display. |
| Airbnb | https://mobbin.com/screens/38a4bdf6-3733-4ec9-8276-819f864bc5dc | Blocking prerequisite stated above the earnings figure ("Add a payout method"). |

**Two patterns that suit our contract, one that does not.**

- **Suits:** the Gusto/Turo decomposition — showing *how* a figure was reached.
  Ours is recorded minutes, then reviewed, then approved effective minutes, then
  dong.
- **Suits:** Upside's "Processing" chip and Upwork's staleness disclaimer. Both
  are honest ways to present a number that is not final.
- **Does not suit:** a single "available to withdraw" balance. We have no wallet.
  Presenting one would fabricate a figure on a payout-bearing product.

---

## D. Landing / hero / technology (desktop, from earlier passes)

Recorded here so the reference set sits in one place. Images are in `.refs/`
(full size) and `.refs/small/` (downscaled — use these; a reviewer exhausted its
input window on the originals).

| Site | Pattern |
|---|---|
| Flim | Huge stacked display type, hairline grid, floating UI chips overlapping the headline, flat geometric accents, edge-to-edge photo mosaic, mono micro-labels. The current `/discover` language. |
| Fixa | The three-beat opening: slogan alone on near-white, type pans up, video frame reveals beneath. |
| Klarna | Full-width wordmark at the page foot above a thin legal line. Built in `fc84a98`. |
| Poly | Hero illustration register; feature mosaic of wildly unequal tiles with numbered labels. |
| Figure AI | Full-bleed split video panels, caption bottom-left. |
| Daylight | Numbered process strip on an editorial ground. |
| Taste Labs | Section rhythm; idle motion between UI elements. |

**Mobbin has no robotics category.** A direct search for robotics/hardware
landing pages returned **zero screens**. Fauna Robotics exists as a curated site,
but there is no genre to generalise from — so any claim about "what robotics
landing pages do" has no evidence behind it on this tool, and I am not making
one.

---

## E. Standing constraints this research does not override

1. **No invented balances.** No wallet exists in the API. `/api/me/income` is
   history.
2. **No Chinese KYC flow.** Collector identity runs through Zalo by an explicit
   2026-08-29 decision recorded in `CLAUDE.md`.
3. **No replacing the human-review contract.** Payment is per reviewed, approved
   effective minute, decided by a person. No pattern implying automatic
   acceptance or instant payout may be imported.
4. **No UI copying.** Layout ideas and information hierarchy only — not branding,
   artwork, or distinctive component treatments.
