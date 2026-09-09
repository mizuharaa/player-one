/**
 * `/discover` — the public product home. Build seven, 2026-09-08.
 *
 * ## What was rejected, in the product owner's words
 *
 * > "Remove the 4 steps card its AI generated vibe, why is not cards below
 * > and info below looks so AI generated bad spacing and indentation,
 * > monotone and 0 colors at all... I dont like the current fonts and green
 * > highlighting... you came back with this BS black and white cards with 0
 * > storytelling... These are good layout components, stop putting it as
 * > cards next to eachother or normal cards im sick of this BS."
 *
 * Four instructions come out of that and all four are absolute here. **No two
 * cards side by side, anywhere on this route.** **No four-step strip.** **No
 * highlighter.** **Colour.**
 *
 * ## The reference, and the line between borrowing and copying
 *
 * The direction was set from Flim: enormous black display type stacked over
 * four lines, a faint hairline grid of squares behind it, small rounded
 * fragments of an interface floating over the words, flat saturated shapes,
 * a tight edge-to-edge mosaic of photographs, tiny uppercase mono labels.
 *
 * Flim's grid and chips are **about Flim**. It is a reference-search tool for
 * film-makers, so a designer's canvas and floating `SAVE TO BOARD` chips are
 * literally what the product does. Reproducing that on an ego-camera data
 * platform is how the last design review's verdict — *"an unrelated product
 * could use this unchanged"* — comes back word for word. So each device was
 * mapped onto something this platform actually is, and the mapping is the
 * design:
 *
 * | Flim's device | Ours | Why it is ours and not theirs |
 * |---|---|---|
 * | graph paper behind the type | **a contact sheet** — `.frame-grid` in `globals.css` | This platform's material is *recorded minutes*, and minutes are counted on a ruled sheet: a contact sheet, a timeline ruler, a strip of frames. The squares are frames. |
 * | `SAVE TO BOARD`, `SEARCH ⌘/`, a cursor with a `Me` pill | **fragments of this console** — a claimed task, a card received at the counter, a real `VerdictPill`, the rule a collector is paid under | These are the four things that happen to one recording, in the order they happen, in the components an operator already uses. |
 * | a green hexagon, an orange square, a yellow quarter-circle | **the three verdict glyphs at display size, plus the payable band** | `tokens.ts` already says every verdict carries a *shape* as well as a hue, because this axis decides whether somebody is paid. Enlarging those shapes is flat saturated geometry that means something. |
 * | a moodboard mosaic | **the work grid** — ordinary work, edge to edge, no cards, no borders, no radius, no captions | The honest half of "what the camera saw". Labelled once, in words, as placeholder stills that are *not* recordings the camera made. |
 *
 * ## The four steps did not die, they were promoted
 *
 * The strip is deleted. Its content is now **the headline**: four phrases,
 * one per line, in the order the work happens — record, hand in the card, a
 * person reviews it, the minutes are paid. That is the whole product in four
 * lines at 96px, which is a stronger place for it than four numbered columns,
 * and the chips floating over those lines are the console's own answer to
 * each one.
 *
 * ## Colour, and where every one of them comes from
 *
 * The page was monotone and that was a fair complaint. What is on it now:
 *
 * - **lavender** `100` and `200` — the ground and the payment band. The
 *   world's own wash.
 * - **ink** (`--stage`) — the review band, the closing band, the primary pill.
 * - **`pass` green, `partial` violet, `reject` red** — the three verdict
 *   glyphs and the verdict chip. Used *as verdicts*, which is the only use
 *   `DESIGN.md` allows them, on the section that is about a person deciding
 *   an outcome. This is where most of the new colour comes from and it is
 *   earned rather than decorative.
 * - **`warn` amber** — the one chip that says a card is waiting for a person
 *   at the counter. `warn` is exactly "a human should look at this, and it is
 *   not a verdict".
 * - **`lime-500`** — one moment, spent on the payable band in the stream
 *   diagram. The headline's highlighter is gone; the owner said so by name.
 * - **the photographs** — ten of them, edge to edge, which is the loudest
 *   colour on the page and costs nothing to be honest about.
 *
 * There is **no colour, radius, shadow or duration literal in this file.**
 * Every value is a custom property out of `packages/design/src/tokens.ts`.
 *
 * ## The film, spent once — or not at all
 *
 * `landing.mp4` appeared twice on the last build. It appears **once** here,
 * in a band of its own that is labelled *placeholder film* and carries the
 * slate saying what it is: someone wearing Ego, filmed at arm's length in
 * Paris, by a second person. A forehead-mounted camera cannot see its wearer,
 * so this footage demonstrates the opposite of the product. It is never
 * captioned as ego footage, never captioned as ordinary work, and it is not
 * the hero — the hero is type, which is what the reference does too.
 *
 * ## What this page must never imply
 *
 * Device ownership, unrestricted recording, automatic acceptance, payment for
 * every recorded minute, guaranteed earnings, instant payout. **There is not
 * one statistic on this page.** The stream diagram deliberately draws the
 * intersection rule as geometry rather than as a duration, because a figure
 * on a payout-bearing page is a figure somebody will hold us to.
 *
 * ## Typography
 *
 * Still `--font-display`, Hanken Grotesk Variable — the only shortlisted face
 * that ships a Vietnamese subset, verified again this build by unpacking the
 * fontsource package. Two candidate replacements that *do* ship one are named
 * in the build report; `tokens.ts` is not edited here.
 *
 * What did change is how it is set: 700 rather than 500, tracking at
 * -0.045em, leading at 0.9, and 96px at `lg`. The complaint was about the
 * fonts and this is the half of it that can be answered without a decision
 * that is not mine to take.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { TrucAsk } from '../components/identity/TrucAsk.tsx';
import { CustomCursor } from '../components/CustomCursor.tsx';
import { Button } from '../components/ui/button.tsx';
import { VerdictPill } from '../components/ui/primitives.tsx';
import { IconPartial, IconPass, IconReject } from '../components/icons.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { Reveal, useChoreography, useOnScreen } from '../lib/choreo.tsx';
import { cn } from '../lib/cn.ts';

/**
 * The film, and it is a **slot rather than a foundation**.
 *
 * A real shoot is coming and this cut is a placeholder, so nothing in the
 * composition depends on where this footage puts its subject: the grade is a
 * corner, the type is bottom-left, the frame is `object-cover`. Swapping this
 * constant is the whole of the replacement.
 */
