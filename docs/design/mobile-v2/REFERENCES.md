# Reference research — collector app v2

Two passes over Mobbin (iOS), 30 searches, every returned screen looked at rather
than read off its metadata. Part A is splash → welcome → phone signup → OTP →
login → account setup → guided tour → permission priming. Part B is earnings
dashboards, task lists and detail, upload progress, floating tab bars, and the
empty / loading / error states.

The owner's own named references were found and are cited in place: Future Pro
(welcome and home), Rodeo, Glovo (login), Oura, Lifesum, Claude and Shop
(splash), Corner, Cash App (phone → code), and Klarna (home).

## The ten findings that changed the spec

Written first because these are the ones that overruled a draft decision.

1. **The money figure is anchored by size, not by colour.** Label ~13 pt, figure
   40–48 pt, body 15–17 pt — a 3× jump. Every app in the pass that coloured the
   number instead of enlarging it looked cheaper. → SPEC §0.3's type scale, and
   §10's `fontSize.3xl` cycle figure.
2. **Nothing puts the primary money figure inside a coloured box.** The figure is
   plain text on the card's own ground; colour goes on the *context* line beside
   it. That is the anti-crypto rule, and it overruled a first draft that had the
   Income cycle total on a plum field. → SPEC §10, §14.
3. **A per-unit rate is an inline size split on one line**, never two: `From
   $25.65` at 20 pt beside `per person` at 13 pt grey (Viator, Airbnb, Peerspace,
   Urban Company). → SPEC §10's price box, §12's detail price.
4. **On a photograph, the price is a chip burned into a corner** (Peerspace's
   `⚡ from $95/hr`), with any second badge in the *opposite* corner so the two
   never collide. That is where a coloured price box is legitimate — it needs a
   ground to be legible on. → SPEC §10's task card.
5. **Lugg shows a base plus a rate together** (`$37.23 + $0.95 per min labor`) —
   the only literal per-minute precedent in the pass, and the closest thing that
   exists to PlayerOne's payable-minute story.
