# Collector app v2 — design specification

The owner rejected the shipped collector UI outright: "absolutely horrendous…
nothing is responsive… text and images stretched… navbar not needed on the
landing… nothing has functionality… laggy". This file is the replacement, screen
by screen. It is a **redesign**: product truth, the API, the gates and every
server-side rule are preserved exactly; the visual world is replaced.

The clickable mock the owner approves is [`mock/index.html`](mock/index.html).
The reference research behind the patterns is [`REFERENCES.md`](REFERENCES.md).
Nothing here invents a colour, a radius or a duration — every value is a token in
`packages/design/src/tokens.ts`.

Contents: §0 the decisions (§0.6 copy is a key, §0.7 the `ui.tsx` reuse table,
§0.8 what is never built) ·
§1–§16 the screens · §17 states · §18 accessibility · §19 out of scope ·
§20 technical basis (§20.4 the build order) · §21 assets · §22 open questions.

---

## 0. The decisions that everything else follows from

### 0.1 The ground moves to warm paper

The app currently stands on lavender (`--background #EDEEF7`). DESIGN.md is
explicit about why the ground is tinted at all: *"a translucent card over a white
page is white — there is nothing behind it to show through and the blur has
nothing to bend"*. That argument is a **web** argument. DESIGN.md also records the
translation cost: *"React Native has neither `backdrop-filter` nor a blur it can
apply without a native module… `fill` composites straight over the wash."* On the
phone there is no blur, so lavender is doing nothing a warmer tint could not do —
and it fights the photography, which is the thing the owner wants more of.

So v2 stands the whole app on the public story's ground, the one `/discover`
already uses and `native.ts` already exports as `theme.color.discover`:

| Role | Token | Value | Job |
|---|---|---|---|
| Ground | `discover.paper` | `#F4EFE6` | every screen's backdrop |
| Surface | `discover.surface` | `#FFFCF6` | cards, sheets, fields |
| Ink | `discover.ink` | `#35271F` | all primary text |
| Muted | `discover.muted` | `#705D4D` | captions, secondary text |
| Line | `discover.line` | `#D3C5B3` | hairlines, field borders |
| Soft | `discover.soft` | `#E8DFD1` | inset fills, skeletons, tracks |
| **Plum tint** | `discover.light` | `#DED8F3` | **money fills**, the greeting block, active chips |
| **Plum ink** | `discover.lightInk` | `#4E4368` | text on plum, the money figure |
| Action | `color.action` / `actionInk` | `#14151A` / `#EDEEF7` | the one primary pill per screen |
| Lime | `lime500` fill / `lime700` ink | `#B8F04A` / `#566F17` | **one** progress moment per screen |