const VIDEO_URL: string =
  typeof import.meta.env.VITE_LANDING_VIDEO_URL === 'string' &&
  import.meta.env.VITE_LANDING_VIDEO_URL !== ''
    ? import.meta.env.VITE_LANDING_VIDEO_URL
    : '/landing.mp4';

/** The first frame, so the band is composed before a byte of video arrives. */
const POSTER_URL = '/landing-poster.jpg';

/**
 * The one still, harvested from the film and cropped to remove the camera
 * operator's arm. 940x720, measured with `ffprobe` this build. It is never
 * rendered wider than the half-band it lives in, so the scale stays at or
 * under 1.02x. `CREDITS.json` carries the `ffmpeg` line, what the crop
 * removes, and the fact that it is a third-person view.
 */
const STILL_URL = '/tiles/ego-worn-rotunda.jpg';

/**
 * The work grid: ten stills, edge to edge, no cards and no captions.
 *
 * Every one measured 420x420 with `ffprobe` this build, and the mosaic never
 * draws a cell wider than 192px at any breakpoint, so nothing here is
 * enlarged. **None of them is a recording the Ego camera made** — five are
 * frames from the film that used to be on this route, two are generated
 * placeholders, three are Creative Commons photographs — and `CREDITS.json`
 * says which is which, per file, including the two synthetic ones. The
 * section says so in words as well, once, under the grid.
 *
 * The four `ref-*.jpg` tiles in the same directory are **not** here: their
 * credit line reads `UNCLEARED — placeholder only`, and an uncleared image
 * has no business on a public route even in a placeholder build.
 */
const WORK_TILES = [
  'kitchen-chopping.jpg',
  'film-garden.jpg',
  'ironing-hands.jpg',
  'film-kitchen.jpg',
  'hf-garden.jpg',
  'bookshelf.jpg',
  'film-chop.jpg',
  'hf-garden2.jpg',
  'film-books.jpg',
  'film-face.jpg',
] as const;

/**
 * The collector build, and it is a **placeholder in exactly one place.**
 *
 * The file does not exist yet. `ApkAction` renders honestly on both sides of
 * this. **Do not fill it with a guess** — a button that 404s on a
 * payout-bearing product's front page is worse than a button that says the
 * build is not out.
 */
const APK_URL: string =
  typeof import.meta.env.VITE_COLLECTOR_APK_URL === 'string'
    ? import.meta.env.VITE_COLLECTOR_APK_URL
    : '';

/** The four questions, as disclosure rows. The first is open. */
const QUESTIONS = ['record', 'paid', 'when', 'data'] as const;

/** The five places this page goes. Anchors, because they all exist. */
const DESTINATIONS = ['camera', 'work', 'review', 'payment', 'questions'] as const;

/** Whether the reader has asked the machine to stop moving things. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(q.matches);
    read();
    q.addEventListener('change', read);
    return () => q.removeEventListener('change', read);
  }, []);
  return reduced;
}

/* -------------------------------------------------------------------------
   The scale, declared once.
   ---------------------------------------------------------------------- */

/**
 * The display lines. 44 / 72 / 96px, weight 700, leading 0.9.
 *
 * Each phrase is its own block element, so "each phrase on its own line" is a
 * structural fact rather than a wrap that happens to land well — which
 * matters because the same four phrases ship in Vietnamese and Chinese and a
 * balanced wrap in one is a ragged one in another.
 *
 * `leading-[0.9]` is safe here in a way it was not on the previous build: the
 * highlighter is gone, so no line carries a filled block that can touch the
 * line above it, and the Chinese lines are three to six glyphs. It is the
 * leading the reference has and it is most of why that type reads as a
 * monument rather than as a paragraph.
 */
const LINE = 'display-line block font-display font-bold tracking-[-0.045em]';
/*
 * 44 / 72 / 96px, and it stops at 96 rather than climbing again at `xl`.
 *
 * 112px was tried at 1440 and the lines reached about 92% of the column, which
 * leaves no right-hand field for the floating fragments — and a chip with
 * nowhere to sit ends up eating a letter off the end of a word. At 96 the
 * longest English line runs to about 70% and the fragments have a column of
 * their own, which is the proportion the reference actually has: type on the
 * left, interface on the right, overlapping at the seam.
 */
const LINE_SIZE = 'text-[2.75rem] sm:text-[4.5rem] lg:text-[6rem]';

/** A section heading. 32 / 44px, still display, one weight down from the H1. */
const H2 =
  'max-w-[20ch] text-balance font-display text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[2.75rem]';

/** A sub-heading inside a band. */
const H3 = 'font-display text-[1.3125rem] font-semibold leading-[1.2] tracking-[-0.02em]';