6. **One question per screen.** Screens that stack two inputs always group them
   visually into one object (Snapchat's country + phone). → SPEC §5 pre-fills and
   locks the phone so registration asks one thing.
7. **Every headline is a sentence or a question, never a label.** "Can we get your
   number?" not "Phone number". → SPEC §3, §4.
8. **Every screen pre-announces what happens next** — the code that will arrive,
   the OS dialog that will fire, the word on the button to tap. The single most
   transferable habit in the pass.
9. **Legal copy is positionally coded**: *below* the CTA on a welcome screen,
   *between the field and the CTA* on a signup screen. 11–12 pt grey, with only
   the link phrases underlined. → SPEC §2 vs §3.
10. **Loading lives inside the control that triggered it** (Lugg's CTA spinner,
    Zomato's spinner in the last OTP box), never as a full-screen overlay. →
    SPEC §17.

Plus one structural warning worth repeating: a floating tab bar needs bottom
content padding equal to the bar's height *plus* its inset, or the last row of
every list is permanently unreachable. The app already solves this with
`measureTabBar()`; the restyle must not lose it.

## What PlayerOne takes, in one line each

| Area | Copied from | Exactly what |
|---|---|---|
| Splash | Glovo, Claude | Flat brand ground, centred wordmark at ~40 % width, a quiet attribution line in the bottom safe area, no spinner |
| Welcome | Future Pro, Oura | Full-bleed portrait film, wordmark centred at top, display headline bottom-left, stacked pill CTAs, policy line below them |
| Phone sign-in | Glovo, Lifesum | Brand hero on top, rounded surface sheet overlapping it, country chip + number as one grouped object |
| Verification | Cash App, Zomato | Number echoed back, six flex boxes, auto-submit on the last digit, plain-text countdown beside a greyed resend |
| Registration | Snapchat | Two fields grouped as one object, the known one pre-filled and locked |
| Agreements | Oura | Six switch rows, one pinned commit, no master "accept all" |
| Coach marks | Glovo, ShopBack | Numbered steps, a measured hole, the card on whichever side has room, a quiet skip |
| Home | Future Pro, Klarna | Greeting block, one large money figure anchored by size, big rounded image cards, floating pill bar |
| Task hall | Peerspace, Airbnb | Image-led grid, price as a corner chip on the photo, aspect-ratio boxes with cover crop |
| Task detail | Viator, Peerspace | Hero image, inline rate split, one full-width primary action pinned at the bottom |
| Uploads | YouTube, DoorDash | Progress inside the list row, a fixed four-node stage timeline, minutes shown under the money |
| Income | Cash App, Wise | Expand-in-place rows, payout destination as two chips joined by an arrow, verification warning *above* the amount |
| States | Grab, Shop | Skeletons where the layout is known, chrome never skeletons, three error tiers, retry always primary and literally "Try again" |

---

# Part A — splash, welcome, auth, onboarding


---

## 1. Splash Screen

**Shared structure**
- One flat colour edge-to-edge, no gradient, no photo. Grab is pure brand green, Glovo pure brand yellow, Too Good To Go teal, CLEAR navy, Viator green. NordVPN inverts it: near-white ground, dark mark.
- The lockup sits at optical centre — roughly 45–48% down the screen, not geometric 50% — and occupies 35–45% of screen width. Nothing else is on the canvas.
- Wordmark-only or mark-above-wordmark. Grab and Viator are wordmark alone; CLEAR and NordVPN stack a small mark above a letterspaced/heavy wordmark with tight leading between them.
- No spinner, no progress bar, no tagline. The only exception is a tiny attribution line at the very bottom safe area: Evernote runs "Made with ♥ by Bending Spoons" in ~11px grey, which is exactly the Claude "by" line the owner cited.
- Status bar stays visible and tinted to contrast; several apps dim it (NordVPN, Breathwrk) so the mark owns the frame.

**Copy this one:** Glovo's solid-brand-colour + centred contrast wordmark. On a cheap Android a flat fill paints instantly with zero decode cost, has no image asset to download, and survives any screen density. Use plum on paper-beige (or the inverse) so the first paint is the brand, not a white flash.

- [Grab](https://mobbin.com/screens/072416c3-4e78-4dbb-bcb8-2530a4328a49) — steal the proportion: wordmark ~40% of width, dead centre, absolutely nothing else.
- [Glovo](https://mobbin.com/screens/78e3a230-a46c-4121-8a9a-f9dfc84def0c) — steal the two-colour logic: saturated ground, logo in the second brand colour, not white.
- [NordVPN](https://mobbin.com/screens/a3adafbf-a7c7-44d1-86ce-ed1e6fbba22d) — steal the light-ground variant: off-white field, dark stacked mark, dimmed status bar.
- [CLEAR](https://mobbin.com/screens/76e6d254-e857-4483-9b83-7d531153437b) — steal the stacked lockup spacing: mark, generous gap, letterspaced wordmark.
- [Evernote onboarding flow](https://mobbin.com/flows/4f4d734f-364e-4506-917e-6a5a17fbadff) — steal the bottom attribution line; screen 1 is the Claude splash pattern exactly.

---

## 2. Welcome & Get Started

**Shared structure**
- Two families. (a) Full-bleed image/video with the type block pinned to the bottom third over a dark scrim — Future Pro, Oura, Lifesum, Strava, Klima, Cleo. (b) Flat warm ground with oversized display type doing all the work — Rodeo, Tolan, Fabric.
- In family (a) the media takes 60–75% of the height; the wordmark sits centred in the top safe area at ~14–16px; the headline is 28–34px in 2–3 lines, left-aligned, with a 15px grey/white sub of 1–3 lines directly under it.
- CTA is always the last element above the home indicator. Full-width pill is the default (Strava orange, Lifesum green, TIDE white). Future Pro is the outlier: a *hug-width* pill aligned left under the headline, which reads calmer and less like an ad.
- Secondary action is either a second stacked pill (Oura: filled cream → outlined → bare text "Explore"; Lifesum: CREATE ACCOUNT then LOG IN) or a bare text link ("Log in" under TIDE's Start). Side-by-side only when the two are equal weight (adidas, PayPal).
- The policy line is 11–12px, centred, two lines max, underlined link phrases, sitting *below* the CTA — Rodeo and Lifesum both do this. It never appears above the button on a welcome screen.
- The accent highlight appears exactly once per screen: pliability's lime pill plus lime tick bullets, Klima's single green word inside a white headline.

**Copy this one:** Rodeo's flat-cream + giant display + black full-width pill + policy line under. No video to buffer on a 3G connection, no photo licensing, the headline can run long in Vietnamese without a scrim fighting it, and the single dark pill at thumb height is the largest possible tap target. Keep Future Pro's centred wordmark at the top for identity.

- [Rodeo](https://mobbin.com/screens/0918d7b7-2c6f-4848-b8dd-6ffd632674bd) — steal the whole skeleton: 4-line display headline with one italic line, muted 2-line sub, black full-width pill with trailing arrow, 2-line policy centred beneath.
- [Future Pro](https://mobbin.com/screens/4efce9ad-d226-4431-aa55-257f6d548677) — steal wordmark-centred-top + bottom-left headline + hug-width light pill; the restraint is the point.
- [Oura](https://mobbin.com/screens/d3a8e68c-35c7-4f71-8727-508696a392c1) — steal the three-tier button stack (filled / outlined / bare text) for "Đăng ký / Đã có tài khoản / Tìm hiểu".
- [Lifesum](https://mobbin.com/screens/8f8af2e3-1734-4c91-b4b6-eb84e199c450) — steal the photo → headline → sub → two stacked CTAs rhythm and the policy placement.
- [pliability](https://mobbin.com/screens/7c92f3be-6fa7-4eee-95ab-4d92904ac1ff) — steal the three lime tick bullets as a value-proof block above the CTA; that is where pay-per-minute belongs.
- [TIDE](https://mobbin.com/screens/e9bf30dc-cdcb-40da-81f3-5dd2ce3e5095) — steal white pill + plain text secondary, the cheapest two-action layout that exists.

---

## 3. Signup (phone-number-first)

**Shared structure**
- One question per screen, phrased as a question. "Can we get your number?" (Eventbrite), "What's your phone number?" (Doji, Twitch), "Please enter your phone number" (Public). Headline 24–28px, 1–2 lines, top-left under the nav row.
- A 1–3 line grey explainer under the headline says *why* and *what happens next*: eBay — "We'll text a security code to your mobile phone to finish setting up your account"; Natural AI — "We'll send you a confirmation code to get started."
- The field is either a single bordered row with the flag/prefix inside it (Eventbrite, Public, Wealthsimple) or a two-box row: narrow prefix dropdown + wide number field (Bolt Food, Glovo, Bolt). Instagram skips the picker entirely with a "United States (+1)  Change" text row — the cheapest option for a single-country app.
- Numeric keypad is already up on entry (eBay, Airbnb, Canopi, Snapchat). The CTA therefore sits *just above the keyboard*, not at the screen bottom — Canopi puts the black pill immediately under the field at mid-screen.
- Legal microcopy lives between field and button (Public, Bolt Food, eBay) — 11px grey with linked phrases. This is the opposite of the welcome screen, where it goes under the button.
- Progress is shown as "Step 5 of 5" (Snapchat) or a segment bar; a "Skip" affordance sits top-right when the step is optional (Bolt Food, Eventbrite). PlayerOne's is not optional, so no Skip.
- Error state: red border on the field plus a red sentence directly beneath it, CTA stays disabled (Twitch).

**Copy this one:** Eventbrite's cream-ground single-question layout — back chevron, big question headline, one-line why, one full-width bordered field with the prefix baked in, black full-width pill pinned low. One field and one tap target on the whole screen is what a first-time worker on a 5-inch phone in a noisy street can actually complete.

- [Eventbrite](https://mobbin.com/screens/21b727d3-f92a-45a1-a43e-93742e44d60d) — steal the warm ground + question headline + single tall outlined field + bottom black pill.
- [Bolt Food](https://mobbin.com/screens/0e8a0d1f-f261-4e93-bec2-1ea1df39a6f3) — steal the prefix-box + number-box split and the legal line sitting right above the CTA.
- [eBay](https://mobbin.com/screens/dafe19f2-b36f-4254-9350-28e44d33d755) — steal the explainer sentence that pre-announces the code, and the keypad-up default.
- [Twitch](https://mobbin.com/screens/943d9f96-2809-4a5c-b766-2e93852b8278) — steal the inline error: red border, red sentence under, CTA greyed.
- [Instagram](https://mobbin.com/screens/4ad6c678-38f5-4219-bc2f-99bf45985411) — steal "Việt Nam (+84)  Đổi" as a text row instead of a country picker.
- [Wealthsimple](https://mobbin.com/screens/5ab7a91c-0714-4fd7-b7b6-259a391c6c1d) — steal the trust sentence ("only one account per phone number") as the anti-fraud explanation.

### Legal declarations (the two required ones)

- Patterns: one declaration per rounded card with a control on the right (Oura toggles, Tonal checkboxes); a master "Agree to all" above indented children (foodpanda); "(Required)/(Optional)" prefixes with a chevron to expand full text (Weverse); a "check all boxes" convenience pill (Lightyear); a legal wall followed by two attestation checkboxes (Qantas).
- CTA stays disabled until every required control is on — Lightyear, Weverse and Tonal all show the greyed state.
- [Oura](https://mobbin.com/screens/013bc4ae-a9e4-4856-9dd0-9068ffbd2ca7) — steal one-declaration-per-card + switch; it reads as two decisions, not a wall.
- [Weverse](https://mobbin.com/screens/6eeda494-1077-4eef-ab56-2c8e5f23455d) — steal the "(Bắt buộc)" label and the chevron that expands the full text in place.
- [foodpanda](https://mobbin.com/screens/a77fb4b9-cf63-47ad-9931-6058c27c5f58) — steal the master checkbox with indented children if both declarations ever collapse into one gesture.
- [Tonal](https://mobbin.com/screens/7136ef33-66a1-4ed8-8b27-9ffd735046f1) — closest legal analogue: consent to being video-recorded, one checkbox per paragraph.

---

## 4. Verification (OTP / 6-digit code)

**Shared structure**
- Headline states the fact, not the instruction: "We sent you a code" (Strava, Brick, Substack), "6-digit code" (Revolut). Under it, one grey line naming the masked destination — "•••••••7552", "+1 ···· 7390", "+62 ●●●●".
- Six separate square boxes with 8–12px radius are the norm; Revolut splits them 3 + dash + 3. Shopee uses six underscores. GoHenry and Substack use a single wide field instead — which is what actually plays well with OS SMS autofill.
- The resend control sits directly under the boxes as a timer sentence: "Resend code 55 seconds" (CapCut), "Try again in 00:08" with the "Get a new code" chip greyed until it expires (Strava), "Please wait for 59 seconds to resend" with the numeral in red (Shopee), a centred "00:29 / Didn't receive the code? Resend now" pair (Zomato).
- The submit button is usually present but disabled until six digits land (CapCut, OKX, Brick). eBay removes it entirely and auto-submits on the sixth digit — fewer taps, fewer failures.
- Verifying state is inline, not a screen change: Yami prints "Verifying…" under the boxes, Zomato spins inside the sixth box.
- A help escape hatch is standard at the bottom: "Having trouble? Get help" (Plenty of Fish), "Contact Us" (Yami).

**Copy this one:** eBay's auto-submit — six boxes, masked destination, resend countdown as plain text, no button at all. One less tap on a device where the keypad already covers half the screen, and the ZNS code arrives while the screen is open, so the state change should happen on its own.

- [eBay](https://mobbin.com/screens/5f0a4fd7-745f-498f-851f-888d4e27f994) — steal the no-button auto-advance and the "You can resend security code in 37 seconds" sentence.
- [Strava](https://mobbin.com/screens/58bf7cc5-6943-47b3-8c1d-cec42d67e7fe) — steal the disabled "Get a new code" chip beside a live countdown; it makes the wait legible instead of dead.
- [Revolut](https://mobbin.com/screens/01cbac1a-825e-47e6-97f4-9e6a88c0edcb) — steal the 3+3 grouping with a dash; easier to read a code back off a Zalo notification.
- [Zomato](https://mobbin.com/screens/1f3e08c4-622a-4aeb-8720-a505b7c8bb0a) — steal the spinner-in-the-last-box verifying state and the large centred countdown.
- [GoHenry](https://mobbin.com/screens/9ea89aab-0b48-4604-8311-a34092a6fb69) — steal the single-field variant if autofill reliability beats the six-box look.
- [Shopee](https://mobbin.com/screens/431b5eab-4e26-4e13-ba8a-ef64a0872e5a) — closest SEA analogue: "+62" chip showing the verified prefix, red countdown numeral.

---

## 5. Login

**Shared structure**
- Media hero on top, rounded white/cream sheet below with a large top radius (24–32px) overlapping it. Glovo's hero is ~28% of the height, Lifesum's ~35%, foodpanda's ~50%. The wordmark sits on the hero, not on the sheet.
- Sheet order is fixed: "Welcome" / "Log in" title (centred or left), one-line sub, the input, then the method buttons, then the divider, then fallbacks, then policy.
- Glovo is the reference: Prefix dropdown + Phone number in one row, then two half-width pills side by side — outlined "SMS" and filled green "WhatsApp" — letting the user pick the *delivery channel*, not an identity provider. Then "or with", Google/Apple outlined pills, then "Other methods ⌄", then the policy line.
- Overflow hides behind a text disclosure: "Other methods ⌄" (Glovo), "View more methods" (foodpanda), "Log in with username" (Yubo).
- Returning-user shortcut: TextNow shows "Welcome back 👋 You last logged in with your email x@y" with a single big button and a small "Log In to another account" link.
- Consent sometimes sits *above* the buttons as a toggle (Granola: "I accept the Privacy Policy & Terms" with a switch).

**Copy this one:** Glovo's sheet with the channel pills — relabelled to PlayerOne's reality: one field, then a single filled "Nhận mã qua Zalo" pill. The sheet keeps the brand image visible while putting every control in the bottom 60% where a thumb reaches, and naming Zalo tells a Vietnamese worker exactly which app will buzz next.

- [Glovo](https://mobbin.com/screens/03731b67-ef2c-4644-9bef-f057e3a03637) — steal hero + rounded sheet + prefix/number row + channel pills + policy at the very bottom.
- [Lifesum](https://mobbin.com/screens/ba2ba934-eb10-49f1-85fb-a47ffa771cd8) — steal the cream sheet with four equal stacked full-width pills and a centred 2-line policy.
- [TextNow](https://mobbin.com/screens/0037d4b8-54cc-4eda-9823-10c1edd9bd34) — steal the "you last signed in as ••••123" one-button return path.
- [foodpanda](https://mobbin.com/screens/9f6cd0b9-322a-45b1-a912-7c9c1911a60c) — steal "View more methods" as the collapse for anything beyond the primary route.
- [Granola](https://mobbin.com/screens/aa1568d1-c348-43f5-a547-db681ed0fc1c) — steal the consent toggle placed above the buttons when acceptance must be explicit.
- [Lugg — logging in flow](https://mobbin.com/flows/b10b360c-4b0f-4ebb-b591-ddba0d03cf84) — the whole phone-only login journey in seven screens, with the spinner inside the CTA.

---

## 6. Account Setup / profile completion

**Shared structure**
- A thin segmented or continuous progress bar pinned to the very top, above the headline — Bluesky (4 segments), Alma (10 segments), Deepstash (bar sharing a row with the back chevron), Future Pro (bar at the *bottom* above Back/Continue).
- One task per screen. Headline is a sentence with personality ("Give your profile a face", "Let's get your profile shining!"), a one-line why under it, then the single control.
- Avatar is a large circle (100–140px) centred, with a small edit/plus badge at 4–5 o'clock. Optional status is stated in the label — Notion: "Upload photo (optional)".
- CTA is full-width and disabled until valid (Fi), with a bare text link offering the alternative ("Upload a photo instead", Bluesky).
- When several things must be done, apps switch to a checklist of cards with three states: done = filled check, current = dark numeral or outlined border, future = greyed. Cleo numbers them 1/2/3; Lloyds greys the locked rows; Revolut Business marks each "Requires action" in amber; Airtasker flips radio circles to filled checks as each sub-task returns; Peloton pairs a segmented bar with accordion rows.
- Alma's variant is worth noting: several fields grouped into one white rounded card floating on the cream ground, rather than loose fields on the background.

**Copy this one:** the Cleo/Lloyds gated checklist as the post-signup hub — "Hồ sơ ✓ / Đào tạo (current) / Bài kiểm tra (locked) / Nhận việc (locked)". A gig worker needs to see how many gates remain before the first payout, and the locked-grey state answers "why can't I start yet" without a support ticket.

- [Cleo AI](https://mobbin.com/screens/bae4115d-f0c5-457a-bc4b-4d9abf0a6276) — steal the three-card numbered checklist with done/current/locked states and one Next pill.
- [Lloyds Mobile Banking](https://mobbin.com/screens/5c9cb80e-c411-4f1d-beb7-4daf6dc7699d) — steal the locked-rows-greyed treatment and the outlined "you are here" row.
- [Bluesky Social](https://mobbin.com/screens/4aee6371-1eb4-4897-871d-96c254a1cb0c) — steal the top segment bar + big avatar with edit badge + "Continue ›" plus a text-link alternative.
- [Alma](https://mobbin.com/screens/73e99d70-80ef-4f8d-afba-045b4dc3b6cf) — steal the single white card holding all fields on a cream ground; matches the paper/beige brand exactly.
- [Peloton](https://mobbin.com/screens/57c50407-55a6-411d-9d56-b4d559b30ace) — steal the accordion checklist where only the current step expands, with its CTA inside the row.
- [Airtasker — verifying phone flow](https://mobbin.com/flows/624d4808-9491-41bc-8a07-b8929bbb5716) — steal the "Finish registration" list whose circles fill in as you come back from each sub-flow.

---

## 7. Guided Tour & Tutorial

**Shared structure**
- Two distinct mechanics. (a) Anchored coach mark: the live screen washes out, a small card with a pointer tail sits next to the element it describes, the rest of the UI is untouchable — Mesh (card aimed at a tab-bar icon), monday.com (blue tooltip pointing at the + FAB).
- (b) Modal "how it works" card: a screenshot or photo on top, then 3 numbered rows (circle numeral + one sentence), then a single dismiss pill — Tabby, Zip, Singapore Airlines, Hatch Sleep, Speak.
- Position is always tracked and visible: "3 of 3" inside the tooltip (monday.com), "1/4" chip in the nav bar (Posh), numbered pills 1–4 with the current one filled (NGL), page dots (Hatch Sleep), ‹ › arrows (SHEIN).
- Escape is always present and small: "SKIP" chip top-right (Mesh), × in the tooltip corner (monday.com), "Skip" under Start (Kino).
- The last step swaps the advance control for a completion one: Mesh shows a check instead of an arrow, monday.com shows "Finish", Tabby/Zip/SIA show "Got it"/"OKAY".
- Instructions name the gesture literally — "Tap a person to view their profile", "Swipe right to star someone", "Press and hold the blank space". NGL and SHEIN both embed a device screenshot with a pointing-hand cursor drawn on the exact control.

**Copy this one:** Mesh's anchored coach mark over a washed-out real screen, with icon-led gesture bullets and a SKIP chip. It teaches on the actual home dashboard rather than in an abstract carousel, so the worker's second visit is already familiar — and it costs one overlay component with no illustration set to download.

- [Mesh — tutorial flow](https://mobbin.com/flows/8b08bfe0-f5c6-4320-9660-9e6d1b4f5eb3) — steal the washed screen + pointer-tail card + three gesture bullets + SKIP chip + circular arrow, ending on a check.
- [monday.com](https://mobbin.com/screens/8e52a60c-69ba-41b3-9828-3c9d44328ef6) — steal the "3 of 3" counter inside the tooltip and the Finish pill on the last step.
- [NGL](https://mobbin.com/screens/09c75dcf-1268-4229-87cc-41c54a2d8fca) — steal the 1-2-3-4 numbered pills plus an annotated screenshot with a pointing hand; ideal for "how to mount the glasses rig".
- [Tabby](https://mobbin.com/screens/9f7e5573-a4d1-472c-a521-f4b2dc54af92) — steal photo-top + three numbered rows + a single dark "Got it" pill for the training explainer.
- [Zip](https://mobbin.com/screens/8e7ab033-64b8-4146-bb49-93f101f84600) — steal the highlighted middle step (tinted chip) marking which part the system does for you.
- [Posh](https://mobbin.com/screens/c4d89b6c-5bd9-44d2-b186-6f960be9e556) — steal the "1/4" chip living in the nav bar rather than in the content.

---

## 8. Permission priming (camera, storage, notifications)

**Shared structure**
- Vertical order is invariant: illustration (35–45% of the height) → headline stating the benefit → 2–3 line why → primary full-width button → decline as a low-contrast text link directly beneath.
- The headline sells the outcome, never the permission: "Stay connected" (Beli), "Never miss a message" (Coffee Meets Bagel), "Get notified about your appointments and more" (Zocdoc), "Keep up with your rewards" (Chick-fil-A).
- The decline is always available and always quieter: "Not now" in grey (Beli, Zocdoc, Lovi), "No, thanks" (GoHenry). Chick-fil-A is the only one putting them side by side, and Allow is still the filled one.
- The illustration is either flat line art on a soft blob (Beli, Coffee Meets Bagel, Turo) or a phone/lock-screen render showing the actual notification that will arrive (Zocdoc, Lovi). The render converts better because it previews the payoff.
- Multi-permission screens list them as rows that flip state as each is granted — 5 Minute Journal greys each row to "enabled" and keeps a single Continue; (Not Boring) Camera ticks three amber checks with a privacy line under; Lapse puts a "Why do you need this" link on each row. Twitch simply gives one button per permission.
- Turo is the standout for low-literacy contexts: it literally says "tap 'Allow' when prompted", pre-empting the OS dialog. Alan pairs the camera prime with a manual fallback so a refusal is not a dead end.
- The system dialog always fires *on top of* the priming screen, never replacing it (Roku, Turo, Lapse) — the explanation stays visible while the user decides.

**Copy this one:** Turo's prime — one illustration, benefit headline, and a sentence naming exactly what the OS is about to ask and which word to tap. A collector who denies camera access once has to be walked through Android Settings by support; one sentence to prevent that is the cheapest support saving in the app. Pair it with 5 Minute Journal's row list so camera + storage + notifications are one screen, not three.

- [Turo](https://mobbin.com/screens/64b7b165-5876-45f1-ba60-02a665c1f123) — steal "tap 'Allow' when prompted so you can use your camera to…"; name the button the OS will show.
- [5 Minute Journal](https://mobbin.com/screens/2f3e9c22-5faf-4127-b3da-172982cd951b) — steal the three rows that flip to "enabled" with a single Continue underneath.
- [Zocdoc](https://mobbin.com/screens/624436bd-5176-4fb7-99af-161f59d3ac99) — steal the phone render previewing the real notification, plus "Not now" as quiet text.
- [Beli](https://mobbin.com/screens/441290e3-2ea8-4b7a-8017-40aefe806713) — steal the illustration / headline / why / dark pill / "Not now" vertical rhythm verbatim.
- [Alan](https://mobbin.com/screens/61f5f316-3f0b-4e90-aaa3-729b64df4f34) — steal the manual fallback button so denying camera still leaves a path forward.
- [Lapse — onboarding flow](https://mobbin.com/flows/96fcdd96-85ca-4d4f-9504-8d8fbdd2c050) — steal the per-row "Why do you need this" disclosure and the system dialog firing over the list.

---

## Flows: "Registering"

- [UNIQLO — setting up authentication](https://mobbin.com/flows/e35d6cbe-8be6-4e82-8cf8-05eb12d3bb2d) — 8 screens. Entry from a settings list, code screen with an explicit RESEND button *and* a toast confirming the resend, then a blocking "Authentication completed" dialog. Copy the toast-on-resend; skip the modal success.
- [Airtasker — verifying phone number](https://mobbin.com/flows/624d4808-9491-41bc-8a07-b8929bbb5716) — 6 screens. A "Finish registration" list of five required items, each opening its own sub-screen and returning with its circle filled. The best model for PlayerOne's declarations + training + exam gates.
- [Instacart — adding a phone number](https://mobbin.com/flows/42da4b9f-4d85-47a9-b00f-d2dcc772457c) — 5 screens. Half-sheet "Verify number" with prefix + field + one green Continue, ending in a black toast "Phone number verified" and the row now labelled Verified. Copy the toast plus the persistent verified badge.
- [Substack — adding a phone number](https://mobbin.com/flows/38224d46-84df-411f-8dc9-52ec73aeaf75) — 7 screens. "We sent you a code" with a single wide field and "Didn't get a code? Try again" under a disabled Next.
- [Plenty of Fish — verifying an account](https://mobbin.com/flows/769078f3-2db5-47cc-a5f9-06611cd7e0dc) — 6 screens. Warm pink ground throughout; "Edit number" link beside the masked destination on the code screen is the most useful recovery affordance in this set.
- [Lugg — logging in](https://mobbin.com/flows/b10b360c-4b0f-4ebb-b591-ddba0d03cf84) — 7 screens. Drawer → phone screen → loading state inside the CTA → account drawer. Button spinner instead of a full-screen loader.

## Flows: "Onboarding"

- [Roku](https://mobbin.com/flows/f559500e-a354-42d6-936b-882a1cdc63fd) — 12 screens. Solid-purple splash → illustrated permission prime with the system dialog layered on top → sign-in sheet with "Continue as guest" → home. Cleanest splash-to-home spine in the set.
- [Evernote](https://mobbin.com/flows/4f4d734f-364e-4506-917e-6a5a17fbadff) — 13 screens. Splash with the "made by" line, a top progress bar on every step, a fake "Personalizing your experience 40%" screen with a testimonial, then the paywall. Copy the progress bar; skip the fake wait.
- [Mesh](https://mobbin.com/flows/8b08bfe0-f5c6-4320-9660-9e6d1b4f5eb3) — 4 screens. Pure coach-mark tour over the real home, ending in a feed that itself contains a "Learn the basics" card — the tour leaves a permanent breadcrumb.
- [(Not Boring) Camera](https://mobbin.com/flows/1d328006-8692-4556-a642-f60fab639b3d) — 14 screens. A "Gather the Parts" permission screen with three amber-ticked rows and a privacy reassurance line, then feature explainers before first use. Closest analogue to a camera-centric worker app.
- [Kino](https://mobbin.com/flows/b32a3d13-e52d-48e6-8254-7be1bb85b237) — 8 screens. Setup preset choice (Starter/Custom as two big radio cards) then a "Get Started Quick — Start / Skip" dialog over the live camera. Copy the preset-card pattern for rig configuration.
- [Turo](https://mobbin.com/flows/468fe59a-69ba-4e7f-a8fb-8c0ddc48bf71) — 7 screens. Wordmark splash → notification prime with the OS dialog on top → home with content immediately. Three screens to value.

---

# Part B — dashboards, tasks, money, states


---

## 1. Home dashboards for gig work that show earnings

**Shared structure**

1. **Two-line money block at the top of scroll, above any card.** Small grey label ("This week", "Total you owe",
   "Available"), then the figure at ~40–48pt against 15–17pt body — a 3x jump, not 2x. DoorDash stacks `This week` /
   `$15.40` / `Active 26 min · Dashed 27 min`. The figure is never inside a card; the first card starts below it.
2. **The figure is plain text in the ground colour, never a coloured pill.** Colour is spent on the *context* around
   it (Klarna's green "nothing to pay", Chime's white card on green). That is the whole trick for not reading as a
   crypto app: big + neutral + one small coloured supporting line beats big + neon.
3. **One primary CTA directly under the number**, pill-shaped, near-full width — "View payout details", "Make a
   payment", "Unlock SpotMe". Never two.
4. **Then a row of small round icon actions or a 2-up card row, then a vertical feed.** Future Pro's icon row is 6
   circular glyphs at ~44pt; Klarna's is a 2-col store grid.
5. **The greeting is a separate, smaller line above the money** — Centr "Hi Alex", Oportun "Good afternoon!" at ~28pt
   semi-bold with the number at 44pt below. The greeting is never the biggest thing on screen.

**Copy this one:** Future Pro's stack — greeting, section label "Hôm nay", one big image card, icon row, pill tab bar.
Shallowest hierarchy in the whole pass: on a 360dp Android a collector sees greeting + cycle earnings + today's task
without scrolling, and the icon row buys five destinations without five more cards to render.

- [Future Pro home](https://mobbin.com/screens/55f80729-19a2-4731-a824-96e5ab605ff8) — "Morning, Alex" at 28pt,
  `Today` label, one 4:3 image card with the title inside it, then a lilac panel of 6 icon circles. Steal the whole
  vertical rhythm.
- [DoorDash Dasher earnings](https://mobbin.com/screens/63f22cfd-d488-4c4a-9e89-8299ca8ec389) — the third line,
  `Active 26 min · Dashed 27 min`, sitting under the money. That is exactly PlayerOne's payable-minute story.
- [Klarna home, gradient](https://mobbin.com/screens/8a196b8c-b592-4c62-bb76-b05803d671e8) — lilac→pink wash behind
  the header, two 1:1 rounded cards half-bleeding off the right edge. Steal the bleed: it says "scroll sideways"
  without a chevron.
- [Chime home](https://mobbin.com/screens/7f32e177-2c9a-4d29-a885-874140ea26d6) — green header, `Available` / `$5.00
  ›` tappable, white card overlapping the header edge. Steal the overlap.

---

## 2. Earnings / income / payout detail

**Shared structure**

1. **Period selector as pill chips under the title, before the number** — Cash App `Jul | August 2026`; Turo `All
   vehicles ▾ | 2025 ▾`.
2. **Total on its own line, then a hairline key/value table.** Cash App: `Total earnings $1.00`, `Net earnings ⓘ
   $0.82`, grey sub-line `Total earnings minus $0.18 in fees`. That sub-line is how you explain a deduction without a
   modal.
3. **Per-job rows expand in place.** DoorDash lists `Start Time / End Time / Active time / Dash time / Offers /
   Deliveries` as a right-aligned table, then `1 DoorDash Offer` with a `$15.40` row that opens to `DoorDash pay
   $6.50` + `Customer tips $8.90`. No navigation.
4. **Payout destination is two rows joined by a ↓ arrow**, each with a brand logo chip — Zopa: `Primary £10.00` ↓
   `Zopa bank account ****`.
5. **Verification and delay warnings sit in a tinted box *above* the amounts**, not under the button — Wealthfront:
   "may require manual review by our team".

**Copy this one:** DoorDash's expandable per-offer row. A PlayerOne line becomes `Ep. 12 · 47 phút · 94.000₫ ›`
expanding to `Phút được trả 47 × 2.000₫` — the rate lives in the expansion, so the list stays scannable and the
arithmetic stays checkable, which matters when a worker distrusts a review outcome.

- [DoorDash day detail](https://mobbin.com/screens/90101e7b-394d-4444-82c0-1be64965f525) — the expandable `$15.40` →
  pay + tips breakdown. Steal wholesale for per-episode lines.
- [Cash App earnings](https://mobbin.com/screens/380b2a2b-e241-4dae-8783-5e11691f4209) — month chip, huge total, Key
  stats with the fee explainer. Steal the ⓘ + grey sub-line for "phút được duyệt vs phút quay".
- [Careem withdraw sheet](https://mobbin.com/screens/cfd51bca-40e4-4162-9f35-fbaad678266e) — bank row with a radio
  right, `+ Add new bank account` below, dark green full-width CTA. Closest layout to a ZaloPay-verified /
  add-destination state.
- [Wealthfront review withdrawal](https://mobbin.com/screens/496c175a-15cc-4cf5-a013-ccfe2ea9eddc) — grey warning card
  above the amount plus "Funds should arrive Oct 24 – 25". Steal the arrival window; it kills most "where is my money"
  tickets.
- [Zopa withdraw confirm](https://mobbin.com/screens/25902b64-350f-472c-9871-fe102b49ff69) — source ↓ destination pair
  with brand chips. Steal for the ZaloPay destination block.

---

## 3. Task hall — image-led card lists and grids

**Shared structure**

1. **Price as a dark chip burned onto the image, bottom-left, unit inside the chip** — Peerspace `⚡ from $150/hr`. The
   single most transferable pattern for `₫/phút`, and it survives any photo.
2. **Full-bleed 16:9 image, text *below* it, left-aligned.** Swiggy, Deliveroo, Grab and Skip all do image → name →
   meta. Overlaid titles are for hero cards only, one per screen.
3. **Meta is one row of dot-separated facts** at 12–13pt grey: `4.5 (500+) · 0.2 mi · 10 min`. More becomes a second
   row, never a third.
4. **Edge-to-edge minus a 16pt gutter, ~16–20pt radius, 12–16pt gaps.** Horizontal carousels use a *fixed* card width
   (~150–170pt) so crops stay consistent — that is how they avoid stretching: fixed width + aspect-ratio box + cover
   crop, never a percentage width feeding a variable-height image.
5. **Discount/status badge goes in the opposite corner from the price** so the two never collide.

**Copy this one:** Peerspace's on-image price chip. The image is the slowest thing to paint on a cheap Android, and
putting the price *on* it means price and picture land together instead of the price reflowing when the image finally
decodes — provided the chip is positioned over a fixed-aspect box, not text flowing after the image.

- [Peerspace browse grid](https://mobbin.com/screens/dbc164c5-a63d-408c-a95d-7cc09324c679) — 2-col, `⚡ from $95/hr`
  chip bottom-left, heart top-right. Steal the chip and the corner split.
- [Airtasker browse tasks](https://mobbin.com/screens/10bed8fc-0701-4ee8-a684-ce87bd383e6a) — text-only cards, title
  left / `A$100` right at equal weight, then location/date/time icon rows, `Open · 8 Offers`. Steal the
  title-left/price-right baseline alignment for a compact list mode.
- [Swiggy home](https://mobbin.com/screens/4ac4c820-3029-4f39-9a4b-380f48ef10df) — `40% OFF UPTO ₹80` overlaid
  bottom-left of the photo, rating/time/cuisine/distance stacked right. Steal the overlay badge for a lime "giá cao"
  highlight.
- [Airbnb services](https://mobbin.com/screens/49f0730c-6356-476a-b481-b679952db447) — `From $45 / guest · ★5.0` as
  one plain line under a 1:1 image. Cleanest per-unit rate wording found.
- [Skip home](https://mobbin.com/screens/0287e0de-7cba-4148-ab18-5d4f43b55760) — very large radius, brand avatar
  overlapping the image's bottom-left corner, offer pill bottom-right.

---

## 4. Task detail — hero image, prominent price, one action

**Shared structure**

1. **Hero image full-bleed to the top edge, 4:3 to 1:1, with circular translucent back / share / favourite buttons
   floating on it.** Viator, Depop, Grab, Careem.
2. **Title 20–24pt bold, price immediately under or beside it, with the unit inline and smaller** — Viator's `From
   $25.65 per person` sets the amount at ~20pt and `per person` at ~13pt grey on the same line. Cleanest "amount +
   unit" treatment in the pass.
3. **Sticky bottom bar: price left (~40%), primary CTA right (~60%)** — or one full-width button that carries the
   number, as Grab does with `Add to Basket – 149.500 (Incl. tax)`.
4. **Body between hero and bar is short labelled blocks with hairline dividers**, chevron where it opens something.
5. **Constraints are icon+text rows, not paragraphs** — DoorDash's offer: `⚠ Contains restricted items`, `Must be
   21+`, `Check recipient's ID`.

**Copy this one:** Grab's number-inside-the-button CTA — `Nhận việc · 2.000₫/phút`. One tap target, price impossible
to miss, and it removes the sticky-bar/price duplication that eats vertical space on a short screen.

- [Viator attraction detail](https://mobbin.com/screens/42dd6965-7db3-4dfb-a66d-1c29699a95a4) — `From $25.65 per
  person` with the unit inline and smaller; sticky bar repeats price + green CTA. Steal the inline size-split for
  `₫/phút`.
- [DoorDash offer card](https://mobbin.com/screens/61830cf9-fba8-4c86-a85f-5b84b20fcc54) — map on top, `$11.50` at
  ~34pt with `Guaranteed (incl. tips)` in grey beside it, then `2.8 mi` and `Deliver by 3:53 PM`, red full-width
  `Accept`. Steal the money + qualifier-beside-it pairing.
- [Grab dish detail](https://mobbin.com/screens/62e39790-c297-466e-b0cc-7338f0ffd080) — price right-aligned to the
  title with `Base price` under it; CTA carries the total. Steal both.
- [inDrive offer stack](https://mobbin.com/screens/4c99dcda-0755-4328-b218-3190c91ca2cf) — `MX$84` huge, Decline grey
  vs Accept lime as unequal-weight buttons. Exactly the one-lime-highlight rule.
- [Urban Company service detail](https://mobbin.com/screens/e76b9558-e44d-4a20-acb3-d47de6fd3159) — `From $25.50/hr
  (GST included)` plus a green `Arrives in 30mins` badge. Steal the "rate + what's included" parenthetical.

---

## 5. Upload / processing / in-flight

**Shared structure**

1. **In-list progress beats a blocking screen.** YouTube shows the uploading video as the first row of the normal
   list: thumbnail, title, `Uploading... 65%` in blue, `Seconds remaining: 27`. Nothing is locked.
2. **A thin determinate bar pinned under the nav bar** with the stage as a word and an `n/N` counter right — VSCO:
   `Posting media...` / `0/1` with a dismiss ✕.
3. **Percent as text, not only as a bar** — CapCut overlays `94%` at ~34pt on the frame thumbnail. On a slow phone a
   moving number reassures where a bar barely does.
4. **Stage words are a fixed vocabulary in a 4-node timeline**: past filled, current ringed, future hollow grey —
   sweetgreen `Received / Preparing / Ready for courier / Delivering`.
5. **"Don't close this" only where the work truly dies.** CapCut says it; YouTube does not, because its upload
   survives backgrounding.

**Copy this one:** YouTube's in-list uploading row. A session upload takes many minutes on 4G; a full-screen blocker
traps the worker, whereas the row makes `đang tải 65% · còn 27 giây` part of My Sessions rather than a separate place
to go and check.

- [YouTube Your videos](https://mobbin.com/screens/9eb5099b-ee42-43e8-8c79-1079409e3e36) — uploading row with striped
  placeholder thumb, percent, seconds remaining. Steal exactly.
- [CapCut exporting](https://mobbin.com/screens/0817efa5-475d-47db-b95e-ddf474865ef7) — big `94%` on the frame plus
  the don't-close warning. Steal for the foreground upload screen.
- [sweetgreen status bar](https://mobbin.com/screens/76e2f253-96bc-4199-9439-8c74a519e0ec) — 4-node timeline in a dark
  rounded banner atop an otherwise empty screen. Steal for `Đã tải lên → Đang duyệt → Đã duyệt → Đã trả`.
- [Shopee logistics timeline](https://mobbin.com/screens/5bd9141f-8c16-4f6b-b743-5ca9b64fe0ce) — vertical timeline,
  current step teal with a timestamp column, past steps grey. Steal for session review history.
- [Airtasker uploading images](https://mobbin.com/screens/dc861fdf-6938-46a5-8879-c43c77a3375e) — centred bar blocking
  the whole screen. Negative example: don't.

---

## 6. Floating pill tab bars

**Shared structure**

1. **4 items is the norm, 5 the ceiling.** Play 3, Quizlet 3, Gentler Streak 3, Truecaller 4, GitHub 4, Shop 4, Klarna
   4, Blinkist 4. Nothing floating goes past 5.
2. **Geometry:** full-radius capsule, ~56–64pt tall, inset ~16–20pt each side, ~12–24pt above the home indicator.
   Shadow is wide-blur and very low alpha — raised paper, not a drop shadow.
3. **The active item is a tinted inner pill** wrapping icon + label; inactive items have no background. Truecaller,
   Quizlet, Gentler Streak and GitHub all do this.
4. **Labels stay on** — a 10–11pt label under each icon. Only Shop and Hypelist drop them, and both are icon-only by
   brand.
5. **Content scrolls under it, deliberately visible at the edges.** Apple News and Blinkist let text run behind;
   nobody adds a divider. Bottom padding must equal bar height + inset or the last row is unreachable.

**Copy this one:** Truecaller's geometry — 4 items, labels on, tinted inner pill, opaque capsule with a soft shadow.
Opaque matters: real blur is expensive and ugly on cheap Androids, and a solid warm-paper capsule gets the same lift
for free.

- [Truecaller](https://mobbin.com/screens/5ac800ad-606f-4f54-b0eb-f02d54904cf4) — 4 items, active `Home` in a pale
  inner pill. The template.
- [Quizlet](https://mobbin.com/screens/8b473941-73b2-47fc-9a46-b231145620d6) — 3 items, generous inset, very soft
  shadow on white. Closest to a warm-paper feel.
- [Gentler Streak](https://mobbin.com/screens/874d09cc-a726-4d7a-abab-6686e81c3d5f) — dark capsule on a warm grey
  page, active item in a peach inner pill. Steal the warm-accent inner pill.
- [Klarna](https://mobbin.com/screens/236233c2-aeb3-4fc3-b869-6d46d06ff418) — the owner's reference: 4 items floating
  over a purple gradient, content visibly passing beneath.

---

## 7. Empty states

**Shared structure**

1. **Vertically centred, not top-aligned**: illustration → headline → one grey line → one button. Every example
   follows this order.
2. **Illustration is small (~80–140pt)**, a brand object or a flat line icon — never a large stock scene. Depop uses
   its own shopping bag; PayPal a plain outline heart.
3. **Headline is warm and specific, 2 lines max, ~20pt semi-bold** — "So much space!", "Hey, it feels so empty here.",
   "Nothing to see... yet". The sub-line explains.
4. **Exactly one button**, pill-shaped, dark-on-light, and it is the action that fills the state: "Find something you
   love", "Explore services", "Upload new invoice".
5. **The tab bar stays visible.** Nobody hides navigation in an empty state.

**Copy this one:** Depop's — brand object, warm two-word headline, one grey line, one pill. Least text to translate,
and Vietnamese copy is better served by a friendly four-word headline than an explanatory paragraph that wraps to five
lines at 360dp.

- [Depop empty bag](https://mobbin.com/screens/cd229d99-fdfe-4c52-a91c-6a7830ac6c54) — red brand bag, "So much
  space!", one line, black pill. Steal the tone and proportions.
- [Grab empty cart](https://mobbin.com/screens/e2d7c058-8813-4dad-99f8-c0887f1f270e) — local-flavour rooster-bowl
  illustration, 2-line headline, green text link instead of a button. Steal the local-character illustration idea for
  an empty task hall.
- [Remote Global HR, no invoices](https://mobbin.com/screens/7f14752c-5199-43d9-9364-b11d857a34c0) — "No recurring
  invoices yet" / "When you create one, it appears here" / blue pill with an ↗. Steal that sentence shape for an empty
  income screen.
- [AllTrails notifications](https://mobbin.com/screens/7b19c424-ab83-4a7e-b5af-0cddd9e72658) — tiny line-art, "Nothing
  to see... yet". Steal the ellipsis-yet voice.

---

## 8. Loading states

**Shared structure**

1. **Skeletons, not spinners, wherever the layout is known.** Grab, AllTrails, YouTube, Tabby, OKX and Flo all
   skeleton. Spinners survive only inside buttons and modals.
2. **The skeleton mirrors the real geometry exactly** — same radius, same card heights, same grid. Grab's loader shows
   two rounded cards, a 4×2 circle grid, then a banner block: you recognise the screen before it loads.
3. **Text lines are 3 grey bars of descending width (100% / 70% / 40%)**; images are one solid rounded block.
4. **Very low contrast**, a few percent darker than the ground, no borders. Shimmer optional — OKX and Tabby are
   static.
5. **Chrome renders immediately.** Shop's skeleton already shows the floating tab bar; Flo already shows the title
   bar. Only the data region is grey.

**Copy this one:** Grab's layout-mirroring skeleton. Costs nothing at runtime (static divs, no animation loop burning
battery) and on a slow connection the collector sees the shape of the task hall immediately — the difference between
waiting and assuming the app is broken.

- [Grab home skeleton](https://mobbin.com/screens/7c2679a0-c95a-453d-8a53-f3cdd9ea649f) — cards, icon grid and banner
  all pre-shaped. The one to copy.
- [AllTrails skeleton](https://mobbin.com/screens/a6a7bb97-d19a-410e-94cc-9473cbeeb39b) — search pill, filter chips,
  image block + 3 descending text bars. Steal the descending widths.
- [Shop skeleton](https://mobbin.com/screens/d3158271-a0e5-4672-bea0-44ef4aebcb1c) — skeleton with the floating tab
  bar already solid. Steal the rule: chrome never skeletons.
- [Finimize "Building your feed…"](https://mobbin.com/screens/a0ac7917-f698-42e8-85ce-8d6cf3949eb9) — skeleton rows
  with real thumbnails loaded and a headline explaining the wait. Use when a wait is genuinely long (first sync after
  pairing).

---

## 9. Error states

**Shared structure**

1. **Three tiers, all in use.** Inline field error (red 12–13pt under the field, red border, tinted fill);
   sheet/dialog for a failed action; full-screen only when nothing can render.
2. **Full-screen is a centred column**: icon → short headline → one or two grey sentences → primary retry pill →
   optional plain-text secondary. PayPal: triangle, "Sorry About the Wait", black `Try Again`, blue `Not Now`.
3. **Retry is always primary and always says "Try again".** Every example. No cleverness.
4. **Inline errors keep the entered value.** Instacart's failed OTP keeps all six digits with a red border and `⚠ Code
   didn't match. Try again or request a new code.` — the sentence carries the next action.
5. **Connectivity errors get their own glyph and wording**, distinct from server errors — MyDyson's struck-through
   wifi, "We're having trouble connecting". Worth keeping separate for a worker on unreliable mobile data.

**Copy this one:** Instacart's inline error — value preserved, red border, one sentence naming both the problem and
the escape hatch. On an upload failure that becomes `Tải lên thất bại · Thử lại hoặc tải khi có Wi-Fi`, in-row, with
the session and its progress intact instead of a full-screen error that throws away where the upload got to.

- [Instacart OTP error](https://mobbin.com/screens/21d8cc45-be37-46cc-a177-b49cf1ad2c7b) — digits kept, red rounded
  border, ⚠ + remedy in one line. The pattern to copy.
- [PayPal full-screen error](https://mobbin.com/screens/305815a1-eb96-4544-bde7-c1342b7e15ce) — triangle, headline,
  two grey lines, black `Try Again` + blue `Not Now`. Steal the two-tier buttons.
- [MyDyson connection error](https://mobbin.com/screens/428368da-df49-4ae6-9f60-4244315ed039) — wifi-off glyph,
  full-bleed purple `Retry` bar at the bottom. Steal for device pairing.
- [Blue Bottle order error](https://mobbin.com/screens/0900deaa-0c70-4297-9567-a208a55b7736) — bottom sheet over the
  preserved order screen, `Try again` + underlined `contact support`. Steal for a failed claim: context stays behind
  the sheet.
- [Hers form error](https://mobbin.com/screens/3a7b7c50-8e10-4266-a13e-470ec6e12929) — `Required field.` in small red
  under one field, others untouched. Steal for the ZaloPay destination form.