`native.ts` already carries this block and already argues for it ("the collector
app's landing IS that page… so it stands on the same ground rather than on a
second one, and a phone in dark mode does not repaint a page whose photographs
were lit for paper"). v2 extends that sentence past the landing. **No new hex is
introduced anywhere in this spec.** The "plum" the owner asked for is
`discover.lightInk`, which has existed since 2026-09-08.

What this costs, stated plainly: `native.ts`'s note that sign-in "stands on the
app's own lavender on purpose" becomes wrong, and DESIGN.md's "the native
collector theme stays separate" becomes stale. Both are one-line edits, and both
are owner sign-off items in §22.

**Dark mode.** The discover block deliberately does not answer to the colour
scheme — a page whose photographs were lit for paper does not get repainted. v2
inherits that: the collector app is a light-ground app, and `useColorScheme()`
stops changing its ground. The operator console keeps both schemes.

### 0.2 Colour discipline, restated for a colourful app

The owner asked for "colorful". The system's rule is "one accent, spent once".
These reconcile because plum is a **tint**, not an accent:

- **Plum** may repeat freely: the greeting block, a price chip on a photograph,
  an active tab or filter pill. It is a field, not a signal.
- **A money total is never inside a coloured box.** This is the one rule the
  reference pass overruled a draft decision on: across every earnings app looked
  at, the primary figure is plain text on the card's own ground and is anchored
  by **size** — a 3× jump over the label — while colour goes on the context line
  beside it. A boxed total reads as a crypto app. A *rate* on a photograph is the
  exception and gets a plum chip, because it needs a ground to be legible on.
- **Lime** is spent **at most once per screen**, on progress and only
  progress. It is a ceiling, not a quota: the task hall carries *no* lime,
  because four tiles each with a lime track is four accents, and a repeating
  list gets the neutral `discover.muted` fill instead. The three screens that
  spend it: Home (the review ring), Task detail (the claim track), Uploads (the
  one episode actually transferring). Two consequences that were got wrong in
  the first draft and are now rules — **the `uploading` state pill is
  `discover.soft`, not lime**, because the track beside it is already the
  screen's lime; and **the coach-mark ring is `color.action`**, because step 1
  rings the very card whose lime arc it is pointing at.
- **Ink** is the primary action, and there is **one** per screen.
- **Verdict colours** (`pass` `#0D763B`, `partial` `#613AFB`, `reject` `#C41C21`)
  appear only beside a verdict glyph, never as decoration.
- **Sun and tech** appear only inside the PlayerOne wordmark. Never a button,
  never a link, never money.
- **Bamboo** is Trúc's stalk and nothing else — `contrast.test.ts` bars it from
  money and from any verdict.

**Never colour alone.** Every state signalled by colour also carries a word from
`i18n.ts` and, for a verdict or a settlement state, a glyph. That rule is
inherited unchanged and is not negotiable on a payment screen.

### 0.3 Typography

One family: **Be Vietnam Pro**, already bundled via `@fontsource/be-vietnam-pro`.
The console's display face (Archivo Variable) is **not** shipped to the phone — a
second variable font is ~120 KB for a face that was not drawn for Vietnamese
diacritics, and the owner's serif references (Future Pro, Oura) would make it a
third. Display weight is `fontWeight.display` (800), `letterSpacing: -0.5` at
`xl` and above.

| Role | Token | px | lineHeight | Used for |
|---|---|---|---|---|
| Hero | `fontSize.3xl` | 42 | 1.15 | the money figure, and only that |
| Display | `fontSize.2xl` | 33 | 1.18 | screen money totals, the greeting name |
| Title | `fontSize.xl` | 26 | 1.2 | screen titles |
| Section | `fontSize.lg` | 21 | 1.3 | card titles, sheet titles |
| Lead | `fontSize.md` | 17 | 1.4 | intro paragraphs, the price on a card |
| Body | `fontSize.base` | 15 | 1.45 | everything else |
| Caption | `fontSize.sm` | 13 | 1.4 | captions, field labels |
| Micro | `fontSize.xs` | 12 | 1.4 | tab labels, version strings |

**The line-height floor is measured, not chosen.** Ratios of 1.04–1.06 clip
Vietnamese tone marks in React Native (measured on the emulator by the previous
lane). Body and below are **never** below 1.3; display and hero never below 1.15.
RN wants absolute px, so write `Math.round(size * ratio)` — a bare multiplier is
a rejected diff.

**Two ceilings measured in the mock, not guessed.** Both are Vietnamese-specific
and both bit on the first render:

- **`fontSize.3xl` fits about 16 Vietnamese characters on a 390dp line.** The
  Welcome headline was drafted at 3xl and "Sống như mọi ngày." (18) wrapped
  mid-sentence. The hero headline is therefore **`fontSize.2xl`**, and 3xl is
  reserved for the money figure, which is short by construction. §2 carries the
  consequence: the third slogan drops to `fontSize.md` as a lead rather than
  becoming a wrapped third line.
- **A tab label must fit one line at 320dp**, which is about 10 characters at
  `fontSize.xs`. `tab.home` is currently "Trang chính" (11) and wraps to two
  lines at 360dp, which makes that one tab taller than its four siblings and
  pushes the raised action into the bar. Change the Vietnamese to **"Trang chủ"**
  — shorter, and the more idiomatic Vietnamese label for a home tab anyway. The
  `en` and `zh` values are unchanged.

| key | vi (was) | vi (now) |
|---|---|---|
| `tab.home` | Trang chính | Trang chủ |

### 0.4 The responsive rule, since "nothing is responsive" was the complaint

- **No fixed pixel width appears in any layout style.** Widths are `flex`,
  `alignSelf: 'stretch'`, or a percentage. The only fixed dimensions allowed are
  icon sizes, hairlines, and the 44 pt minimum target.
- **Every image lives in an `aspectRatio` box** with `resizeMode="cover"`. Never
  a `width`/`height` pair — that is exactly how the current build stretched
  things. The ratios this app uses: `9/16` (Welcome, full-bleed), `16/11`
  (sign-in hero), `16/9` (task card, training), `4/5` (hall grid tile), `3/2`
  (task detail hero).
- **Full-screen section height comes from the ScrollView's `onLayout`**, never
  from `useWindowDimensions().height` — that under-reports on the target device
  and left a hero short by the status bar.
- **Safe areas**: top padding is `StatusBar.currentHeight ?? 0` plus `space[4]`;
  the bottom uses `ui.tsx`'s existing `bottomInset()`, and scroll content
  reserves the tab bar's **measured** height via the existing `measureTabBar()`,
  never a guess.
- **Targets are 44 pt minimum**: `minHeight: 44, minWidth: 44`, never `height`.
- **Type scale**: at `fontScale > 1.2` the tab bar's raised action moves to its
  own row — behaviour that already exists in `shell/TabBar.tsx` and is kept.
- **Breakpoints checked**: 320×640 (the narrowest bar the pilot ships to, in
  Vietnamese — the case that fails first), 360×780, 390×844, 412×915.

### 0.5 The motion rule, since "laggy" was the other complaint

Measured on the emulator by the previous lane: with the 720p film playing, a 10 s
scroll produced **38 % janky frames**; the same page with no film produced **4 %**.
Video decode is the jank. Therefore:

1. **A `VideoView` mounts only on a screen that does not scroll** — Splash and
   Welcome, and nowhere else. Never inside a `ScrollView`, never inside a list.
2. **One video instance is mounted at a time**, and mounting is gated on
   visibility. Leaving Welcome unmounts the player before the next screen paints.
3. **Everywhere else the poster still is the image.** There is no "it's only a
   short loop" exception.
4. **Animate `opacity` and `transform` only**, always `useNativeDriver: true`.
   Colour interpolation and width/height animation run on the JS thread and are
   banned. This is also why `react-native-reanimated` is not needed — see §20.
5. **Any overlay that fades out must unmount or set `pointerEvents="none"`.** A
   full-screen overlay at `opacity: 0` still eats every touch on Android; that
   was the "nothing has functionality" dead button. The coach-mark overlay and
   the splash both go through this rule.
6. **Reduced motion** (`AccessibilityInfo.isReduceMotionEnabled()`, which
   react-native-web answers from `prefers-reduced-motion`, so the browser harness
   exercises the real code path): every animation below names its still fallback.
   The rule is *composed still, readable content, manual controls* — never "the
   screen is blank because the entrance never ran".
7. Durations come from `theme.duration`: `instant` 90, `fast` 150, `base` 200,
   `slow` 320. Anything longer is a named exception, and there are exactly three:
   splash 1600, welcome hero fade 600, skeleton pulse 900.

### 0.6 Every visible string is a key, and the mock proves it

No screen in this spec renders a word that is not either an existing key in
`apps/collector/src/i18n.ts` or a **new** key listed with its vi/en/zh values in
that screen's own copy table. There is no third category, and "we will write the
Vietnamese later" is not one — a screen laid out around words nobody has agreed
is a screen that gets re-laid-out when they arrive.

This is enforced rather than asked for. `mock/index.html` contains **no
user-facing text at all**: every string is `data-t="<key>"`, the values live in
`mock/copy.js`, and a key the catalogue does not have renders in red on the
artboard instead of rendering as nothing. So a missing string cannot survive a
screenshot review, and a Vietnamese rewrite touches exactly one file and moves no
layout.

The Vietnamese in `copy.js` marked `NEW` is **provisional**. A native-speaker
copy pass owns the wording; this spec owns the keys, the lengths that fit
(§0.3), and the stance (the three rewrites above). When that pass lands, the values
change in `i18n.ts` and are copied into `copy.js`; nothing else moves.

**Three strings were rewritten for stance, not for style.** Each was originally
written in the system's voice — telling a collector about the server's plumbing —
and a person owed money does not care which machine has not sent what:

| key | was | is |
|---|---|---|
| `home.cycleUnavailable` | "Máy chủ chưa gửi tổng của kỳ…" | "Chưa có tổng của kỳ này. Bạn vẫn xem được tiền từng tập ở mục Thu nhập." |
| `payout.unknown` | "Máy chủ chưa gửi trạng thái nhận tiền." | "Chưa rõ bạn nhận tiền ở đâu. Điểm hỗ trợ sẽ cài giúp bạn." |
| `guide.home.earnings` | "Con số này là của máy chủ… Ứng dụng không tự cộng." | "Đây là tiền của các tập đã duyệt trong kỳ này. Người duyệt quyết định con số, không phải ứng dụng." |

The rule they encode: **name what the collector can do or see, not what a
component of ours did or did not do.** "Máy chủ" appears in no string this spec
adds.

### 0.7 Build from what `ui.tsx` already exports

`apps/collector/src/ui.tsx` is 1,400 lines of components that already carry this
app's spacing, type, targets and accessibility roles. **Every element in every
screen below maps to one of them.** A builder who writes a new styled `View`
where this table names a component is producing a second look for a solved
problem, and that is the first thing to reject in review.

| This spec says | Use | Notes |
|---|---|---|
| a screen shell, title, safe areas | `Screen`, `Title`, `topInset`, `bottomInset` | never a bare `SafeAreaView` |
| a list screen with load/empty/error | `ListScreen<T>` | it already does all three states of §17 |
| a card | `Card`, `CardLink` | `CardLink` is the tappable one, with its own 44 pt floor |
| body and caption text | `Body`, `Body muted` | carries the §0.3 line heights |
| the primary pill, ghost, disabled | `Button` | all three variants; do not restyle a `Pressable` |
| a filter or destination chip | `Chip` | active state already = fill + weight |
| the state pill (§13), settlement pill (§14) | `Tag` | takes `fg`, `bg`, `mark` — the glyph slot is the "never colour alone" half |
| a progress track (§11, §12, §13) | `Progress` | takes `label`, `value`, `fraction`; renders the text beside the bar |
| the review ring (§10) | `RingChip` | counts only, never money — §10 |
| a money figure with its label (§14) | `Amount` | `value` + `label`, the size relationship is inside it |
| a text field with its label (§3, §5, §15) | `Field` | label, focus border, error slot |
| a yes/no or either/or control (§8, §APP-17b) | `Choice` | the two-declaration control is this |
| the six agreement rows (§6) | `Choice` in a `Card` | the row is the target, not the switch |
| a disclosure under a mocked control (§15) | `Note` | `devices.qrMock`, `training.placeholder`, `forum.notConnected` |
| the legal line (§2, §3) | `LegalLine` | already positions and underlines the two links |
| a skeleton / pending screen (§17) | `Loading` | skeletons, not a spinner |
| the income stage row (§14) | `Timeline` | the four `income.step.*` nodes |
| a key/value row (§14, §15) | `Row` | label left, value right, aligned |
| a navigation row with a chevron (§10, §16) | `NavRow` | |
| the glass bar behind the tabs | `GlassBar` | composites `fill`; RN has no blur |
| every icon | `glyphs.tsx` | `GlyphPlus` for the raised action (§10) |
| Trúc (§17) | `identity/Panda.tsx` | `Pose` = `idle` for empty states |

**What is genuinely new**, and therefore the only new components this redesign
adds: the two-line price chip (§10), the welcome hero with its scrim (§2), the
six-box code row (§4), and the splash player (§1). Four. Everything else is a
re-skin of an existing export, which is why §20.4 fits in two days.

### 0.8 What is NOT built, on every screen

Repeated per screen below, because these are the constraints a well-meaning
implementation is most likely to violate:

- **No recording control.** No start, no stop, no pause, no "recording"
  indicator, anywhere. `CollectorApi` has no method for it and `DeviceTransport`
  has no method for it. Recording is the device's own affair.
- **No email field, anywhere.** Not at sign-in, not at registration, not in the
  profile. The one-time code arrives over **Zalo ZNS**. No SMS fallback, no
  password, no social sign-in, no biometric.
- **No third consent.** APP-17b is exactly two declarations — others in frame,
  sensitive information — and APP-02 is exactly the six agreements in
  `AGREEMENTS`. A seventh toggle is a server rejection.
- **The app computes no number.** No total, no sum, no average, no currency or
  minute arithmetic. Every figure on every screen is a string the server sent.
  `income.intro` already prints the promise: *"Từng tập một. Ứng dụng không cộng
  gộp và không tự tính tiền."*

---

## 1. Splash

**Purpose.** The first 1.6 seconds of a cold start, and the owner's named want:
"a splash screen using the PlayerOne text assembling in a loading way,
traversing, curvy cross-text merging and panning, with nice non-AI-slop shapes".

**Layout (flex).** `flex: 1`, `backgroundColor: discover.paper`, centred on both
axes. One child: the wordmark, `width: '62%'`, `aspectRatio: 784/152`,
`alignSelf: 'center'`. Below it at `space[6]`, one caption at `fontSize.sm` in
`discover.muted`. At the foot, `paddingBottom: bottomInset(space[8])`, the
partner line at `fontSize.xs` — the Claude-splash pattern of a quiet attribution
at the bottom rather than a logo sandwich.

**The animation.** The console's `AssemblyLogo` is 32 filled SVG fragments on one
`0 0 784 152` viewBox driven by deterministic waypoints in `logoChoreography.ts`:
*"scrambled black glyph fragments inside the wordmark's own bounds. Three rapid
local register changes… exact lock at 0.9 s, color by 1.1 s, docking by 1.5 s."*
The "non-AI-slop shapes" the owner wants are already there and are already
originals — stems, bowls, bars, connectors, anchors, and the two lens discs.
Nothing new is drawn.

**How it plays on the phone — decided in §20.2:** a pre-rendered 1080×1920 H.264
clip in `expo-video`. Four properties of that clip are contractual:

1. **It carries the wordmark and nothing else** — no caption, no partner line,
   no background furniture. Those are live `Text` on the screen underneath, so
   they stay translatable and stay legible at any font scale. A clip with baked
   text is a clip that cannot be localised.
2. **`contentFit="contain"`**, never `cover`. A cover-fit clip on an aspect
   ratio it was not rendered for crops a letter off the wordmark, and there is
   no aspect ratio at which losing the `P` is acceptable.
3. **The player box is locked to 62 % of the artboard width** with
   `aspectRatio: 784/152` — the same box the static `Image` occupies. Because
   the clip's last frame and that `Image` are then pixel-identical at the same
   size and position, the handoff to Welcome is a 600 ms cross-fade of two
   identical images plus a `translateY` on the static one. That is the
   "morphing into the mobile UI" the owner asked for, with two native-driver
   properties and no layout animation.
4. **A 400 ms first-frame gate.** If `expo-video` has not produced a first
   frame within 400 ms of mount — a cold decoder, a codec the device refuses, a
   corrupted asset — the player is unmounted and the static wordmark renders
   instead, running the reduced-motion path. The splash is the first thing a
   collector ever sees and it must never be a blank warm rectangle waiting on a
   decoder. The gate is a `setTimeout` cleared by the player's first
   `readyToPlay`; it is four lines and it removes the whole class of "the app
   didn't start" reports.

**Motion.** 1600 ms total: 0–1500 the clip, 1500–1600 the cross-fade.
**Reduced motion:** the clip never mounts; the static wordmark renders at final
scale, holds 400 ms, then the same cross-fade. Tappable to dismiss after 300 ms.

**Data.** None. The splash renders before `restoreSession()` resolves and does
not wait on it; if the profile is still loading when the clip ends, Welcome shows
with its CTA in the loading state (§2).

**Copy.** New keys:

| key | vi | en | zh |
|---|---|---|---|
| `splash.caption` | Thu thập dữ liệu đời thường | Everyday data collection | 日常数据采集 |
| `splash.partners` | VNG × PaXini | VNG × PaXini | VNG × PaXini |

**Not built.** No progress bar, no percentage, no spinner — the clip *is* the
loading indicator and a second one would be an admission it is slow. No version
string; that belongs in Profile.

---

## 2. Welcome (hero)

**Purpose.** The product in one screen, before anyone signs in. Replaces
`screens/Landing.tsx`. The owner's references are Future Pro (full-bleed video,
wordmark centred at top, headline bottom-left, white pill CTA) and Oura/Lifesum
(photo, headline, stacked pill CTAs, policy line under).

**No navbar.** No tab bar, no header, no back control — the owner named this
explicitly, and `App.tsx` already renders Landing and SignIn outside the tab
shell, so it costs nothing.

**Layout (flex).**

```
View flex:1                                  ← no ScrollView; this screen does not scroll
├─ VideoView  position:absolute inset:0      ← pov-portrait.mp4, cover, muted, looping
├─ View       position:absolute inset:0      ← the three-stop scrim
└─ View       flex:1 justifyContent:'space-between' padding:space[5]
   ├─ View    alignItems:'center' paddingTop:statusBar+space[4]
   │  └─ Image wordmark  width:'46%' aspectRatio:784/152   ← monochrome, tinted surface
   └─ View    gap:space[4]
      ├─ Text  slogan1 + slogan2    fontSize.2xl weight.display, left-aligned
      ├─ Text  slogan3              fontSize.md  ← the payoff, as a lead
      ├─ Pressable landing.signIn   ← surface fill, ink label, radius.pill, minHeight 52
      ├─ Pressable landing.register ← ghost; opens the support-desk explanation
      └─ Text  policy line          fontSize.xs, two links into §16
```