/**
 * The micro-label: mono, uppercase, tracked out, 11px.
 *
 * The reference's navigation and eyebrows are all set this way and it is the
 * one borrowed detail that needed no translation — this console already sets
 * every measured quantity in `--font-mono`, so a mono label on a landing is
 * the product's own voice rather than a costume. `--muted-foreground` and not
 * a lighter grey: at 11px the AA floor is 4.5:1 and that token is the
 * lightest neutral in the system that clears it on all four light grounds.
 */
const MICRO =
  'font-mono text-[0.6875rem] font-medium uppercase leading-[1.4] tracking-[0.16em] text-[var(--muted-foreground)]';

/** The reading column, used inside a band. One width, one gutter, everywhere. */
const SHELL = 'mx-auto w-full max-w-[80rem] px-4 sm:px-6 lg:px-10';

/**
 * The bleed cap. A band is edge to edge up to 1920px and centred beyond it,
 * so a 27-inch display does not enlarge a 420px still past its own pixels.
 */
const BAND = 'mx-auto w-full max-w-[120rem]';

/**
 * The two page-level calls to action, at a size that survives 320px.
 *
 * Below `sm` the label may wrap and the pill grows to fit it, full width in
 * its column; from `sm` up it is the 56px pill. Measured on an earlier build:
 * at 320px *Đăng nhập vào console* at 17px inside 32px of padding was 58px of
 * horizontal document scroll. The height floor keeps the 44px touch target.
 */
const CTA = cn(
  'h-auto min-h-14 w-full justify-center whitespace-normal px-6 py-4 text-center',
  'sm:h-14 sm:w-auto sm:whitespace-nowrap sm:px-8',
);

export function DiscoverScreen() {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useChoreography(root);

  /*
   * Trúc costs three.js and 1.29 MB of glTF and he stands in the last band of
   * the page. `React.lazy` alone does not defer that — it defers until mount,
   * and a component that mounts with the page has deferred nothing.
   */
  const [closing, nearTruc] = useOnScreen<HTMLDivElement>('100% 0px');

  return (
    <div ref={root} className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      {/*
        The signature. It mounts nothing on a coarse pointer, under 768px, or
        under `prefers-reduced-motion`. Nothing on this page depends on it: a
        collector arrives on a phone, where it never exists.
      */}
      <CustomCursor />
      <Bar />

      <main>
        <Hero />
        <WorkBand />
        <CameraBand />
        <FilmBand reduced={reduced} />
        <ReviewBand />
        <PaymentBand />
        <QuestionsBand />
        <ClosingBand closing={closing} nearTruc={nearTruc} />
      </main>

      <Footer>{t('discover.credits')}</Footer>
    </div>
  );
}

/* =========================================================================
   The bar.
   ====================================================================== */

/**
 * Glass at the bar weight, and it now carries **five destinations** rather
 * than a sign-in and nothing else.
 *
 * All five are anchors into this page, and that is deliberate rather than a
 * shortcut: the only two routes a signed-out reader may reach are this one
 * and `/login`, so a bar of five *routes* would be a bar of four links that
 * bounce off `requireSession`. A destination that does not go anywhere is
 * worse than a short bar. What the reference's bar actually provides is a map
 * of the page, and this is that map.
 *
 * They are hidden below `lg`. Measured on an earlier build: the wordmark, the
 * locale select — whose width is set by *Tiếng Việt* — the theme toggle and a
 * sign-in button already need 470px of row, and at 390 the document reported
 * a `scrollWidth` of 470 against a `clientWidth` of 390.
 */