This is the **only** full-bleed video in the app and this screen does not scroll,
so §0.5 rule 1 holds. `pov-portrait.mp4` is 720×1280 portrait — it fills a phone
without the centre-slice crop a 1280×716 landscape film would force.

**The scrim, measured rather than chosen.** The first draft said
`rgba(53,39,31,0)` → `.35` at 55 % → `.82` at 100 % "so the headline sits on
≥4.5:1". That claim was not measured and it was false.

Method: `pov-portrait.mp4` sampled at 1 fps (12 frames, the whole clip),
`scale=-1:844,crop=390:844` so the pixels are the ones a 390 dp phone actually
shows, composited under the gradient in sRGB, then the relative luminance of
every pixel under the text — the left 88 % of each line — against
`#FFFCF6` (L = 0.9753). The script is `docs/design/mobile-v2/mock/` work and the
numbers are reproducible from the asset in the repo.

| stops | headline band 62–71 % | lead band 71–77 % | policy 93–98 % |
|---|---|---|---|
| drafted `.35 / .82` | **3.02:1** — fails AA | 4.06:1 | 7.94:1 |
| **shipped `.60 / .88`** | **5.24:1** | 5.24:1 | 9.79:1 |

The worst frame is at 8 s, where the film pans onto a sunlit wall, and the worst
row is the top of the headline band at y = 62.3 %. The floor for the middle stop
is `.55` (4.68:1 across the whole text band); `.60` is taken for margin, and at
the 71 % probe the composited alpha is 0.700 and the ratio is **6.19:1**.

So: `rgba(53,39,31,0)` 0 % → `rgba(53,39,31,.60)` 55 % → `rgba(53,39,31,.88)`
100 %. Any change to the hero clip re-runs this measurement; a new film is a new
worst frame.

That is also what "demo video at low opacity behind the first screens so text
stays readable" means in practice: the film plays at full opacity and the
**scrim** does the work, which is more readable than a faded film and identical
in decode cost.

**When the video fails, the poster is the screen.** `expo-video` can fail to
load or to decode, and a failed hero must not leave the headline on bare paper
with a white pill on it. On `error`, or when the 400 ms first-frame gate of §1
expires, the player unmounts and `pov-portrait.webp` renders in the same
`position: absolute` box under the same scrim — the reduced-motion path,
reached by a second route. There is no third state.

**Motion.** On mount the video fades in over 600 ms; the wordmark arrives as the
splash's cross-fade target and has no second animation; the headline and CTAs
rise `translateY: 16 → 0` with `opacity: 0 → 1` over `duration.slow`, staggered
80 ms. **Reduced motion:** `pov-portrait.webp` renders instead of the video,
everything is at its final position on first paint, no stagger. The video
unmounts on navigation away, before the next screen paints.

**Data.** None. `landing.centre` renders only when `LANDING_CENTRE_CODE` is set,
unchanged from today.

**Copy.** All existing: `landing.slogan1` / `slogan2` / `slogan3` ("Đeo camera." /
"Sống như mọi ngày." / "Phút được duyệt, được trả."), `landing.signIn`,
`landing.register`, `landing.registerNote`, `landing.videoLabel` (the video's
`accessibilityLabel`), `legal.privacy`, `legal.dataNotice`. New: none.

**Not built.** No sign-up button that creates an account — accounts are opened at
a support desk (`landing.registerNote`), and the register control opens that
explanation, not a form. No carousel, no page dots, no skip. No imagery implying
the app controls the camera.

---

## 3. Phone sign-in

**Purpose.** APP-01, step one. Glovo's login is the reference: a brand hero on
top, a rounded surface sheet below carrying the form.

**Layout (flex).**

```
View flex:1 backgroundColor:discover.paper
├─ View  aspectRatio:16/11                     ← poster still, NOT the video
│  └─ Image pov-portrait.webp cover + scrim
│     └─ Image wordmark  absolute bottom:space[5] left:space[5] width:'40%'
└─ View  flex:1 marginTop:-space[6]
         borderTopLeftRadius/RightRadius:radius.xl
         backgroundColor:discover.surface padding:space[5] gap:space[4]
   ├─ Text  signIn.title       fontSize.xl weight.display
   ├─ Text  signIn.intro       fontSize.base muted
   ├─ View  flexDirection:'row' gap:space[2]
   │  ├─ Pressable country     flex:0 0 auto minWidth:44 radius.base   ← +84 / +86
   │  └─ TextInput phone       flex:1 keyboardType:'phone-pad' radius.base
   ├─ Row: zalo mark 20×20 + Text signIn.codeSent  fontSize.sm muted flex:1
   ├─ Text policy line  fontSize.xs        ← BETWEEN the field and the CTA
   └─ Pressable signIn.sendCode   ← the one ink pill, alignSelf:'stretch', minHeight 52
```

**Where the legal line sits is positional, not arbitrary.** The reference pass
codes it consistently: *below* the CTA on a welcome screen (§2), *between the
field and the CTA* on a screen where pressing the button is itself the consent —
which is this one. 11–12 pt, `discover.muted`, with only the two link phrases
underlined.

**The hint comes before the press, not after it.** `signIn.codeSent` ("Nếu số này
đã được đăng ký, mã sẽ đến qua Zalo…") is rendered above the button, not revealed
after it — pre-announcing what is about to happen was the most consistent habit
in the whole reference pass, and it also means the Zalo channel is disclosed
before the collector commits a phone number.

The sheet overlaps the hero by `space[6]` — the Glovo/Oura move that makes the
form sit *on* the brand rather than under it, and the cheapest way to get "curvy"
without a single decorative shape.

**Poster, not video.** The sheet scrolls when the keyboard opens, so §0.5 rule 1
gives this screen the still — the film's own frame, without the decoder.

**The sheet is a `KeyboardAvoidingView` wrapping a `ScrollView`**, not a plain
`View`. `behavior` is `'padding'` on iOS and `'height'` on Android, the
`ScrollView` carries `keyboardShouldPersistTaps="handled"` and
`contentContainerStyle={{ flexGrow: 1 }}`, and the CTA sits at the end of that
content with `marginTop: 'auto'`. Without this the Android keyboard covers the
send control on a 640 dp-tall phone and the screen is unfinishable — which is
one of the "nothing has functionality" reports. §4 gets the same treatment for
the same reason: its six boxes plus the resend row must stay above a numeric
keypad.

**The +86 branch.** When the country chip is `signIn.country.cn`,
`signIn.chinaNote` renders **directly under the country + number row**, inside
the same `field` group, at `fontSize.sm` in `discover.muted` — not as a footnote
at the bottom of the sheet, and not as a toast. It explains that row, so it sits
against that row. It does not render for +84. Artboard `03b` in the mock is this
state.

**Motion.** Field focus raises the border from `discover.line` to `color.action`
over `duration.fast` (a `TextInput` prop, not an animation). The sheet rises
`translateY: 24 → 0` on mount over `duration.slow`. **Reduced motion:** no rise.

**Data.** `api.requestSignInCode(phone)` → `void | { demo_code }`. A resolved
promise advances to §4 **whatever the number was** — the route answers 204 for an
enrolled and an unenrolled number alike on purpose, and this screen must not undo
that by telling the collector which they typed. `demo_code`, when the server
sends it, pre-fills §4's field and shows `signIn.demoFilled`.

**Copy.** All existing: `signIn.title`, `signIn.intro`, `signIn.phone`,
`signIn.sendCode`, `signIn.countryCode`, `signIn.country.vn`,
`signIn.country.cn`, `signIn.chinaNote`, `signIn.zaloMark`, `signIn.codeSent`,
`signIn.unavailable`, `legal.privacy`, `legal.dataNotice`.

**Not built.** No email field. No password field. No "continue with Google /
Facebook / Apple". No ZaloPay OAuth (see §22.2). No biometric. No SMS wording —
the channel is Zalo and `signIn.codeSent` names it. No "don't have an account?"
link.

---

## 4. Code verification

**Purpose.** APP-01, step two. Cash App is the reference: the number echoed back,
six boxes, a resend timer counting from arrival.

**Layout (flex).** The same paper ground, no hero — the collector is mid-task and
a photograph here is noise.

```
View flex:1 padding:space[5] paddingTop:statusBar+space[4] gap:space[5]
├─ Pressable back              minHeight:44 alignSelf:'flex-start'
├─ Text signIn.code            fontSize.xl weight.display
├─ Text signIn.sentTo          fontSize.base muted      ← "+84 90 000 0001"
├─ View flexDirection:'row' gap:space[2]
│  └─ six boxes  flex:1 aspectRatio:3/4 radius.base
├─ Text error slot             fontSize.sm reject       ← reserved height, no jump
├─ Pressable resend            ghost, disabled while counting
└─ Row: zalo mark + Text signIn.codeSent  fontSize.sm muted
```

Six `flex: 1` boxes with an `aspectRatio` is the whole responsive story: 44×59 at
320dp, 60×80 at 412dp, and nothing specified in px anywhere. A single hidden
`TextInput` (`keyboardType: 'number-pad'`, `textContentType: 'oneTimeCode'`) owns
the value; the boxes are presentation. One input to manage, not six.

**Motion.** Each box's border goes `line → action` as it fills
(`duration.instant`). A wrong code shakes the row: `translateX` ±6 px over
320 ms, native driver. **Reduced motion:** no shake, error text alone.
Submission is automatic on the sixth digit — no submit button, because a keypad
already ends in a commitment. The wait renders **inside the last box** (a
pulsing dot) rather than as an overlay, per §17.

**The resend control while the timer runs** carries
`accessibilityState={{ disabled: true }}` as well as its dimmed fill, and
`onPress` is `undefined` rather than a no-op. A control that looks disabled and
announces itself as enabled is worse than one that is plainly gone: TalkBack
reads it as actionable, the collector double-taps, and nothing happens.

**Data.** `api.signIn(phone, code)`. `ApiError('credentials')` covers a wrong
number, a wrong code, an expired code and too many guesses — one refusal, because
the server answers one 401 for all four; render `signIn.badCode`.
`ApiError('rateLimited')` renders `signIn.rateLimited`. Success runs
`sessionEntry(api)`, which lands on §5, §6, §7, §8 or §10 in that order.

**Copy.** Existing: `signIn.code`, `signIn.badCode`, `signIn.rateLimited`,
`signIn.resendCode`, `signIn.codeSent`, `signIn.demoFilled`. New:

| key | vi | en | zh |
|---|---|---|---|
| `signIn.resendIn` | Gửi lại sau {s} giây | Resend in {s}s | {s} 秒后重新发送 |
| `signIn.sentTo` | Đã gửi mã tới {phone} | Code sent to {phone} | 验证码已发送至 {phone} |
| `signIn.checking` | Đang kiểm tra mã… | Checking your code… | 正在验证…… |

**Not built.** No "call me instead". No email fallback. No 4-digit variant. No
auto-read of an SMS inbox — the code is not an SMS.

---

## 5. Registration

**Purpose.** APP-01's profile, for a collector whose account exists but whose
name has not been recorded. Two fields, nothing else.

**Layout (flex).** Paper ground; title; intro; **one grouped field object** —
`register.phone` pre-filled from the number just verified and rendered
**read-only** on a `discover.soft` fill, with `register.name` as the single
editable field directly beneath it inside the same `radius.lg` container; then
one ink pill. `gap: space[4]` throughout, and `keyboardShouldPersistTaps="handled"`
on the `ScrollView` so a tap on the button with the keyboard open lands on the
button.

**One question per screen.** The reference pass is near-unanimous that a signup
step asks one thing, and that screens which must show two inputs group them into
a single visual object. The phone is not a second question here — the collector
verified it thirty seconds ago — so it is shown as context, not asked for again.
It is still **sent** to `api.register`, unchanged.

**Motion.** None beyond field focus. Nothing here is worth animating.

**Data.** `api.register(name, phone)` → `CollectorProfile`. `register.missing`
when the name is blank — validated on submit, not on blur, so the field does not
turn red while the collector is still typing in it.

**Copy.** Existing: `register.title`, `register.intro`, `register.name`,
`register.phone`, `register.submit`, `register.missing`. New:

| key | vi | en | zh |
|---|---|---|---|
| `register.phoneVerified` | đã xác minh | verified | 已验证 |
| `register.phoneLocked` | Số này đã xác minh ở bước trước, không sửa ở đây được. | This number was verified a step ago, so it is not editable here. | 此号码已在上一步验证，此处不可修改。 |

**Not built.** No email, date of birth, address, ID upload, avatar, gender or
referral code. The server takes a name and a phone.

---

## 6. Agreements

**Purpose.** APP-02, all six, on **one screen** with toggles — the owner named
Oura's terms screen and it is the right shape: six switches with the document
title beside each, one commit at the bottom.

**Layout (flex).**

```
ScrollView  contentContainer:{padding:space[5], gap:space[3], paddingBottom:footer}
├─ Text agreements.title   fontSize.xl weight.display
├─ Text agreements.intro   fontSize.base muted
└─ 6 × Pressable row   ← radius.lg, backgroundColor discover.surface, minHeight 56
      flexDirection:'row' alignItems:'center' gap:space[3] padding:space[4]
      ├─ View flex:1
      │  ├─ Text agreement.<id>                     fontSize.base
      │  └─ Text agreements.version + ' 1.0'        fontSize.xs muted
      └─ Switch  accessibilityRole:'switch'

View footer  position:'absolute' bottom, discover.paper, top hairline
├─ Text agreements.incomplete   ← only when blocked
└─ Pressable agreements.submit  ← ink pill, disabled until all six are on
```

The submit pill is pinned to the bottom rather than sitting at the end of the
list: at 320×640 six rows plus the intro do not fit, and a commit control a
collector has to hunt for is the shape that produces accidental non-consent. The
row's `Pressable` and the `Switch` share one handler, so the target is the full
56 pt row, not the 51×31 switch.

**Motion.** The switch is the platform's. The submit pill fades from disabled to
enabled over `duration.fast` when the sixth toggle lands — `opacity` only.

**Data.** `api.acceptAgreements(AGREEMENTS.map(a => ({ agreementId: a.id, version: a.version })))`.
The version sent is the version rendered on the row, never "whatever is current
now". The six ids are the server's `collector_agreements_name_check` set and stay
byte-equal to `AGREEMENTS`.

**Copy.** Existing: `agreements.title`, `agreements.intro`, `agreements.version`,
`agreements.submit`, `agreements.incomplete`, and the six `agreement.*` titles.

**Not built.** No seventh toggle. **No "accept all" master switch** — a single tap
granting six separate consents is exactly what the recorded-version-per-acceptance
design exists to prevent. No inline full document text; a row's title opens §16's
reader if the document exists, and shows `detail.notSupplied` if PaXini has not
supplied it.

---

## 7. Training

**Purpose.** APP-03. Behaviour unchanged, restyled.

**Layout.** Paper ground; `work-wide.webp` in a `16/9` box with `radius.lg` at the
top; title; `training.body`; the disclosure `training.placeholder` in a
`discover.soft` inset at `radius.base`; the ink pill `training.done` pinned to the
bottom as in §6.

**Motion.** None. **Data.** `api.completeTraining()`.
**Copy.** Existing: `training.title`, `training.body`, `training.placeholder`,
`training.done`.
**Not built.** No video player (§0.5 rule 1 — this screen scrolls). No quiz here;
the exam is §8. No progress percentage through a document with no sections yet.

---

## 8. Exam

**Purpose.** APP-05. Three statements, each agreed or not, then a pass or fail the
server decides. Behaviour unchanged, restyled.

**Layout.** The same shape as §6 — three toggle rows on `discover.surface`, the
submit pill pinned. The result renders in place of the intro: pass on `pass-bg
#E8F8EE` with the pass glyph, fail on `reject-bg #FDECEC` with the reject glyph,
each carrying its sentence. Colour never alone.

**Motion.** The result block fades and rises 12 px over `duration.slow`.
**Reduced motion:** it is simply there.

**Data.** `api.submitExam(answers: boolean[])` → `{ passed }`. The app does not
decide pass or fail and does not mark which answer was wrong — the server returns
a boolean, and `exam.failed` says to review the training.

**Copy.** Existing: `exam.title`, `exam.intro`, `exam.q1`–`q3`, `exam.submit`,
`exam.passed`, `exam.failed`.
**Not built.** No score, no per-question feedback, no retry limit shown (the
server owns any limit), no timer.

---

## 9. Coach marks on first Home

**Purpose.** The owner's "onboarding and guide screens around the UI (coach
marks)". The machinery already exists — `guide/Guide.tsx` measures a registered
target, punches a hole and draws a card beside it — so v2 restyles it and adds
one step.

**Four steps, in this order:**

| # | target key | copy key | points at |
|---|---|---|---|
| 1 | `home.earnings` | `guide.home.earnings` *(new)* | the cycle figure and its arc |
| 2 | `home.tasks` | `guide.home.tasks` | the task card row |
| 3 | `home.next` | `guide.home.next` *(new)* | the next-step card |
| 4 | `shell.tabs` | `guide.home.tabs` | the tab bar and its raised action |

**Layout.** A scrim at `--scrim rgba(0,0,0,.72)` with a `radius.xl` hole over the
measured target; the card sits on whichever side has more room (the existing
comparison) and never overlaps the hole. **Step 1's target is the whole earnings
card**, not the figure inside it — `useGuideTarget('home.earnings')` goes on the
card's outer `View`. A hole around the figure alone spotlights a number while
hiding the counts and the label that explain where it came from, which is the
opposite of what the step says. **The ring around the hole is `color.action`**,
not lime: the card it surrounds already spends this screen's lime on its review
ring, and two limes on one screen is the bug §0.2 exists to prevent. inside it a step counter (`guide.step` +
"n/4"), the copy at `fontSize.base`, and a row of `common.next` / `common.done` /
skip. The offer to run it (`guide.offerTitle` / `guide.offerBody` /
`guide.offerYes` / `guide.offerNo`) is a bottom sheet on the first Home after the
first sign-in, and the guide is re-openable from `guide.open` on Home forever.

**Motion.** The hole moves between steps by `transform` on its container over
`duration.slow` with `ease`; the card cross-fades. **Reduced motion:** the hole
jumps, the card swaps, no travel.
**§0.5 rule 5 applies hardest here:** the overlay **unmounts** on close. It does
not fade to `opacity: 0` and stay mounted — that is the dead-button bug, and a
coach-mark scrim is the single most likely place to reintroduce it.

**Data.** `guide/seen.ts` (expo-secure-store) records that the offer was made. A
step whose target has not been measured is **skipped**, not drawn over nothing.

**Copy.** Existing: `guide.open`, `guide.offerTitle`, `guide.offerBody`,
`guide.offerYes`, `guide.offerNo`, `guide.step`, `guide.home.tasks`,
`guide.home.tabs`, `guide.tasks.list`, `guide.uploads.confirm`,
`guide.income.split`. New:

| key | vi | en | zh |
|---|---|---|---|
| `guide.home.earnings` | Đây là tiền của các tập đã duyệt trong kỳ này. Người duyệt quyết định con số, không phải ứng dụng. | This is what your reviewed episodes earned this cycle. A reviewer decides the figure, not the app. | 这是本周期已审核片段的收入。金额由审核员决定，而非应用。 |
| `guide.home.next` | Bước tiếp theo của bạn nằm ở đây: nhận việc, liên kết thiết bị hoặc tải lên. | Your next step sits here — claim work, pair a device, or upload. | 您的下一步在这里——领取任务、绑定设备或上传。 |

**Not built.** No multi-screen tutorial carousel in front of the app. No mandatory
walkthrough — `guide.offerNo` is a real answer and the app opens anyway.

---

## 10. Home

**Purpose.** "clear dashboard and warm greetings… price tracking… task collecting
must be image based… clear price per minute, action buttons in highlighted colour
boxes". Future Pro's home (greeting, one big image card, icon row, floating pill
bar) and Klarna's (tinted top, two big rounded cards, a grid, floating pill bar)
are the references.

**Layout (flex), top to bottom.**

```
ScrollView  contentContainer:{paddingBottom: measuredTabBarHeight + space[6]}
├─ View  the greeting block        ← discover.light fill, radius.xl, padding space[5]
│  ├─ Text greeting.<shift>        fontSize.lg  discover.lightInk    ← "Chào buổi sớm"
│  ├─ Text the collector's name    fontSize.2xl weight.display
│  └─ Text shift.<shift>           fontSize.sm  discover.lightInk
├─ View  the earnings card         ← discover.surface, radius.xl, space[5]
│  ├─ Text home.cycleTitle         fontSize.sm muted
│  ├─ Text cycle.confirmedVnd      fontSize.3xl weight.display   ← THE hero figure
│  ├─ Text income.confirmed + home.cycleWithEstimate(totalVnd)   fontSize.sm muted
│  ├─ RingChip + caption           ← reviewed ÷ uploaded COUNTS. The lime moment.
│  └─ Pressable home.incomeLink    ← ghost row with a chevron, opens §14
├─ View  the next-step card        ← the single most important thing to do now
│  ├─ Image 16/9 aspectRatio       ← the claimed task's still, else work-portrait
│  └─ Text + one ink pill
├─ Text home.claimable             fontSize.lg section heading
├─ horizontal FlatList of task cards  ← §11's card at 78 % width, snapped
├─ Text home.more                  fontSize.sm muted
└─ Row of chips  ← Devices · My tasks · Forum · Groups · Training · Guide
```