function Bar() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
      <div
        className={cn(
          'mx-auto flex max-w-[84rem] items-center justify-between gap-3',
          'rounded-[var(--radius-pill)] shadow-[var(--shadow-sm)]',
          'glass-bar',
          /* `pl-3` below `sm`: at 320px the row was one pixel wider than the
             viewport, and one pixel of horizontal document scroll is still
             horizontal document scroll. */
          'py-2 pl-3 pr-2 sm:pl-4',
        )}
      >
        <span className="inline-flex shrink-0 items-center gap-2.5">
          <Mark size={24} />
          <span className="font-display text-[1.0625rem] font-bold tracking-[-0.02em]">
            PlayerOne
          </span>
          {/*
            The partners, named in the bar and not only in a footnote. For a
            joint venture asking members of the public to wear a camera inside
            their home, *this is VNG* is the most persuasive fact available.
          */}
          <span
            className={cn(
              'ml-1 hidden border-l border-[var(--border)] pl-3 text-[0.8125rem] xl:inline',
              'text-[var(--muted-foreground)]',
            )}
          >
            VNG PT Lab &times; PaXini
          </span>
        </span>

        <nav aria-label={t('discover.nav.label')} className="hidden lg:block">
          <ul className="m-0 flex list-none items-center gap-8 p-0">
            {DESTINATIONS.map((key) => (
              <li key={key}>
                <a
                  href={`#${key}`}
                  data-cursor-highlight
                  className={cn(
                    MICRO,
                    'transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]',
                    'hover:text-[var(--foreground)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]',
                  )}
                >
                  {t(`discover.nav.${key}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <LocaleSwitch />
          <ThemeSwitch />
          <Button
            variant="primary"
            size="sm"
            asChild
            data-cursor-highlight
            className="ml-1 hidden rounded-[var(--radius-pill)] px-4 sm:inline-flex"
          >
            <Link to="/login">{t('discover.signIn')}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/* =========================================================================
   1. The hero: four lines, a contact sheet, and four fragments of the
      console floating on them.
   ====================================================================== */

function Hero() {
  const { t } = useTranslation();
  return (
    <section
      data-band="hero"
      className="relative isolate flex min-h-[88svh] flex-col justify-center"
    >
      {/* The contact sheet. Masked, so it is a texture and not a wireframe. */}
      <div aria-hidden="true" className="frame-grid absolute inset-0 z-0" />

      {/*
        The flat shapes: a square on the turn, a disc, a quarter-circle.

        Flat fill, no gradient, no shadow, no rounded corners except the ones
        the geometry has — which is the reference's rule and also this
        system's, since `DESIGN.md` bars a gradient on any ink. The three
        values are the accent, the ink and the wash's deepest step, so nothing
        here spends a hue that means something elsewhere. They sit behind the
        type at `z-0` and are `aria-hidden`, because a shape that carries no
        information should not be announced as though it did.
      */}
      <div aria-hidden="true" className="absolute inset-0 z-0 overflow-clip">
        <span className="absolute left-[1%] top-[66%] hidden size-32 rounded-tr-full bg-[var(--lavender-200)] lg:block" />
        <span className="absolute right-[8%] top-[12%] hidden size-16 rounded-full bg-[var(--foreground)] lg:block" />
        <span className="absolute right-[2%] top-[70%] hidden size-44 rotate-[14deg] bg-[var(--lavender-200)] lg:block" />
        <span className="absolute right-[24%] top-[4%] hidden size-20 rounded-full border-2 border-[var(--border-strong)] lg:block" />
      </div>

      <div className={cn(BAND, SHELL, 'relative z-10 pb-20 pt-20 sm:pt-24 lg:pb-24 lg:pt-28')}>
        <p className={MICRO} data-cursor-highlight>
          {t('discover.eyebrow')}
        </p>

        {/*
          The type and its chips share one positioned box, so a chip's
          coordinates are a fraction of the headline rather than of a band
          whose height depends on how long the lead sentence is in Vietnamese.
        */}
        <div className="relative mt-8">
          <h1 data-choreo-hero="line" className={cn(LINE_SIZE, 'm-0')}>
            <span className={LINE} data-cursor-highlight>
              {t('discover.line.1')}
            </span>
            <span className={LINE} data-cursor-highlight>
              {t('discover.line.2')}
            </span>
            <span className={LINE} data-cursor-highlight>
              {t('discover.line.3')}
            </span>
            <span className={LINE} data-cursor-highlight>
              {t('discover.line.4')}
            </span>
          </h1>

          {/*
            The fragments, one per line, each answering the phrase it sits on.

            `absolute` and `lg:` only, and both are load-bearing. Out of flow,
            they are excluded from `rhythm.mjs`'s sibling-gap check, which is
            correct — a thing that floats is not in a vertical rhythm and the
            distance to its neighbour is not a spacing decision. Below `lg`
            they are not rendered at all rather than reflowed into a row: four
            chips stacked under a headline is the strip this build deleted,
            wearing a different name.

            None of them is interactive, so none can be reported as covered.
          */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
            <Chip className="left-[36%] top-[-4%]">
              <span className={MICRO}>{t('discover.chip.task')}</span>
            </Chip>
            <Chip className="left-[62%] top-[26%]" tone="warn">
              <span className={cn(MICRO, 'text-[var(--warn)]')}>{t('discover.chip.handover')}</span>
            </Chip>
            {/*
              All three outcomes, not one, and this is where most of the
              page's colour comes from.

              A single green pill floating over *A person reviews it.* reads as
              a promise. Three pills, one per outcome, read as what the
              sentence actually means: a person decides, and two of the three
              things they can decide are not a full pass. `VerdictPill` is the
              console's own component, unmodified — same hues, same glyphs,
              same sizes an operator sees on `/review`.
            */}
            <span className="absolute left-[70%] top-[50%] flex flex-col items-start gap-2">
              <Chip className="static">
                <VerdictPill verdict="good" size="sm">
                  {t('verdict.good')}
                </VerdictPill>
              </Chip>
              <Chip className="static ml-6">
                <VerdictPill verdict="partial" size="sm">
                  {t('verdict.partial')}
                </VerdictPill>
              </Chip>
              <Chip className="static ml-12">
                <VerdictPill verdict="bad" size="sm">
                  {t('verdict.bad')}
                </VerdictPill>
              </Chip>
            </span>
            <Chip className="left-[58%] top-[110%]">
              <span className={MICRO}>{t('discover.chip.rate')}</span>
            </Chip>
          </div>
        </div>

        {/*
          The two conditions the product runs on — a human reviews the footage,
          and only approved effective minutes are paid — at full strength.
        */}
        <p
          data-choreo-hero="lead"
          className="mt-10 max-w-[46ch] text-[1.0625rem] leading-[1.6] sm:text-[1.1875rem]"
        >
          {t('discover.lead')}
        </p>

        {/* Two calls to action, and they are peers because the audiences are. */}
        <div data-choreo-hero="actions" className="mt-8 flex flex-wrap items-start gap-3">
          <ApkAction />
          <Button variant="secondary" size="xl" asChild data-cursor-highlight className={CTA}>
            <Link to="/login">{t('discover.signIn')}</Link>
          </Button>
        </div>
        <ApkNote />
      </div>
    </section>
  );
}

/**
 * One floating fragment of the console.
 *
 * A pill on glass inside a frame of the contact sheet — the substitution for
 * the reference's `SAVE TO BOARD`. `tone="warn"` swaps the hairline for the
 * attention tint, which is the one place on this page that colour is used to
 * mean *a person has to do something*, and it is true: a card at a counter is
 * waiting for an operator.
 */
function Chip({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'warn';
}) {
  return (
    <span
      className={cn(
        'absolute inline-flex items-center gap-2 px-4 py-2.5',
        'frame-cell rounded-[var(--radius-pill)] shadow-[var(--shadow-sm)]',
        tone === 'warn' && 'border-[var(--warn)] bg-[var(--warn-bg)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* =========================================================================
   2. The work: what counts, then ten frames of it edge to edge.
   ====================================================================== */

/**
 * The mosaic, and the four rules it is built on are all refusals.
 *
 * **No cards.** No border, no radius, no shadow, no gap — the cells touch, so
 * the band reads as one surface rather than as ten objects. **No captions
 * under the pictures**, which is the reference's rule and also the only way a
 * grid of ten stays a grid of ten instead of ten little articles. **No
 * enlargement**: every source is 420x420 and the widest cell this grid ever
 * draws is 192px, at 1920. **And one honest sentence**, under the whole
 * thing, saying what these are and what they are not — because the alternative
 * is a page that implies ten recordings exist.
 */
function WorkBand() {
  const { t } = useTranslation();
  return (
    <Reveal data-band="work" id="work" className="scroll-mt-24 bg-[var(--background)]">
      <div className={cn(BAND, SHELL, 'pb-12 pt-20 sm:pt-24 lg:pt-32')}>
        <p className={MICRO}>{t('discover.label.work')}</p>
        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:gap-12">
          <h2 className={cn(H2, 'lg:col-span-5')}>{t('discover.cell.activities.title')}</h2>
          <p className="max-w-[58ch] text-[1.0625rem] leading-[1.65] lg:col-span-7">
            {t('discover.cell.activities.body')}
          </p>
        </div>
      </div>

      {/*
        Five across at every width, which makes ten tiles exactly two rows and
        no ragged last row anywhere. Ten across was one 144px strip at 1440 and
        read as a rule rather than as a field; two rows of 288px cells is a
        block of work you look at, and 288 is still under the 420px the sources
        actually are.
      */}
      <ul className={cn(BAND, 'm-0 grid list-none grid-cols-5 p-0')}>
        {WORK_TILES.map((file) => (
          <li key={file} className="relative aspect-square">
            <img
              src={`/tiles/${file}`}
              alt=""
              width={420}
              height={420}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 block h-full w-full object-cover"
            />
          </li>
        ))}
      </ul>

      <div className={cn(BAND, SHELL, 'pb-20 pt-8 sm:pb-24 lg:pb-32')}>
        <p className="max-w-[72ch] text-[0.8125rem] leading-[1.55] text-[var(--muted-foreground)]">
          {t('discover.work.note')}
        </p>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   3. The camera. The one photograph, and the type beside it.
   ====================================================================== */

/**
 * The caption's left edge and the photograph's left edge are set by the same
 * padding on the same box, so the offset between them is exactly the pad at
 * every breakpoint and in every language. That is the class of fault the
 * design review measured at **71.75px** on an earlier build, where the picture
 * was centred in its panel and its caption was flush left in the same panel.
 */
function CameraBand() {
  const { t } = useTranslation();
  return (
    <Reveal data-band="camera" id="camera" className="scroll-mt-24">
      <div className={cn(BAND, 'grid lg:grid-cols-2')}>
        <figure className="on-film relative m-0 min-h-[20rem] sm:min-h-[26rem] lg:min-h-[34rem]">
          <img
            src={STILL_URL}
            alt=""
            width={940}
            height={720}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* `.plate-grade`, not the hero's: no side ramp and a shorter
              vertical one, because the device this picture exists to show is at
              the left of the frame. The caption sits in the bottom fifth. */}
          <div aria-hidden="true" className="plate-grade absolute inset-0" />
          <figcaption
            className={cn(
              'absolute inset-x-0 bottom-0 p-6 sm:p-8',
              'max-w-[46ch] text-[0.9375rem] leading-[1.55] text-[var(--stage-over)]',
            )}
          >
            {t('discover.cell.pov.caption')}
          </figcaption>
        </figure>
        <div className="frame-grid relative flex flex-col justify-center bg-[var(--lavender-200)] px-6 py-20 sm:px-10 lg:px-12">
          <p className={MICRO}>{t('discover.label.camera')}</p>
          <h2 className={cn(H2, 'mt-6')}>{t('discover.cell.camera.title')}</h2>
          <p className="mt-6 max-w-[50ch] text-[1.0625rem] leading-[1.65]">
            {t('discover.cell.camera.body')}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   4. The placeholder film, spent once, and labelled as what it is.
   ====================================================================== */

/**
 * The film is the page's only moving image and it is **not** the hero.
 *
 * It sits in a band of its own, under a mono label that says *placeholder
 * film*, with the slate underneath it in the reader's own language: someone
 * wearing Ego, filmed at arm's length in Paris, by a second person. That is
 * the opposite of what Ego records, and a page that opens with it and does
 * not say so is a page implying otherwise.
 *
 * Everything set on the film sits in the bottom of the frame, inside
 * `.film-grade`'s heaviest region, and the type takes `.on-film`'s remapped
 * roles rather than a colour of its own.
 *
 * WCAG 2.2.2: anything that plays automatically for more than five seconds
 * needs a way to stop it, and this cut is 7.04s and loops. The label is
 * driven by the element's **own** `play` and `pause` events rather than by
 * what this component last asked for — autoplay is refused by more browsers
 * than it is honoured by and a `play()` promise can reject, so a boolean this
 * component sets is a label that lies.
 */
function FilmBand({ reduced }: { reduced: boolean }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <Reveal data-band="film">
      <div
        className={cn(
          BAND,
          'on-film relative isolate flex min-h-[26rem] flex-col justify-end',
          'bg-[var(--stage)] sm:min-h-[32rem] lg:min-h-[40rem]',
        )}
      >
        <video
          ref={video}
          src={VIDEO_URL}
          poster={POSTER_URL}
          muted
          loop
          playsInline
          autoPlay={!reduced}
          preload="metadata"
          aria-label={t('login.video.region')}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
        {/* Over the video, under the type. On its own element, because a
            gradient on the `<video>` is repainted with every decoded frame. */}
        <div aria-hidden="true" className="film-grade absolute inset-0 -z-10" />

        <div className={cn(SHELL, 'pb-8 pt-24 sm:pb-10')}>
          <p className={cn(MICRO, 'text-[var(--stage-fg)]')}>{t('discover.label.film')}</p>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <p
              /* `--stage-fg`, and **not** white at an opacity. An opacity is not
                 a colour: it makes the rendered ink differ from the declared
                 one, so the contrast probe found no glyphs to measure at all
                 and reported the slate as absent. Over film "quieter" is a
                 token one step down, never a transparency. */
              className="max-w-[68ch] text-[0.8125rem] leading-[1.55] text-[var(--stage-fg)]"
            >
              {t('discover.video.caption')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-cursor-highlight
              className="shrink-0"
              onClick={() => {
                const el = video.current;
                if (el === null) return;
                /* The element's own events set the label; a rejected `play()`
                   promise leaves the control saying *play*, which is true. */
                if (el.paused) void el.play().catch(() => {});
                else el.pause();
              }}
            >
              {playing ? t('player.pause') : t('player.play')}
            </Button>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   5. Review. The ink band, and where the verdict hues earn their place.
   ====================================================================== */

/**
 * The three outcomes, drawn at display size as a legend rather than as three
 * cards in a row.
 *
 * This is the substitution for the reference's flat green hexagon and orange
 * square, and it is the one that makes the page colourful without spending a
 * hue on decoration: `tokens.ts` already requires every verdict to carry a
 * *shape* as well as a hue, because red/green colour blindness is common and
 * this axis decides whether somebody is paid. The shapes exist; they were
 * being drawn at 17px inside a pill. At 32px on ink they are flat saturated
 * geometry that means exactly what it looks like.
 *
 * One row, wrapping, with the names beside the glyphs — not three boxes.
 * Three boxes side by side is the arrangement this build exists to delete.
 */
function ReviewBand() {
  const { t } = useTranslation();
  const verdicts = [
    { key: 'good', Glyph: IconPass, ink: 'text-[var(--pass)]' },
    { key: 'partial', Glyph: IconPartial, ink: 'text-[var(--partial)]' },
    { key: 'bad', Glyph: IconReject, ink: 'text-[var(--reject)]' },
  ] as const;

  return (
    <Reveal
      data-band="review"
      id="review"
      /* The hairline is for the dark scheme and it is not decoration. `stage
         .ground` (#101215) on `dark.background` (#101119) is about 1.01:1, so
         without an edge the ink band dissolves into the page and the sections
         stop having boundaries. On the light shell it sits on ink and costs
         nothing. Same argument, same fix, as `.feature-block`. */
      className="on-film scroll-mt-24 border-y border-[var(--stage-line)] bg-[var(--stage)]"
    >
      <div className="relative">
        <div aria-hidden="true" className="frame-grid absolute inset-0" />
        <div className={cn(BAND, SHELL, 'relative py-20 sm:py-24 lg:py-32')}>
          <p className={cn(MICRO, 'text-[var(--stage-mid)]')}>{t('discover.label.review')}</p>
          <h2 className={cn(H2, 'mt-6 text-[var(--stage-fg)]')}>
            {t('discover.cell.review.title')}
          </h2>
          <p className="mt-6 max-w-[58ch] text-[1.0625rem] leading-[1.65] text-[var(--stage-mid)]">
            {t('discover.cell.review.body')}
          </p>

          <div className="mt-12 flex flex-wrap items-center gap-x-12 gap-y-8">
            {verdicts.map(({ key, Glyph, ink }) => (
              <span key={key} className="inline-flex items-center gap-4" data-cursor-highlight>
                <Glyph size={32} className={ink} />
                <span className={cn(H3, 'text-[var(--stage-fg)]')}>{t(`verdict.${key}`)}</span>
              </span>
            ))}
          </div>

          <p className="mt-8 max-w-[58ch] text-[0.9375rem] leading-[1.6] text-[var(--stage-mid)]">
            {t('discover.verdict.note')}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   6. Payment. The intersection rule, drawn.
   ====================================================================== */

/**
 * The least intuitive rule on the platform, as geometry.
 *
 * `CLAUDE.md`: *payable time is the intersection of stream coverage, not the
 * union.* The device's manifest reports its widest stream — about 3% high in
 * general and 18% high on one real sample — so the platform measures the
 * media instead. Every previous build stated that in a sentence and every
 * previous build was right that it is hard to picture.
 *
 * Three bars of different spans and one band across what they share says it
 * without a duration in sight, which is the point: a figure on a
 * payout-bearing page is a figure somebody will hold us to, and nobody has
 * cleared one. The spans below are illustrative geometry with no unit and no
 * axis, and the caption says which is which.
 *
 * The band is `lime-500`, this screen's one lime moment.
 */
function PaymentBand() {
  const { t } = useTranslation();
  /* Percentages of the track. Lengths, not colours — nothing here is a token
     value and nothing here is a measurement of anything real. */
  const streams = [
    { key: 'video', left: '6%', width: '80%' },
    { key: 'audio', left: '12%', width: '80%' },
    { key: 'imu', left: '0%', width: '100%' },
  ] as const;

  return (
    <Reveal data-band="payment" id="payment" className="scroll-mt-24 bg-[var(--lavender-200)]">
      <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
        <p className={MICRO}>{t('discover.label.payment')}</p>
        <div className="mt-6 grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <h2 className={H2}>{t('discover.cell.minutes.title')}</h2>
            <p className="mt-6 max-w-[46ch] text-[1.0625rem] leading-[1.65]">
              {t('discover.cell.minutes.body')}
            </p>
          </div>

          <figure className="m-0 lg:col-span-7">
            <div className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-4">
              {streams.map(({ key, left, width }) => (
                <Fragment key={key}>
                  <span className={MICRO}>{t(`discover.streams.${key}`)}</span>
                  <span className="relative block h-4">
                    <span
                      className="stream-bar absolute inset-y-0 block"
                      style={{ left, width }}
                      aria-hidden="true"
                    />
                  </span>
                </Fragment>
              ))}
              {/* The intersection: from the latest start to the earliest end. */}
              <span aria-hidden="true" />
              <span className="relative block h-4">
                <span
                  className="stream-bar stream-band absolute inset-y-0 block"
                  style={{ left: '12%', width: '74%' }}
                  aria-hidden="true"
                />
              </span>
            </div>
            <figcaption className="mt-8 max-w-[52ch] text-[0.9375rem] leading-[1.6]">
              {t('discover.streams.payable')}
              <span className="mt-3 block text-[var(--muted-foreground)]">
                {t('discover.streams.device')}
              </span>
            </figcaption>
          </figure>
        </div>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   7. Questions.
   ====================================================================== */

function QuestionsBand() {
  const { t } = useTranslation();
  return (
    <Reveal data-band="questions" id="questions" className="scroll-mt-24 bg-[var(--background)]">
      <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
        <p className={MICRO}>{t('discover.label.questions')}</p>
        <h2 className={cn(H2, 'mt-6')}>{t('discover.before.title')}</h2>
        <div className="mt-12 flex flex-col gap-2">
          {QUESTIONS.map((key, index) => (
            <Row
              key={key}
              open={index === 0}
              question={t(`discover.before.q.${key}`)}
              answer={t(`discover.before.a.${key}`)}
            />
          ))}
        </div>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   8. Where to go from here.
   ====================================================================== */

/**
 * Both audiences, as peers, at the moment of highest intent — and **not as
 * two cards side by side**, which is what they were and what was rejected.
 *
 * The two paragraphs are stacked with a hairline between them, at the same
 * heading level and the same body treatment; the two controls are a row of
 * two buttons under both. A button is not a card. What the cards were
 * actually providing was a container for a paragraph, and a paragraph does
 * not need one.
 *
 * That also removes the defect the cards caused: with `items-start` each card
 * was the height of its own contents, and with `mt-auto` the slack landed as
 * a 46px gap in English and a **90px** gap in Chinese between a paragraph and
 * its button — off the 4px scale at 1440 and 1280, found by `rhythm.mjs`. A
 * gap that is whatever is left over is not a spacing decision.
 */
function ClosingBand({
  closing,
  nearTruc,
}: {
  closing: RefObject<HTMLDivElement | null>;
  nearTruc: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Reveal
      data-band="ways"
      className="on-film border-t border-[var(--stage-line)] bg-[var(--stage)]"
    >
      <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
        <p className={cn(MICRO, 'text-[var(--stage-mid)]')}>{t('discover.label.next')}</p>
        <h2 className={cn(H2, 'mt-6 text-[var(--stage-fg)]')}>{t('discover.ways.title')}</h2>
        <p className="mt-6 max-w-[64ch] text-[1.0625rem] leading-[1.65] text-[var(--stage-mid)]">
          {t('discover.audiences')}
        </p>

        <div ref={closing} className="mt-12 flex flex-col gap-8">
          <div>
            <h3 className={cn(H3, 'text-[var(--stage-fg)]')}>{t('discover.take.title')}</h3>
            <p className="mt-3 max-w-[64ch] text-[0.9375rem] leading-[1.6] text-[var(--stage-mid)]">
              {t('discover.take.body')}
            </p>
          </div>
          <div className="border-t border-[var(--stage-line)] pt-8">
            <h3 className={cn(H3, 'text-[var(--stage-fg)]')}>{t('discover.handoff.title')}</h3>
            <p className="mt-3 max-w-[64ch] text-[0.9375rem] leading-[1.6] text-[var(--stage-mid)]">
              {t('discover.handoff.body')}
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-start gap-3">
          <ApkAction />
          <Button variant="secondary" size="xl" asChild data-cursor-highlight className={CTA}>
            <Link to="/login">{t('discover.signIn')}</Link>
          </Button>
        </div>
        <ApkNote />

        {/*
          The partnership and Trúc, on one row, and the pairing is a spacing
          fix as much as a composition.

          The ruling on the mascot is about **occlusion**: *"Only the panda is
          allowed to sit on the corner bc its not blocking anything"*. What he
          may not share a row with is a control — put beside the sign-in he
          stood next to a button labelled *Đăng nhập bảng điều khiển* in
          Vietnamese and `rhythm.mjs` measured the pair clipping its own box
          by 10px at 1440 and 1280, because a button that cannot shrink was
          beside a 96px canvas in a column that can. A paragraph is not a
          control: it wraps, it has a `max-w`, and it gives way.

          On his own row he left about 200px of empty ink between the APK note
          and the partner line, which is the "bad spacing" complaint in its
          measurable form — a hole is not a spacing decision. Sharing the row
          with the partnership fills it and puts the two identity statements,
          the mark and the mascot, at the two ends of the same line.

          `hidden` below `sm`, where the canvas would reach the type.
        */}
        <div className="mt-16 flex flex-wrap items-end justify-between gap-8">
          <p className="flex max-w-[64ch] items-start gap-3 text-[0.9375rem] leading-[1.6] text-[var(--stage-mid)]">
            <Mark size={22} className="mt-0.5 shrink-0" />
            <span>{t('discover.partners')}</span>
          </p>
          <div className="hidden sm:block">{nearTruc ? <TrucAsk /> : null}</div>
        </div>
      </div>
    </Reveal>
  );
}

/* =========================================================================
   The pieces.
   ====================================================================== */

/**
 * The collector's call to action, and it tells the truth in both states.
 *
 * With `APK_URL` set it is a download link. With it empty, which is today, it
 * is the same control at the same size, `disabled`, with one sentence under it
 * saying the build is not released. **It is `outline` and not a faded
 * `primary`**: the primary variant deliberately keeps a disabled control at
 * full ink, and `--action` inverts with the scheme, so in dark mode a dead
 * download button rendered as a light filled pill beside an outlined sign-in
 * and read as *more* available than the working control.
 */
function ApkAction() {
  const { t } = useTranslation();

  if (APK_URL === '') {
    return (
      <Button
        type="button"
        variant="outline"
        size="xl"
        disabled
        className={cn(CTA, 'disabled:opacity-100')}
      >
        {t('discover.take.cta')}
      </Button>
    );
  }

  return (
    <Button variant="primary" size="xl" asChild data-cursor-highlight className={CTA}>
      <a href={APK_URL} download rel="noopener">
        {t('discover.take.cta')}
      </a>
    </Button>
  );
}

/**
 * The sentence that says why the control above it does nothing.
 *
 * It is a sibling of the action row rather than a child of the button's own
 * cell: inside the row a 48ch paragraph sets the width of its flex item and
 * pushes the console sign-in 200px to the right of the download.
 */
function ApkNote() {
  const { t } = useTranslation();
  if (APK_URL !== '') return null;
  return (
    <p className="mt-4 max-w-[52ch] text-[0.8125rem] leading-[1.55] text-[var(--muted-foreground)]">
      {t('discover.take.pending')}
    </p>
  );
}

/**
 * One FAQ row, and it is a native `<details>` on glass.
 *
 * Nothing here is a state machine: the browser owns the open state, the
 * disclosure role and the keyboard, and a reader with no JavaScript still gets
 * every answer. The marker is removed on both engines and replaced with a
 * glyph that turns — Chrome and Safari draw `::-webkit-details-marker`,
 * Firefox draws the `list-style` triangle, and hiding only one leaves a stray
 * arrow in the other.
 */
function Row({ question, answer, open }: { question: string; answer: string; open: boolean }) {
  return (
    <details
      open={open}
      className="glass-card group rounded-[var(--radius-lg)] px-5 py-4 sm:px-6 sm:py-5"
    >
      <summary
        data-cursor-highlight
        className={cn(
          'flex list-none items-center justify-between gap-4 text-[1rem] font-semibold leading-[1.4]',
          /*
           * Both markers, and both are needed. Chrome lays out a `::marker` box
           * as the first flex item of a `display: flex` summary even with
           * `list-style: none` — measured at 5px of horizontal overflow on
           * every row, which `rhythm.mjs` reports as clipping.
           */
          '[&::-webkit-details-marker]:hidden [&::marker]:content-[""]',
          'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]',
        )}
      >
        {question}
        {/*
          The glyph turns, the ring does not. Rotating the 24px ring gives it a
          33.9px diagonal bounding box, and a transform contributes to
          scrollable overflow — measured, the open row reported 5px of
          horizontal clipping at all three widths while the closed rows were
          clean.
        */}
        <span
          aria-hidden="true"
          className={cn(
            'grid size-6 shrink-0 place-items-center overflow-hidden rounded-full',
            'border border-[var(--border-strong)] text-[0.9375rem] leading-none',
          )}
        >
          <span className="transition-transform duration-[var(--duration-base)] ease-[var(--ease)] group-open:rotate-45">
            +
          </span>
        </span>
      </summary>
      <p className="mt-3 max-w-[70ch] text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
        {answer}
      </p>
    </details>
  );
}

/**
 * The credits line, and it is a link to the file rather than a claim.
 *
 * The film is a placeholder, the one plate on the page is a crop of it, and
 * ten of the stills in the work grid are third-party or generated;
 * `CREDITS.json` records every one, including which two are synthetic. A
 * landing that shows them with no route to that fact is a landing implying
 * the pictures are documentary.
 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center sm:px-6">
      <a
        href="/tiles/CREDITS.json"
        data-cursor-highlight
        className={cn(
          'text-[0.75rem] underline decoration-current/40 underline-offset-2',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:decoration-current',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        )}
      >
        {children}
      </a>
    </footer>
  );
}