**The greeting is warm and time-aware.** `greeting.earlyBird` / `dayShift` /
`goldenHour` / `nightOwl` already exist with their `shift.*` partners and are
chosen from the device clock — the one number the client may compute, because it
is neither money nor minutes.

**The hero figure is `confirmedVnd`, and the total is demoted.** The owner wants
"earnings so far this cycle", and the honest answer to "how much have I earned"
is the money a human has already approved. A total that folds in an estimate,
set at 42 px, *is* an estimate presented as confirmed — which APP-34 forbids in
so many words. So the hero is `cycle.confirmedVnd`, and the fuller number is one
demoted line beneath it at `fontSize.sm`, **labelled inline**: `income.confirmed`
+ `home.cycleWithEstimate` → "Đã xác nhận · Kể cả ước tính: 1.284.000 đ". The
estimate never appears as a bare figure anywhere on Home.

**When the server sends no cycle, there is no money on this screen at all.**
`IncomeEntry` has no cycle field and no total, and the app is forbidden from
summing — `income.intro` is a promise printed on the Income screen. The cycle
therefore needs **a new server field**, §14.1. Until it ships:

- the figure is `—` with `home.cycleUnavailable` beneath it;
- **no confirmed/estimated split is shown**, because a per-kind split is a
  per-kind subtotal, and computing one on the client is the same forbidden
  arithmetic as the total. An earlier draft of this section allowed it "from the
  entries the server already labels". That was wrong and is struck;
- what remains is what the server actually sent: the **counts** — episodes
  reviewed over episodes uploaded — and the link into §14.

Any `reduce`, `sum`, `+` or `parseFloat` over `IncomeEntry.amountVnd` or
`effectiveMinutes` is a rejected diff, in either state. Artboard 18 of the mock
is this screen with no cycle, and it is deliberately the emptiest in the set.

**The ring counts episodes, never money.** It is `RingChip` from `ui.tsx`, fed
`reviewed / uploaded` from `api.episodes()` — two integers the app may divide,
because a count is neither a currency nor a duration. Its face reads `8/13` and
its caption is `home.reviewedCaption` over `home.uploadedCaption`. It must never
be given a money fraction: a ring reading 62 % beside a money figure gets read as
"62 % of your pay", which is not a sentence anyone can defend.

**The task card** (shared with §11, defined once):

```
Pressable  radius.xl  backgroundColor:discover.surface  overflow:'hidden'
├─ View    aspectRatio:16/9                        ← scenario → still, §21.2
│  ├─ Image  resizeMode:'cover'  absolute inset:0
│  ├─ View   THE PRICE CHIP   absolute bottom-left, inset space[3]
│  │         discover.light fill, radius.base, padding 6/space[3]
│  │         flexDirection:'COLUMN'                ← two lines, never one
│  │    ├─ Text unitPriceVndPerMinute  fontSize.md weight.display  discover.lightInk
│  │    └─ Text hall.perMinute         fontSize.xs                 discover.lightInk
│  └─ View   the scenario chip   absolute top-right   ← opposite corner, never collides
└─ View    padding:space[4] gap:space[2]
   ├─ Text task.title            fontSize.lg  numberOfLines:2
   ├─ (hall only) the claim progress track   ← neutral fill; see §0.2
   └─ Row: hall.slots · remainingSlots
```

**The price is a chip burned into the photograph's bottom-left corner**, and the
scenario chip goes top-right — the Peerspace arrangement, where two badges on one
image are put in opposite corners so they can never collide at any width. It is
the "highlighted colour box" the owner asked for, it is plum rather than lime so
it can appear on every card without breaking "one lime per screen", and it is on
the image rather than under it because a rate on a photograph needs its own
ground to stay legible.

**On the chip the two parts stack; they do not share a line.** The reference
pass's inline size split (`From $25.65` beside `per person`) assumes a short
unit. `hall.perMinute` is "đ/phút hiệu quả" — 15 characters — and a hall tile at
320 dp is about 150 pt wide, so a one-line chip either overflows the tile or
ellipsises the unit. **An ellipsised pay rate is not acceptable at any width**,
so the chip is a two-line column: the figure, then the unit at `fontSize.xs`.
Neither `Text` carries `numberOfLines`. The inline split survives where there is
room for it — the detail screen, §12.

"đ/phút hiệu quả" is *per effective minute*, and that word is load-bearing: it is
not per minute recorded.

**The floating pill tab bar.** Already built in `shell/TabBar.tsx`: a `GlassBar`
inset `space[3]` from each edge, `bottom: bottomInset(space[6])`, a raised ink
circle for session preparation breaking the bar's top edge, and a two-row form at
`fontScale > 1.2`. **Two changes.**

*First*, the Forum tab is replaced by **Nhiệm vụ** (`tab.tasks` → §11), and Forum
moves to the `home.more` chip row. Forum has no service behind it; the task hall
is the money path, and the owner asked for task browsing to be prominent. The bar
becomes: **Trang chủ · Nhiệm vụ · [Phiên] · Tải lên · Thu nhập**.

*Second*, **the existing two-row form is triggered by width as well as by font
scale.** Measured in the harness at 320 dp: the bar is 296 wide, the session slot
takes 64, and the four remaining tabs get 58 pt each — while "Trang chủ" at
`fontSize.xs` needs about 60. It wraps, that one tab grows taller than its four
siblings, and the raised action collides with the bar. Shortening the word again
is not the fix; the fix is already written. `shell/TabBar.tsx` renders a two-row
form at `fontScale > 1.2` — four tabs in the bar, the session action as its own
full-width control above them — so the trigger becomes
`fontScale > 1.2 || width <= 320`. Content reserves the taller bar through the
same `measureTabBar()` it already uses, and nothing else changes. Artboards
`10/11/13/14-320x640` are this form.

**The raised action's glyph is `GlyphPlus`, not a camera.** `glyphs.tsx` already
exports it. A camera or record glyph on the one raised, highest-affordance
control in the app promises a recording control that **cannot exist** (§0.8), and
it is the most dangerous icon choice available on this screen.
`tab.sessionHint` says so in words; the glyph must not contradict it.

**Motion.** Cards rise `translateY: 12 → 0` and fade, staggered 60 ms, on first
paint only — not on every refocus. The lime arc reveals over `duration.slow` as an
`opacity`/`transform` reveal of a **pre-drawn** arc, not an animated stroke
length, because stroke-dash animation would need SVG (§20.1). Pressing a card
scales it to `0.98` over `duration.instant`. **Reduced motion:** no stagger, no
rise, the arc renders at its value.

**Data.** `api.profile()` (name, gates), `api.income()` (the split and, once
§14.1 lands, the cycle), `api.tasks()` (the claimable row), `api.myClaims()` +
`api.sessions()` + `api.episodes()` (the next-step card's subject),
`api.boundDevices()` (the device gate). The gate strips `home.gateExam` and
`home.gateDevice` render above the next-step card when they apply.

**Copy.** Existing: `greeting.*`, `shift.*`, `home.claimable`, `home.take`,
`home.claimableEmpty`, `home.more`, `home.incomeLink`, `home.gateExam`,
`home.gateDevice`, `home.tasks`, `home.myTasks`, `home.devices`, `home.uploads`,
`home.income`, `home.training`, `income.confirmed`, `income.estimated`,
`hall.perMinute`, `scenario.*`, `guide.open`. New:

| key | vi | en | zh |
|---|---|---|---|
| `home.cycleTitle` | Thu nhập kỳ này | This cycle | 本周期收入 |
| `home.cycleUnavailable` | Chưa có tổng của kỳ này. Bạn vẫn xem được tiền từng tập ở mục Thu nhập. | No total for this cycle yet. You can still see what each episode earned under Income. | 本周期尚无合计。您仍可在收入中查看每个片段。 |
| `home.nextTitle` | Bước tiếp theo | Your next step | 下一步 |
| `home.nextClaim` | Nhận một nhiệm vụ để bắt đầu | Claim a task to begin | 领取一个任务开始 |
| `home.nextPair` | Liên kết thiết bị trước khi tạo phiên | Pair a device before creating a session | 创建会话前请绑定设备 |
| `home.nextUpload` | Có {n} tập chờ tải lên | {n} episodes waiting to upload | {n} 个片段待上传 |
| `home.nextReview` | Đang chờ người duyệt | Waiting on a human reviewer | 等待人工审核 |
| `home.cycleWithEstimate` | Tính cả ước tính: {amount} | Including estimates: {amount} | 含预估：{amount} |
| `home.uploadedCaption` | tập đã tải lên | episodes uploaded | 个片段已上传 |

**Not built.** No record button, and no "start session" that starts anything — the
raised tab action opens the *preparation* form, and `tab.sessionHint` says so out
loud. No streak, leaderboard, badge or level. No "you earned X more than last
week" comparison the server did not send. No push-notification prompt on first
open.

---

## 11. Task hall

**Purpose.** "task collecting must be image based (AI or stock placeholders for
now), clear price per minute". Replaces `screens/TaskHall.tsx`.

**Layout (flex).** The screen title is `fontSize.lg`, not `fontSize.xl` — a
browse screen spends its vertical budget on the grid, not on its own name, and
at 320×640 the `xl` title cost most of a tile row. Then a sticky search + filter
header on `discover.paper`, and a two-column grid: `FlatList numColumns={2}` with
`columnWrapperStyle={{ gap: space[3] }}` and
`contentContainerStyle={{ gap: space[3] }}`. Each tile is `flex: 1` — **never** a
computed pixel width — with a `4/5` image box on top and the title, price box and
progress below. At 320dp the tiles are ~150 pt wide and the price box still fits,
because it is a `flexDirection: 'row'` with `flexWrap: 'wrap'`.

**The claim progress bars here are not lime.** Four tiles each with a lime track
is four accents, which breaks §0.2 outright. In a repeating list the track is
`discover.soft` with a `discover.muted` fill at `radius.pill`, 6 pt tall, and
`hall.progress` with the slot count as text beneath it — the number carries the
meaning, the bar only shows its shape. **This screen has no lime at all**, and
that is correct: one per screen is a ceiling, not a quota.

Filters are two `radius.pill` chips, `hall.all` and `hall.availableOnly`; the
active state is a `discover.light` fill plus a `lightInk` label plus
`fontWeight.semibold` — colour *and* weight, never colour alone.

**Motion.** Tiles fade in as they mount. Pull-to-refresh is the platform's
`RefreshControl`, tinted `color.action`. **Reduced motion:** no fade.

**Data.** `api.tasks()` → `Task[]`. `claimable`, `claimedByMe`, `remainingSlots`,
`claimedMinutes`/`targetMinutes` and `unitPriceVndPerMinute` are rendered exactly
as the server sent them.

**Copy.** Existing: `hall.title`, `hall.search`, `hall.all`,
`hall.availableOnly`, `hall.noMatches`, `hall.perMinute`, `hall.pricePerMinute`,
`hall.progress`, `hall.slots`, `hall.full`, `hall.open`, `scenario.*`,
`common.refreshFailed`.

**Not built.** No sort-by-pay (the server orders the list). No map view. No
distance or location filter — tasks have no coordinates. No "recommended for
you". No infinite-scroll placeholder; the list is the list.

---

## 12. Task detail

**Purpose.** One task, one decision. A hero image, a prominent price, the guide,
and exactly one primary action.

**Layout (flex).**

```
View flex:1
├─ ScrollView  contentContainer:{paddingBottom: footerHeight + space[6]}
│  ├─ View  aspectRatio:3/2   ← the hero still, cover, with a bottom scrim
│  │  ├─ Pressable back    absolute top-left, 44×44, surface circle
│  │  └─ Text task.title   absolute bottom-left, fontSize.xl weight.display, on scrim
│  ├─ View  THE PRICE CARD   ← discover.SURFACE, radius.lg, padding space[4]
│  │  ├─ Row alignItems:'baseline' gap:space[2]     ← one line, the size split
│  │  │  ├─ Text unitPriceVndPerMinute  fontSize.2xl weight.display  discover.ink
│  │  │  └─ Text hall.perMinute         fontSize.sm                  discover.muted
│  │  ├─ Text hall.pricePerMinute       fontSize.xs   ← the full sentence, below
│  │  ├─ hairline
│  │  └─ Text detail.target · targetMinutes · detail.minutes   fontSize.sm
│  ├─ View  the claim progress, IN ITS OWN ROW    ← THE lime moment on this screen
│  │  ├─ Row: hall.progress · hall.slots · remainingSlots   fontSize.sm muted
│  │  └─ track: discover.soft + lime500 fill
│  ├─ Section detail.instructions   ← task.instructions, else detail.notSupplied
│  ├─ Section detail.privacy        ← task.privacyNotice
│  └─ Section detail.payment        ← task.paymentRule
└─ View footer  absolute bottom, discover.paper, top hairline, paddingBottom:bottomInset
   ├─ Text the refusal, when there is one
   └─ Pressable detail.claim   ← the one ink pill, alignSelf:'stretch', minHeight 52
```

**Aspect ratio, not height.** The hero is `3/2` rather than `16/9` so that at
320×640 the price field is above the fold without letterboxing the image.

**The price sits on the card's own ground, in ink — not on plum.** §0.2's rule
is that a money figure is anchored by size and never by a coloured box, and
`unitPriceVndPerMinute` at `fontSize.2xl` is the largest figure on this screen.
Plum is for a rate chip that has to survive being laid over a photograph (§10);
here there is no photograph under it and no legibility problem to solve, so the
tint would be decoration. The progress track then moves out of the price card
into a row of its own, so the lime is read as *the task filling up* and not as
part of the price.

**The inline unit beside the figure is the short one.** `hall.pricePerMinute`
("Đơn giá mỗi phút hiệu quả được duyệt") is 36 characters; sharing a baseline row
with a 33 px figure, it broke "4.500 đ" across two lines in the mock. So the row
carries `hall.perMinute` ("đ/phút hiệu quả") and the full sentence sits
underneath at `fontSize.xs`. Both strings already exist; neither is reworded.

**One primary action, and its refusals.** The pill reads `detail.claim`, and is
**replaced** — not merely disabled — by the reason it cannot be pressed:
`detail.claimed`, `detail.full`, `detail.needExam`, `detail.needAgreements`,
`detail.needTraining`, `detail.notQualified`, `detail.unavailable`. Each is a
server refusal code passed straight through; the app does not guess which applies.

**Motion.** The hero parallaxes at 0.4× scroll via `Animated.event` on
`translateY` with the native driver. The footer's hairline appears when content
scrolls under it. **Reduced motion:** no parallax.

**Data.** `api.task(id)` → `Task`; `api.claimTask(id)` → `Claim`, throwing
`ApiError` with one of the refusal codes above.

**Copy.** All existing `detail.*` plus the `hall.*` keys listed.

**Not built.** **No "estimated earnings" calculator** — multiplying the unit price
by the target minutes is the client computing money, and the result is a number
the server never promised. No share sheet. No favourite or save. No reviews or
ratings.

---

## 13. My sessions and Uploads

**Purpose.** APP-23 through APP-27. **Behaviour is unchanged.** This is the screen
where a restyle is most likely to break something that matters, so the rule is:
every state word, every refusal reason and every confirmation step stays exactly
as it is, and only the surface changes.

**Layout (flex).** A section list: one section per `CollectionSession`, headed by
`uploads.session` + `session.id` and its scenario; inside it, one row per
`EpisodeUpload`.

```
Episode row  ← discover.surface, radius.lg, padding space[4], gap space[2]
├─ Row: the state pill · uploads.size / sizeUnknown
├─ (uploading) the progress track    ← THE one lime moment on this screen
├─ (uploading) Text uploads.sending + the percentage   fontSize.xs muted
├─ (under_review) Text uploads.waitingReviewer         fontSize.xs muted
├─ (review_failed) uploads.reason + the server's rejectReason, on reject-bg
└─ (pending_upload) Pressable uploads.upload  ← opens the confirmation sheet
```

**A passed episode says nothing about minutes or money here.** A first draft put
"18 phút hiệu quả được duyệt" on the `review_passed` row. That is removed:
effective minutes are the multiplicand of a payment, they belong beside the
amount they produced, and §14 is the one screen that shows both together. Two
places showing minutes is two places to disagree, and the one a collector will
quote in a dispute must be the one with the money next to it. The row here shows
the state and the size, and that is all it knows.

**The six states, each with a shape as well as a colour** (never colour alone):

| `EpisodeState` | copy key | fill | glyph |
|---|---|---|---|
| `pending_upload` | `state.pending_upload` | `discover.soft` | up-arrow outline |
| `uploading` | `state.uploading` | `discover.soft` — **not lime** | up-arrow filled |
| `uploaded` | `state.uploaded` | `discover.soft` | check outline |
| `under_review` | `state.under_review` | `warn-bg #FFF4E0` | eye |
| `review_passed` | `state.review_passed` | `pass-bg #E8F8EE` | check filled |
| `review_failed` | `state.review_failed` | `reject-bg #FDECEC` | cross |

**The confirmation step is not a formality and does not move.**
`uploads.confirmTitle` / `uploads.confirmBody` / `uploads.confirmCancel` stay a
deliberate two-tap commitment — APP-25 exists because an upload must never start
from an effect, a timer or a network-state listener. The directory-picker flow
(`uploads.deliverTitle`, `uploads.pick`, `uploads.chooseSession`,
`uploads.hashing`, `uploads.sending`, `uploads.start`, `uploads.resume`) and all
thirteen `uploads.reason*` strings carry over verbatim.

**Motion.** The progress fill animates `transform: scaleX` on the native driver —
**not** `width`, which would run on the JS thread and is the exact shape of the
laggy build. **Reduced motion:** the fill jumps to each value.

**Copy.** One new key, for the row that is waiting on a person:
`uploads.waitingReviewer` — vi "Đang chờ người duyệt", en "Waiting on a
reviewer", zh "等待审核员". Every other string on this screen is carried over
verbatim.

**Data.** `api.sessions()`, `api.episodes()`, and the `DeliveryApi` methods the
state machine in `upload/delivery.ts` drives.

**Not built.** No auto-upload. No background-upload toggle — the Path A
foreground-service TurboModule is not in this pilot. No retry-all. No delete. No
local preview or thumbnail of the collector's own footage.

---

## 14. Income

**Purpose.** "price tracking… per-episode lines, cycle total, payout destination
status". Two of those three do not exist in the API yet; this section specifies
the screen and the two fields it needs.

**Layout (flex).**

```
ScrollView
├─ View the cycle card     ← discover.surface, radius.xl, space[5]
│  ├─ Text home.cycleTitle + cycle.label   fontSize.sm  muted   ← "· 01/09 – 15/09"
│  ├─ Text cycle.confirmedVnd       fontSize.3xl weight.display  discover.ink
│  │                                 ← plain ink on the card's own ground, NOT boxed
│  ├─ Text income.confirmed + home.cycleWithEstimate(totalVnd)   fontSize.sm muted
│  └─ Text income.estimatedHint     fontSize.xs
├─ View the payout card    ← discover.surface, radius.lg
│  ├─ Row: ZaloPay mark · payout.zalopay · the status pill
│  └─ Text the masked destination
├─ Text income.intro       ← "Từng tập một. Ứng dụng không cộng gộp…"
└─ FlatList of episode lines
   └─ Row  ← radius.lg; SOLID border when confirmed, DASHED when estimated
      ├─ Text episodeId (shortened) · income.minutes · effectiveMinutes
      ├─ Text income.amount · amountVnd        fontSize.lg weight.display
      ├─ Pill income.estimated / income.confirmed
      └─ Text income.settlement · settlement.<state>
```

The estimated/confirmed distinction is carried by **border style** (dashed vs
solid) as well as by a labelled pill — APP-34 says an estimate is never presented
as confirmed, and `guide.income.split` already explains the dash to the collector.
A `null` `effectiveMinutes` or `amountVnd` renders as `—`, never as `0`: the
server having nothing to say is not the same as a zero.

**The hero is the confirmed figure**, exactly as on Home (§10), and for the same
APP-34 reason. `estimatedVnd` never appears as a bare figure; it reaches the
screen only inside `home.cycleWithEstimate`, which names it in the same sentence.

**The two missing fields** are specified in §14.1 and §14.2. Until they land the
cycle card renders `home.cycleUnavailable` with no money and no split (§10), and
**the payout card defaults to `status: 'unknown'`** — the pill reads
`payout.awaiting` and the body reads `payout.unknown`. `verified` is rendered
only when the server has actually sent it. A mock or a fixture that seeds
`verified` teaches everyone who reviews it a state the platform has never
produced, and the first real collector to see "Chờ xác minh" will read it as a
regression. **Neither field is faked client-side.**

**Motion.** None beyond the list fade-in. A money screen that animates its numbers
is a money screen people distrust.

**Data.** `api.income()` → `IncomeEntry[]`, plus §14.1 and §14.2.

**Copy.** Existing: every `income.*` and every `settlement.*`. New:

| key | vi | en | zh |
|---|---|---|---|
| `payout.title` | Nơi nhận tiền | Where you get paid | 收款方式 |
| `payout.zalopay` | Ví ZaloPay | ZaloPay wallet | ZaloPay 钱包 |
| `payout.verified` | Đã xác minh | Verified | 已验证 |
| `payout.awaiting` | Chờ xác minh | Awaiting verification | 待验证 |
| `payout.none` | Chưa khai báo. Hỏi điểm hỗ trợ. | Not set — contact a support point | 未设置——请联系支持点 |
| `payout.unknown` | Chưa rõ bạn nhận tiền ở đâu. Điểm hỗ trợ sẽ cài giúp bạn. | We do not yet know where to pay you. A support point can set it up. | 尚未确定您的收款方式，请联系支持点。 |

**Not built.** **No cash-out button** — settlement is manual and offline, which is
the sixth agreement the collector signed. No bank-account entry, no wallet-linking
flow, no KYC upload. No projection, no "at this rate you'll earn…". No tax or fee
breakdown the server did not send.

### 14.1 New server field: the cycle total

`GET /api/me/income` gains a sibling object beside the entries:

```ts
interface IncomeCycle {
  label: string;          // the server's own words, e.g. "01/09 – 15/09"
  confirmedVnd: string;   // already quantised by packages/api/src/money.ts
  estimatedVnd: string;
  totalVnd: string;
}
```

Four strings, already rounded, computed where every other number in this system is
computed. The app renders them and adds nothing.

### 14.2 New server field: the payout destination

`GET /api/me/payout` → `{ channel: 'zalopay', status: 'verified' | 'awaiting' | 'none', masked: string | null }`.

`masked` is the server's own redaction (e.g. `•••• 8891`); the app never holds a
full account identifier.

---

## 15. Devices and pairing

**Purpose.** APP-06 to APP-09, **explicitly labelled as mocked** where it is
mocked. A real build gets `UnavailableDeviceTransport` today, and
`devices.unavailable` already says so in Vietnamese.

**Layout.** A list of `BoundDevice` cards (serial, `devices.boundAt`,
`devices.status` → `devices.active` / `faulty` / `retired` / `unknown` as a pill
with a glyph). Below it the bind form: `devices.scanQr` as a secondary control
that opens the mock scanner and prints `devices.qrMock` on its own face,
`devices.typed` as the manual field, and `devices.bind` as the ink pill.
`devices.provision` **is disabled**, not merely a link into a screen that cannot
work: `UnavailableDeviceTransport` is what a real build gets, so the control
renders at `opacity: 0.55` with `accessibilityState={{ disabled: true }}` and no
`onPress`, and `devices.unavailable` sits **inside the same card, directly under
it**. The same applies to `devices.scanQr`, with `devices.qrMock` under it. When
the Bluetooth transport lands, both controls enable and both sentences go; until
then a collector must not be able to walk into a dead screen and conclude the app
is broken. The `prov.*` strings and the provisioning screen stay exactly as they
are, behind that gate.

**The mock-labelling rule.** Anything that does not do what it appears to do
carries its disclosure **inside the same card**, at `fontSize.sm` in
`discover.muted` — not in a toast, not in a footnote. The four places this
applies: `devices.qrMock`, `devices.unavailable`, `training.placeholder`,
`forum.notConnected`.

**Motion.** None. **Data.** `api.boundDevices()`, `api.bindDevice(serial)` with
`devices.notFound` / `devices.otherCollector` / `devices.bindFailed`.

**Not built.** No firmware update. No battery or storage readout. No device
settings. **No recording control** — most pointedly here, because this is the
screen a device-control button would feel natural on, and it must not exist.

---

## 16. Profile, and the legal pages

**Purpose.** The owner's "all the privacy policies", plus the things with nowhere
else to live.

**Layout.** A grouped list on `discover.paper`:

1. **Identity** — name, phone, a `discover.light` avatar disc with the initial.
2. **Language** — the existing `common.language` chip, cycling vi → en → zh.
3. **Documents** — `legal.privacy`, `legal.dataNotice`, and the six `agreement.*`
   titles with their version and accepted-at date from
   `CollectorProfile.agreements`. Each opens the reader.
4. **Elsewhere** — Training & exam, Forum, Groups, the guide.
5. **Sign out** — `signIn.signOut`, a ghost control at the bottom, with
   `signIn.clearFailed` as its failure state. That string exists because handing
   the phone to the next collector with a live token is the real risk.

**The reader.** One screen: a title, the version, and the body scrolled on
`discover.surface` at `fontSize.base`, lineHeight 1.5, `space[5]` gutter. The
console has exactly one legal surface today —
`apps/console/src/components/discover/DiscoverPrivacy.tsx`, 34 lines — so **the
privacy copy is reused from there**, and the data notice and the six agreement
documents render `detail.notSupplied` until PaXini supplies them. That is the
honest state, and it is visible rather than hidden behind a dead link.

**Not built.** No password change (there is no password). No email preferences
(there is no email). No notification settings until there are notifications. No
in-app account deletion — the account was opened at a support desk.

---

## 17. Empty, loading and error states

One shape, used everywhere, so a collector learns it once.

**Loading.** Skeletons, never a spinner, on any screen whose layout is known in
advance — Home, the hall, income, uploads. A skeleton is a `discover.soft` block
at the real element's `radius` and `aspectRatio`, pulsing `opacity` 0.6 → 1.0 over
900 ms on the native driver. **Reduced motion:** static blocks at 0.8.
`common.loading` is announced via `accessibilityLiveRegion`, not printed. The one
exception is `signIn.restoring`, which is text on a bare screen because the layout
is not known yet.

**A pending action loads inside the control that started it** — the ink pill
keeps its size and swaps its label for a spinner, the way every app in the
reference pass does it. There is no full-screen blocking overlay for an action,
ever: it is the shape that produces the dead-button bug (§0.5 rule 5) and it
hides the thing the collector is waiting on. `common.saving` ("Đang gửi…") is the
label for a pill in flight.

**Empty.** A centred block with `space[8]` vertical padding: **Trúc, rendered by
`identity/Panda.tsx`** at 96 pt — the real component that is already in the app,
never a grey disc, never an emoji and never a new illustration. It takes a
`Pose` (`idle` | `wave` | `point`); empty states use `idle`. Beneath it the
existing sentence, and — where an action exists — one ghost control. Per screen:
`home.claimableEmpty`, `hall.noMatches`, `mine.empty`, `devices.empty`,
`uploads.empty`, `income.empty`, `forum.empty`, `uploads.noSessions`,
`session.noRecord`.

**Error.** Three kinds, and they are not interchangeable:

| kind | shape | copy |
|---|---|---|
| **Load failed, nothing to show** | full-screen block + retry pill | `common.loadFailed` |
| **Refresh failed, stale data on screen** | a strip pinned above content that is **kept**: `--warn-bg #FFF4E0` fill with **`--warn #7E5200`** as its ink (`color.warn` in `native.ts`; never `discover.ink` on that fill, and never the fill without that ink) | `common.refreshFailed`; `income.stale` on §14 |
| **Action failed** | inline, under the control that failed, in `reject` ink | `common.actionFailed`, or the specific refusal |

The second is the one usually got wrong: **a failed refresh must not blank a
screen that already had data on it.** `common.refreshFailed` exists and already
says the previous result is being kept.

**Offline.** There is no offline mode and no cached copy of claims or money —
a recorded decision, not an omission (*"a phone's snapshot of claims and money
goes stale the moment the app closes… showing yesterday's figures as if they were
today's is worse than a spinner"*). Offline is a load failure with a retry.

---

## 18. Accessibility floor

- Every control has an `accessibilityRole` and an `accessibilityLabel`. Tab items
  are `tab` with `accessibilityState.selected`; the raised action is a `button`
  whose caption is `accessible={false}` so it is one stop, not two. Both already
  hold and must survive the restyle.
- The 44 pt minimum applies to **every** `Pressable`, including the back control
  and the country-code chip.
- Contrast: body text is `discover.ink` on `discover.paper` or `discover.surface`;
  `discover.muted` is the floor and is never used below `fontSize.sm`. Text over
  the hero film sits on the three-stop scrim, measured against the actual clip at
  the headline's position, not assumed.
- Colour is never the only carrier: verdicts and states carry a word and a glyph,
  the estimated/confirmed split carries a border style, active chips carry a
  weight change.
- `fontScale` to 1.3 must not clip: every row is `minHeight`, never `height`, and
  nothing has `numberOfLines` except task titles (2) and forum previews (2).
- Every new pair added to §0.1's table goes through `packages/design/test/contrast.test.ts`
  before it is used, the same gate the console's colours pass.

---

## 19. Screens deliberately not redesigned

Forum (`forum.*`) and Groups (`groups.*`) keep their current layout and copy and
receive only the ground, radius, type and card treatment from §0. They are
previews with no service behind them, `forum.notConnected` says so on its own
face, and spending design on them ahead of the money path would be the wrong
order.

---

## 20. Technical basis

The bias is least new machinery. One native module is added. Everything else the
owner asked for is done with what is already installed.

### 20.1 What is added, and what is not

| Module | Verdict | Why |
|---|---|---|
| **`expo-video` 57.0.4** | **ADD** | The Welcome hero and the splash clip. Already pinned, already proven, with a web stub and a vite alias, on `lane/mobile-ui` at `9f33709`. There is no `<Video>` in React Native core. |
| `expo-image` | **NO** | Its value is remote-image caching, placeholders and off-thread decode. Every image in this spec is a **bundled** `require()` asset — nothing to cache and nothing to place-hold. Core `Image` with `resizeMode="cover"` in an `aspectRatio` box does the job. **Add it the day `Task` grows an `imageUrl`** and task images become remote. |
| `react-native-svg` | **NO** | The only vector the app needs is the wordmark, and it is one static shape that ships as a raster at 2× and 3×. §20.2 removes the other reason to want it. |
| `react-native-reanimated` | **NO** | §0.5 rule 4 restricts every animation in this spec to `opacity` and `transform`, which the core `Animated` API drives on the UI thread with `useNativeDriver: true`. The one animation that would have needed more — an animated arc stroke — is specified as a pre-drawn reveal instead (§10). Reanimated is a Babel-plugin-level dependency and a worklet runtime; it buys nothing this spec asks for. |
| `lottie-react-native` | **NO** | Nothing here is a Lottie. |

Net: `expo-video` is the only addition, and it was already going to be added.

### 20.2 The splash animation: pre-rendered clip, not a vector animation

**Decision: pre-render the console's `AssemblyLogo` to a 1080×1920 H.264 clip with
Playwright + ffmpeg and play it in `expo-video`.**

The alternative was an SVG path animation. Costed honestly, it is not cheaper:
`react-native-svg` is a native module, and its props are not animatable on the UI
thread by the core `Animated` API — so an SVG splash drags in **reanimated as
well**, i.e. two native modules and a worklet runtime, to reproduce an animation
that already exists, already has authored waypoints, and would then have to be
kept in sync with the console's by hand.

The pre-render is one build step, run when the logo geometry changes and not
otherwise:

```sh
# apps/collector/scripts/render-splash.mjs  (to be written with the RN work)
#  1. serve the console, open /?splash-capture, which mounts AssemblyLogo alone
#     on a discover.paper field at 1080×1920 with the final caption
#  2. Playwright screencast at 60 fps for 1600 ms
#  3. ffmpeg -c:v libx264 -pix_fmt yuv420p -crf 26 -an -movflags +faststart
```

**The tradeoffs, stated rather than hidden.**

- *Against:* the clip is fixed at one aspect ratio and one ground colour, so it
  cannot recolour for dark mode and letterboxes on an unusual aspect. **Mitigated
  by §0.1** — this is a light-ground app, and the clip is composited on the exact
  `discover.paper` hex, so an unfilled edge is invisible.
- *Against:* it must be regenerated when the wordmark geometry changes. The
  console's own `export-master.mjs` already has that property, so it is one more
  line in the same runbook, not a new discipline.
- *For:* zero new native machinery, pixel-identical to the console, deterministic
  on every device, and a perfect handoff — the last frame equals the static PNG,
  so the Welcome cross-fade is two identical images.
- *Against the "no video" instinct:* §0.5's jank finding is about video **during
  scroll**. The splash does not scroll and nothing else is on screen, so this is
  precisely the case where a `VideoView` is free.

### 20.3 Everything else, with what is installed

- **Motion**: core `Animated`, native driver, `opacity` and `transform` only.
- **The wordmark**: `playerone-wordmark.svg` exported to PNG at 2× and 3× at
  build time. The monochrome variant is tinted per surface with `tintColor`.
- **Glyphs**: `src/glyphs.tsx` already draws the icon set with `View` borders and
  transforms — no icon font and no SVG. v2 adds one glyph (the eye, for
  `under_review`) in the same style.
- **The tab bar's glass**: `ui.tsx`'s `GlassBar`, which composites `fill` over the
  ground because RN has no blur. On warm paper that reads better than it did on
  lavender, since the ground behind it varies more.
- **Persistence**: `expo-secure-store`, one key for the token, one for the guide's
  seen-flag. Unchanged.
- **Verification**: the existing `apps/collector/web` harness (vite +
  react-native-web + the mock API) and `web/shots.mjs` Playwright script are the
  proof a visual change carries. `shots.mjs` gains the v2 screens and the new
  320×640-in-Vietnamese case. It honestly cannot show Android elevation, real
  insets, the system typeface, TalkBack order or on-device animation timing —
  those are checked on the emulator, not argued from a screenshot.

### 20.4 The build order: two builders, two days

Two builders working in parallel worktrees off `lane/mobile-v2`. The split is by
**shared surface**, not by screen count: A owns everything that is not signed in
plus the shell, B owns everything behind the sign-in gate. They touch one file in
common — `i18n.ts` — and they add keys to different blocks of it.

| | Builder A — the door and the shell | Builder B — the work and the money |
|---|---|---|
| **Day 1** | §0 tokens applied to `theme.tsx` and `ui.tsx`; §1 Splash (still path first); §2 Welcome; §3 sign-in; §4 verification | §10 Home; §11 Task hall; §12 Task detail; the shared task card and price chip |
| **Day 2** | §5 Registration; §6 Agreements; §7 Training; §8 Exam; §10's tab bar including the ≤320 two-row trigger | §13 Uploads; §14 Income; §17 states across both halves; §9 coach marks |

**The one hand-off:** the task card and its price chip (§10) are built by B on
day 1 morning and land in `ui.tsx` before A needs them for nothing — A does not
need them at all, which is why this split works. The tab bar is A's because it is
shell; B's screens consume it through `useTabBarReserve()` and never style it.

**Definition of done — per screen, not per day.** A screen is done when all five
hold, and the evidence is attached to the commit:

1. **Three emulator screenshots**: 360×780, 390×844, 412×915, in **Vietnamese**.
   Not the browser harness — the harness cannot show Android elevation, real
   insets or the system typeface (§20.3), and those are three of the things the
   owner called horrendous.
2. **Every tap proven.** Each control on the screen is pressed on the emulator
   and does what §1–§17 says it does. A screen whose buttons have not been
   pressed is the "nothing has functionality" report, restated.
3. **`adb shell dumpsys gfxinfo <pkg> framestats` under 10 % janky frames** over
   a 10 s scroll of that screen. The previous lane measured 38 % with the film
   playing and 4 % without; 10 % is the line between those, and any screen over
   it gets its video or its JS-thread animation removed before it is called done
   (§0.5).
4. **320×640 in Vietnamese** for any screen carrying the tab bar — the case that
   fails first (§0.4).
5. **No literal colour, size or radius in the diff.** `grep -nE "#[0-9a-fA-F]{3,6}|fontSize: [0-9]|borderRadius: [0-9]" src/` returns nothing new.

**If the two days run short, cut in this order.** Each line says what the app
still does without it, so the cut is a decision and not a casualty:

1. **The splash clip.** Ship §1's reduced-motion still instead — the static
   wordmark, held 400 ms, then the same cross-fade. The app opens correctly and
   nobody is blocked; §20.2's Playwright render is a separate afternoon. *This
   is the first cut because it is the only item with a whole build pipeline
   behind it.*
2. **Coach marks (§9).** The machinery exists and works today; it can ship with
   its current styling and be re-skinned later. `guide.offerNo` is a real answer,
   so a collector who never sees them loses nothing they need.
3. **The Devices restyle (§15).** It keeps its current layout with only the §0
   ground and radii. It is a screen a collector visits once, at a support desk,
   with a person beside them.
4. **Profile and the legal reader (§16).** The legal documents are reachable
   from §2 and §3's policy lines either way, which is where the law needs them.
5. **The task-detail parallax (§12).** Delete the `Animated.event`; the hero is
   then a static image. Nobody has ever asked for a parallax.
6. **The income list restyle (§14).** Keep the existing rows; the cycle card and
   the payout card are the new parts and they are the part the owner asked for.

**What is never cut**, in any order, because each is a promise rather than a
finish: the two-declaration flow (§APP-17b), the six agreements (§6), the upload
confirmation (§13), the estimate/confirmed distinction (§14), and every "not
built" line in §0.8.
---

## 21. Assets

### 21.1 The bundle

Everything ships from `apps/collector/assets/discover/`, derived from
`apps/console/public/discover-media/20260909/` and capped for a phone. Current
total **2.7 MB**, against a budget of +25 MB.

| File | Source | Resolution | Size | Used by |
|---|---|---|---|---|
| `pov-portrait.mp4` | console `20260909/` | 720×1280, 12 s, H.264 | 2.36 MB | §2 Welcome hero — the only video in the app besides the splash |
| `pov-portrait.webp` | derived, capped 1080 px | 1080×1920 | 51 KB | §2 reduced-motion still, §3 sign-in hero |
| `work-wide.webp` | derived, capped 1080 px | 1080×608 | 39 KB | §7 Training header |
| `work-portrait.webp` | derived, capped 1080 px | 1080×1350 | 39 KB | §10 next-step card fallback |
| `work-detail.webp` | derived, capped 1080 px | 1080×720 | 49 KB | §12 task detail hero fallback |
| `review-poster.webp` | derived, capped 1080 px | 1080×608 | 12 KB | §14 income header, §13 under-review rows |
| `setting-kitchen.jpg` | derived, capped 1080 px | 1080×720 | 22 KB | task image for `scenario: 'home'` |
| `setting-workspace.webp` | derived, capped 1080 px | 1080×720 | 10 KB | task image for `scenario: 'office'` |
| `setting-terraces.webp` | derived, capped 1080 px | 1080×720 | 69 KB | task image for `scenario: 'shop'` |
| `setting-warehouse.webp` | derived, capped 1080 px | 1080×720 | 34 KB | task image for `scenario: 'warehouse'` |
| `playerone-wordmark.svg` | `logo-animation/` | 784×152 vector | 3 KB | source for the 2×/3× PNG export (§20.3) |
| `splash.mp4` | **to be generated** by §20.2 | 1080×1920, 1.6 s | ≤ 600 KB budget | §1 Splash |

`opening.mp4` (1280×716 landscape, 2.2 MB) is **deliberately not bundled**: the
hero is portrait, and cover-cropping a landscape film to 9/16 shows a centre
slice. It stays in the console, where it is the right shape.

### 21.2 Task images, and where the real ones go

`Task` has no image field. Until it does, a task's image is chosen from its
`scenario` — `home` → kitchen, `office` → workspace, `shop` → terraces,
`warehouse` → warehouse — via one four-entry map. A `null` scenario falls back to
`work-detail.webp`. This needs no API change and works today.

These are **real photographs of real settings, used as placeholders for a task
whose own image does not exist yet**, and every screen carrying one shows the
disclosure the console already uses for exactly this (`discover.stockLabel`'s
sibling; on the phone it is `hall.imageLabel`, a new key). When `Task` grows an
`imageUrl` the map is deleted, `expo-image` is added (§20.1), and the disclosure
goes with it.

| key | vi | en | zh |
|---|---|---|---|
| `hall.imageLabel` | Ảnh minh họa bối cảnh | Illustrative setting photograph | 场景示意图 |

---

## 22. Open questions for the owner

Five, in the order they block work.

1. **The cycle total and the payout status do not exist in the API.** §14.1 and
   §14.2 specify the two fields. The app is forbidden from computing either — the
   promise "Ứng dụng không cộng gộp và không tự tính tiền" is printed on the
   Income screen and the whole `CollectorApi` shape is built to make it
   impossible. Confirm the server will supply them; until then Home and Income
   show the honest "the server has not sent this" state.
2. **"ZaloPay login and auth" vs Zalo ZNS.** CLAUDE.md binds sign-in to a
   one-time code over **Zalo ZNS** — a notification channel, not an identity
   provider. This spec reads "ZaloPay" as the **payout destination** (§14.2) and
   keeps auth as phone + ZNS code. If ZaloPay OAuth is actually wanted as a
   sign-in method, that is a platform change, not a design change, and it needs a
   decision before §3 is built.
3. **The ground moves from lavender to warm paper** (§0.1), which makes one
   sentence in `native.ts` and one in DESIGN.md stale, and means the collector app
   stops following the device's dark-mode setting. Approve or reject before the
   mock becomes code.
4. **Forum loses its tab-bar slot to the task hall** (§10). Forum is a preview
   with no service behind it; the hall is the money path. Confirm that is the
   right trade for the demo.
5. **Task images are photographs of settings, not of the tasks**, and are labelled
   as illustrative (§21.2). Is that acceptable for the demo, or should AI or
   licensed stock images be commissioned per task before it ships?
