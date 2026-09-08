/**
 * `/discover` — what the product is, on a public route of its own.
 *
 * ## Why this is the fifth version
 *
 * Four were rejected, and the cause was process rather than taste: an agent
 * picked a direction off a pile of references and the design review ran
 * afterwards as a checklist, which produces a page that measures green on
 * contrast, rhythm and tokens and reads as nothing. The owner's words on the
 * fourth: *"its so weird and uncanny, everything doesnt make sense and doesnt
 * align well"*.
 *
 * So this build is held to one decision made **before** any of it was written:
 *
 * > **One signature interaction — the custom cursor — and everything else
 * > quiet.**
 *
 * He listed six things he liked (the cursor, ray-lit 3D, a scroll morph, an
 * idle animation, panel transitions, the panda) and then chose one. Every
 * reference he admires earns its premium feel the same way: Figure AI is
 * nearly static, Fixa is one pan. So there is no ray-light, no scroll morph,
 * no idle drift and no panel-transition spectacle here. What moves is the
 * cursor (`components/CustomCursor.tsx`), one authored hero sequence, and
 * quiet section fades from an already-visible resting state.
 *
 * ## The seven sections, and the order is the argument
 *
 * 1. **Hero.** The slogan resolves, the column lifts, and the film frame opens
 *    — **one** timeline in `useChoreography`, not three effects that happen to
 *    fire together.
 * 2. **Demonstration.** The film, wide, with nothing drawn over it. No scrim,
 *    no type, no mascot. That rule was won the hard way: *"theres random
 *    circular text blocking the demo"*.
 * 3. **The four-step strip.** Record, upload, human review, payment for
 *    approved effective minutes. A ruled strip and not four cards, because the
 *    four are one sequence rather than four things to choose between.
 * 4. **The panel pair.** Two half-width panels on the console's near-black,
 *    caption at the foot of each. **The stills are held at the size they are
 *    sharp at** — every file in `public/tiles/` is 420x420, and a 420px source
 *    blown across half a 1440px viewport is a 1.7x upscale that reads as blurry
 *    stock. These photographs are the page's only evidence; softening them
 *    weakens the one proof it has. So each panel holds a 420px plate on ink
 *    rather than a stretched fill, and the panel is what is full-bleed.
 * 5. **Product detail.** A bento on one gutter with deliberately unequal spans,
 *    text-led, with two sharp stills as evidence and one ink cell on the number
 *    the whole product turns on.
 * 6. **FAQ.** Rounded grey rows, one open by default. Native `<details>`, so it
 *    opens with no script, is announced as a disclosure, and is found by the
 *    browser's own in-page search.
 * 7. **Take part, and sign in.** The 50/50 split, carrying the film, with
 *    *both* audiences given somewhere to go.
 *
 * ## Two audiences, two peer actions
 *
 * The owner's ruling, 2026-09-08: *"discover is like a product home page
 * everyone can see, theres login for consoles operators and download APK buton
 * for collectors, treat it as product grand scheme intro page."* So this is the
 * product's public front page and not a funnel for either side of it, and it
 * carries **two calls to action of equal rank**:
 *
 * - **Download the APK** — the collector's path, a direct Android build. Not a
 *   Play Store listing and not a Zalo flow; that question is closed.
 * - **Sign in to the console** — the operator's and the reviewer's path.
 *
 * Both are in the hero and both return at the foot, because a reader has to
 * have somewhere to go at first contact and again at highest intent. Until this
 * build the only action anywhere on the page was the *operator* sign-in,
 * captioned "this page is not a collector sign-up" — so a collector read the
 * whole thing and arrived at a back-office form asking for machine credentials.
 *
 * **The APK does not exist yet**, and the honest form of that is `APK_URL`
 * below: one empty constant, one component that renders a download link when it
 * is set and a disabled control with a sentence saying the build is not
 * released when it is not. On a payout-bearing product's front page, a button
 * that looks available and then 404s is worse than a button that says so.
 *
 * ## What this page must never imply
 *
 * Device ownership, unrestricted recording, automatic acceptance, payment for
 * every recorded minute, guaranteed earnings, instant payout. Sections 3, 5, 6
 * and 7 each say the opposite of one of those in plain words, in all three
 * languages. **Every figure here is a process fact** — how the platform works —
 * and there is not one statistic on the page, invented or otherwise.
 *
 * ## What was deleted and has no second caller
 *
 * The scatter of eleven tilted photographs; the rainbow prism disc and its
 * three-variant hover burst; the marquee; the rotating circular type; the flat
 * scrim over the film; the hover effect that swapped each photograph for a
 * different photograph. Also gone in this pass: the three "fact" cards under
 * the hero, which repeated the four-step strip in shorter words and pushed the
 * film below the fold, so the one authored moment happened where nobody was
 * looking.
 *
 * ## Colour
 *
 * `--surface` is the ground, `--foreground` the ink, `--action` the primary
 * control, and lime is spent twice and only twice: the marker in the headline
 * and the accent inside the cursor's lens. No yellow, no orange. Every value
 * comes from `packages/design/src/tokens.ts` through a custom property; there
 * is no colour literal in this file.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { TrucAsk } from '../components/identity/TrucAsk.tsx';
import { CustomCursor } from '../components/CustomCursor.tsx';
import { Button } from '../components/ui/button.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { Reveal, useChoreography, useOnScreen } from '../lib/choreo.tsx';
import { cn } from '../lib/cn.ts';

/**
 * The film. `apps/console/public/landing.mp4` (12.96s, 1280x720, 1.39 MB)
 * ships with the console, so the page is complete with no environment set.
 * `VITE_LANDING_VIDEO_URL` stays as the seam a deployment uses to point at a
 * longer cut or a CDN copy without a rebuild of this file.
 */
const VIDEO_URL: string =
  typeof import.meta.env.VITE_LANDING_VIDEO_URL === 'string' &&
  import.meta.env.VITE_LANDING_VIDEO_URL !== ''
    ? import.meta.env.VITE_LANDING_VIDEO_URL
    : '/landing.mp4';

/**
 * The collector build, and it is a **placeholder in exactly one place.**
 *
 * The owner's decision, 2026-09-08: `/discover` is the public product home,
 * the collector path is a **direct APK download** — not a Play Store listing
 * and not a Zalo flow — and it is a peer of the console sign-in rather than
 * something under it. The file itself does not exist yet: `public/` holds the
 * film, its poster, the mark, the tiles and the panda, and nothing else.
 *
 * So this is empty, and `ApkAction` below renders honestly on both sides of
 * it. Publishing the build is a one-line change here — set the path, or point
 * `VITE_COLLECTOR_APK_URL` at a release — and the sentence saying there is
 * nothing to download disappears on its own. **Do not fill it with a guess.** A
 * button that 404s on a payout-bearing product's front page is worse than a
 * button that says the build is not out.
 */
const APK_URL: string =
  typeof import.meta.env.VITE_COLLECTOR_APK_URL === 'string'
    ? import.meta.env.VITE_COLLECTOR_APK_URL
    : '';

/** The sequence, and the order is the argument. */
const STEPS = ['record', 'upload', 'review', 'payment'] as const;

/** The four questions, as disclosure rows. The first is open. */
const QUESTIONS = ['record', 'paid', 'when', 'data'] as const;

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
   The display scale, declared once.

   Three steps, and the **weight runs the opposite way to the size** — 500 on
   the headline, 600 on a cell heading — which is most of the difference
   between display type that looks expensive and display type that looks like a
   browser default. Tracking tightens as the size grows, for the same reason.

   `--font-display` is Hanken Grotesk Variable: the only shortlisted face that
   ships a Vietnamese subset, which on a page whose primary language is
   Vietnamese is not a preference.
   ---------------------------------------------------------------------- */

/**
 * The opening line. 40 / 56 / 68px.
 *
 * `leading-[1.1]` and not the `1` display type usually wants, because this
 * headline carries a filled `<mark>` and ships in Chinese. A CJK glyph inks its
 * whole em box, so at a line height of 1 the lime block on line two touched the
 * line above it and the line below touched the block — read in the `zh`
 * screenshot, where 认识 Ego。 and 日常劳动 collide. The extra tenth costs a few
 * pixels of hero height and gives the marker room to read as a highlighter in
 * all three languages rather than as a bar wedged between two rows.
 */
const H1 =
  'font-display text-[2.5rem] font-medium leading-[1.1] tracking-[-0.04em] sm:text-[3.5rem] lg:text-[4.25rem]';

/** A section heading. 28 / 36px. */
const H2 =
  'max-w-[22ch] text-balance font-display text-[1.75rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem]';

/** A cell or step heading. 19px, one weight heavier than the two above it. */
const H3 = 'font-display text-[1.1875rem] font-semibold leading-[1.2] tracking-[-0.02em]';

/** One card. One radius, one hairline, one fill — used by every cell here. */
const CARD = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)]';

/** The reading column. One width, one gutter, every section. */
const SHELL = 'mx-auto w-full max-w-[72rem] px-4 sm:px-6';

export function DiscoverScreen() {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useChoreography(root);

  /*
   * Trúc costs three.js and 1.29 MB of glTF and he stands in the last section
   * of the page. `React.lazy` alone does not defer that — it defers until
   * mount, and a component that mounts with the page has deferred nothing. So
   * he is not mounted until his own section is within a viewport of the fold.
   */
  const [closing, nearTruc] = useOnScreen<HTMLDivElement>('100% 0px');

  return (
    <div ref={root} className="grid-ground min-h-dvh bg-[var(--surface)] text-[var(--foreground)]">
      {/*
        The signature. It mounts nothing on a coarse pointer, under 768px, or
        under `prefers-reduced-motion`, and it hides the native cursor only
        while it is painting a replacement. See `CustomCursor.tsx`.
      */}
      <CustomCursor />

      {/* ---------------------------------------------------------------
          The bar. The sign-in link says what kind of sign-in it is, so a
          collector who has arrived here is not invited into an operator form.
          --------------------------------------------------------------- */}
      <header className="sticky top-0 z-20 px-4 pt-4 sm:px-6">
        <div
          className={cn(
            'mx-auto flex max-w-[72rem] items-center justify-between gap-3',
            'rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--card)]',
            /* `pl-3` below `sm`: at 320px the row was one pixel wider than the
               viewport, and one pixel of horizontal document scroll is still
               horizontal document scroll. */
            'py-2 pl-3 pr-2 shadow-[var(--shadow-sm)] sm:pl-4',
          )}
        >
          <span className="inline-flex items-center gap-2.5">
            <Mark size={24} />
            <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.02em]">
              PlayerOne
            </span>
          </span>
          <div className="flex items-center gap-1">
            <LocaleSwitch />
            <ThemeSwitch />
            {/*
              Not in the bar below `sm`, and this was measured rather than
              guessed. The wordmark, the locale select — whose width is set by
              its longest option, *Tiếng Việt* — the theme toggle and this
              button need 470px of row; at 390 the document's `scrollWidth` was
              470 against a `clientWidth` of 390, so the whole page scrolled
              sideways by 80px. Nothing is lost: the closing split carries the
              same sign-in, and a sticky shortcut to a control that is already
              reachable is not a shortcut.
            */}
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

      <main>
        {/* ===============================================================
            1. Hero. One authored sequence: the slogan resolves out of a
            blur, the column lifts, and the film frame below opens. The
            timeline lives in `useChoreography` so there is one motion
            system on this page rather than two.
            =============================================================== */}
        <section className={cn(SHELL, 'pt-16 sm:pt-24 lg:pt-28')}>
          <h1 data-choreo-hero="line" className={cn(H1, 'max-w-[16ch] text-balance')}>
            {t('discover.headline.a')}{' '}
            <mark className="marker whitespace-nowrap">{t('discover.headline.mark')}</mark>
            {t('discover.headline.b')}
          </h1>
          {/*
            Ink, not muted grey. This sentence carries the two conditions the
            product runs on — a human reviews the footage, and only approved
            effective minutes are paid — and a condition set one step down from
            the headline in a lighter grey is a condition somebody skips.
          */}
          <p
            data-choreo-hero="lead"
            className="mt-8 max-w-[52ch] text-[1.0625rem] leading-[1.6] sm:text-[1.1875rem]"
          >
            {t('discover.lead')}
          </p>
          {/*
            The product as a whole, not one side of it. This is the public home
            page: somebody arriving here may be a prospective collector, a
            counter operator, a reviewer in Shenzhen or none of the three, and
            the sentence that tells them which of those the page is talking to
            has to come before the two buttons that ask them to choose.
          */}
          <p
            data-choreo-hero="audiences"
            className="mt-4 max-w-[56ch] text-[0.9375rem] leading-[1.65] text-[var(--muted-foreground)] sm:text-[1rem]"
          >
            {t('discover.audiences')}
          </p>
          {/*
            Two calls to action, and they are peers because the audiences are.
            The APK is the collector's whole path onto the platform and the
            console is the operator's and the reviewer's; neither is a footnote
            to the other, so they take the same size and sit on the same line.
          */}
          <div data-choreo-hero="actions" className="mt-10 flex flex-wrap items-start gap-3">
            <ApkAction />
            {/*
              `bg-[var(--card)]` and not the variant's `bg-transparent`. A
              control has to carry its own ground; here it sits over the faint
              grid, so an opaque fill is what makes its measured contrast one
              number rather than two. That bug has shipped on this route once.
            */}
            <Button
              variant="secondary"
              size="xl"
              asChild
              data-cursor-highlight
              className="bg-[var(--card)]"
            >
              <Link to="/login">{t('discover.signIn')}</Link>
            </Button>
          </div>
          <ApkNote />
        </section>

        {/* ===============================================================
            2. Demonstration. One player. Nothing over it.

            It sits in the page's one reading column and not in a wider one of
            its own. A frame 96px to the left of the headline above it is the
            fault the owner named on the last build — *"doesnt align well"* —
            and there is no gain to weigh against it: 1152px of a 1280px source
            is a 0.9x scale, so the film is sharper here than it would be blown
            wider.
            =============================================================== */}
        <section className={cn(SHELL, 'mt-12 sm:mt-16')}>
          {/*
            `sr-only`, for the same reason the panel pair's heading is: the hero
            runs straight into this frame as one authored sequence and a heading
            set between them would cut it in half, but a section with no heading
            is a hole in the document outline and a screen reader arrives at a
            video with no idea what it is of.
          */}
          <h2 className="sr-only">{t('discover.demo.title')}</h2>
          <figure data-choreo-hero="film" className="m-0">
            <div className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--stage)]">
              <video
                src={VIDEO_URL}
                poster="/landing-poster.jpg"
                muted
                loop
                playsInline
                /* Reduced motion: it becomes a video the reader starts, which
                   is the same content without the movement. */
                autoPlay={!reduced}
                controls
                preload="metadata"
                aria-label={t('login.video.region')}
                className="aspect-video w-full object-cover"
              />
            </div>
            <figcaption className="mt-3 max-w-[70ch] text-[0.875rem] leading-[1.55] text-[var(--muted-foreground)]">
              {t('discover.video.caption')}
            </figcaption>
          </figure>
        </section>

        {/* ===============================================================
            3. The four-step strip.

            Each step is a rule, a number and two lines of type, so the four
            read as one sequence. The rule is `--foreground` at 2px, the only
            ink hairline on this page, and it is what makes it a strip.
            =============================================================== */}
        <Reveal className={cn(SHELL, 'mt-24 sm:mt-32')}>
          <h2 className={H2}>{t('discover.how.title')}</h2>
          <ol className="mt-8 grid list-none gap-x-3 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((key, index) => (
              <li key={key} className="border-t-2 border-[var(--foreground)] pt-4">
                <span className="num text-[0.8125rem] font-medium tabular-nums text-[var(--faint-foreground)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={cn(H3, 'mt-2')}>{t(`discover.step.${key}.title`)}</h3>
                <p className="mt-2 text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t(`discover.step.${key}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>

        {/* ===============================================================
            4. The panel pair, full-bleed.

            Figure AI's move: two half-width panels filling the viewport, a
            caption at the foot of each. What is NOT copied is their full-bleed
            imagery — theirs is video shot for the purpose, ours is a 420x420
            still, and stretching it across 720px is the single fastest way to
            make a premium page look like stock. So the ink panel is what fills
            the width and the photograph is a plate held at its own size.

            The heading is `sr-only`: the panels are one composition and a
            heading above them would break the bleed, but a section with no
            heading is a hole in the document outline.
            =============================================================== */}
        <Reveal className="mt-24 sm:mt-32">
          <h2 className="sr-only">{t('discover.panels.title')}</h2>
          <div className="grid gap-px bg-[var(--stage-line)] sm:grid-cols-2">
            <PanelPlate src="/tiles/film-chop.jpg" caption={t('discover.panel.a.caption')} />
            <PanelPlate src="/tiles/film-books.jpg" caption={t('discover.panel.b.caption')} />
          </div>
        </Reveal>

        {/* ===============================================================
            5. The bento: 7 + 5, text-led, two stills across two rows each.

            One twelve-column grid, one gutter (12px, `space[3]`), one radius.
            The spans are unequal on purpose — genuine randomness reads as a
            mistake, which is exactly what the deleted scatter read as — and
            below `lg` every span collapses to full width **in the same order**,
            because the order is the argument.

            **Each still spans two rows, and that is the whole geometry.** Laid
            out one cell per row with `items-start`, a three-sentence text cell
            beside a 341px photograph left about 200px of nothing under the type
            before the next row began — measured, and it is exactly the "uneven
            and inconsistent spacing between text and images" the owner named.
            A photograph that is twice the height of a text cell belongs across
            two of them; then there is no hole, the still gets a taller box than
            it would otherwise have, and the unequal spans are doing work rather
            than being decoration.
            =============================================================== */}
        <Reveal className={cn(SHELL, 'mt-24 sm:mt-32')}>
          <h2 className={H2}>{t('discover.mosaic.title')}</h2>
          <div className="mt-8 grid gap-3 lg:grid-cols-12">
            <Cell className="lg:col-span-7" title={t('discover.cell.camera.title')}>
              {t('discover.cell.camera.body')}
            </Cell>
            <Still
              className="lg:col-span-5 lg:row-span-2"
              src="/tiles/film-garden.jpg"
              caption={t('discover.cell.pov.caption')}
            />
            <Cell className="lg:col-span-7" title={t('discover.cell.activities.title')}>
              {t('discover.cell.activities.body')}
            </Cell>
            <Cell className="lg:col-span-7" title={t('discover.cell.review.title')}>
              {t('discover.cell.review.body')}
            </Cell>
            <Still
              className="lg:col-span-5 lg:row-span-2"
              src="/tiles/hf-garden.jpg"
              caption={t('discover.cell.work.caption')}
            />
            {/* The screen's one ink block, on the number the whole product
                turns on. `.feature-block` is the console's single near-black
                surface; see `DESIGN.md`. */}
            <Cell ink className="lg:col-span-7" title={t('discover.cell.minutes.title')}>
              {t('discover.cell.minutes.body')}
            </Cell>
          </div>
        </Reveal>

        {/* ===============================================================
            6. FAQ. Rounded grey rows, the first open.
            =============================================================== */}
        <Reveal className={cn(SHELL, 'mt-24 sm:mt-32')}>
          <h2 className={H2}>{t('discover.before.title')}</h2>
          <div className="mt-8 flex flex-col gap-2">
            {QUESTIONS.map((key, index) => (
              <Row
                key={key}
                open={index === 0}
                question={t(`discover.before.q.${key}`)}
                answer={t(`discover.before.a.${key}`)}
              />
            ))}
          </div>
        </Reveal>

        {/* ===============================================================
            7. Where to go from here. The 50/50 split, carrying the film.

            Both audiences, as peers, at the moment of highest intent. The
            split is the arrangement the owner asked to have back, and the film
            half is the same footage the page opened with rather than a second
            film that does not exist — muted, not autoplaying, `preload="none"`,
            so the closing panel costs nothing until somebody presses it.
            =============================================================== */}
        <Reveal className={cn(SHELL, 'mt-24 sm:mt-32')}>
          <div
            ref={closing}
            className={cn(
              'grid overflow-hidden rounded-[var(--radius-lg)]',
              'border border-[var(--border)] lg:grid-cols-2',
            )}
          >
            <div className="on-stage flex items-center justify-center p-4 sm:p-6">
              <video
                src={VIDEO_URL}
                poster="/landing-poster.jpg"
                muted
                loop
                playsInline
                controls
                preload="none"
                aria-label={t('login.video.region')}
                className="aspect-video w-full rounded-[var(--radius-base)] object-cover"
              />
            </div>

            <div className="flex flex-col bg-[var(--card)] px-6 py-8 sm:px-9 sm:py-10">
              <h2 className={H2}>{t('discover.ways.title')}</h2>

              {/*
                The same two peers as the hero, at the moment of highest intent,
                and **both** of them: a reader who has just been shown seven
                sections about collecting must not arrive at an operator form on
                its own. Same heading level, same body treatment, same button
                size — a hairline between them and nothing else, because a card
                around one of the two would rank them.
              */}
              <div className="mt-8">
                <h3 className={H3}>{t('discover.take.title')}</h3>
                <p className="mt-2 max-w-[52ch] text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t('discover.take.body')}
                </p>
                <div className="mt-5">
                  <ApkAction />
                  <ApkNote />
                </div>
              </div>

              <div className="mt-8 border-t border-[var(--border)] pt-8">
                <h3 className={H3}>{t('discover.handoff.title')}</h3>
                <p className="mt-2 max-w-[52ch] text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t('discover.handoff.body')}
                </p>
                <div className="mt-5">
                  <Button variant="secondary" size="xl" asChild data-cursor-highlight>
                    <Link to="/login">{t('discover.signIn')}</Link>
                  </Button>
                </div>
              </div>

              {/*
                Trúc, in the corner, occluding nothing.

                He was stripped from this page and that was wrong; he was also
                once 520px across the middle of the film, which drew a cartoon
                panda over the face of the collector the film is about. The
                ruling is about occlusion rather than about corners — *"Only
                the panda is allowed to sit on the corner bc its not blocking
                anything"* — so he gets a row of his own at the foot of this
                card, over empty card and nothing else. `hidden` below `sm`,
                where a 176px canvas would reach the type.
              */}
              <div className="mt-auto hidden justify-end pt-8 sm:flex">
                {nearTruc ? <TrucAsk /> : null}
              </div>
            </div>
          </div>
        </Reveal>
      </main>

      <Footer>{t('discover.credits')}</Footer>
    </div>
  );
}

/**
 * The collector's call to action, and it tells the truth in both states.
 *
 * With `APK_URL` set it is a download link — `download` so the browser saves
 * the file rather than trying to render it, `rel="noopener"` because a release
 * asset is very likely on another origin.
 *
 * With `APK_URL` empty, which is today, it is the same control at the same size,
 * `disabled`, with one sentence under it saying the build is not released and
 * there is nothing to download from this page. That is deliberately not a
 * hidden button: this is the product's public home page and "there will be an
 * Android build" is part of what it has to say. What it must never do is look
 * available and then 404, which is what a guessed store URL or a guessed
 * `/playerone.apk` would do.
 *
 * No version number, no file size, no store link, and no `data-` attribute
 * standing in for a decision. There is one constant and it is at the top of
 * this file.
 */
function ApkAction() {
  const { t } = useTranslation();

  if (APK_URL === '') {
    return (
      /*
       * `disabled:opacity-60` overrides the primary variant's own
       * `disabled:opacity-100`, and the override is the point.
       *
       * That variant deliberately keeps a disabled primary at full ink minus
       * three per cent of brightness, which is right for the console's submit
       * buttons: a form that is mid-flight has not become unavailable and a
       * button that fades every time somebody presses it reads as flicker.
       * Measured here, though, it renders at `opacity: 1` and is
       * indistinguishable from the live control beside it — a black pill on a
       * public product page that looks like a download and does nothing. So
       * this instance fades, and the sentence underneath says why.
       */
      <Button
        type="button"
        variant="primary"
        size="xl"
        disabled
        className="disabled:opacity-60"
      >
        {t('discover.take.cta')}
      </Button>
    );
  }

  return (
    <Button variant="primary" size="xl" asChild data-cursor-highlight>
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
 * cell, and that is a layout fact rather than a style: inside the row, a 48ch
 * paragraph sets the width of its flex item and pushes the console sign-in
 * 200px to the right of the download — which is a hole between two controls
 * that are supposed to read as peers. Under the row it explains one of them and
 * moves neither.
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
 * One full-bleed panel: a near-black ground, a plate at the size the file is
 * sharp at, and the caption at the foot.
 *
 * The plate is 420x420 rendered into at most 416px, which is a 0.99x scale —
 * the photograph is never enlarged. `object-cover` on a square box crops
 * nothing, so what the frame holds is what the frame held.
 */
function PanelPlate({ src, caption }: { src: string; caption: string }) {
  return (
    <figure className="on-stage m-0 flex flex-col justify-center gap-8 p-6 sm:gap-10 sm:p-12">
      <img
        src={src}
        alt=""
        width={420}
        height={420}
        loading="lazy"
        decoding="async"
        className="mx-auto w-full max-w-[30rem] rounded-[var(--radius-base)] object-cover"
      />
      <figcaption className="max-w-[34ch] text-[0.9375rem] leading-[1.55] text-[var(--stage-fg)]">
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * One FAQ row, and it is a native `<details>`.
 *
 * Nothing here is a state machine: the browser owns the open state, the
 * disclosure role and the keyboard, and a reader with no JavaScript still gets
 * every answer. The first row is `open` so the pattern is legible on arrival
 * rather than four grey bars somebody has to guess at.
 *
 * The marker is removed on both engines and replaced with a glyph that turns:
 * Chrome and Safari draw `::-webkit-details-marker`, Firefox draws the
 * `list-style` triangle, and hiding only one leaves a stray arrow in the other.
 */
function Row({ question, answer, open }: { question: string; answer: string; open: boolean }) {
  return (
    <details
      open={open}
      className="group rounded-[var(--radius-lg)] bg-[var(--muted)] px-5 py-4 sm:px-6 sm:py-5"
    >
      <summary
        data-cursor-highlight
        className={cn(
          'flex list-none items-center justify-between gap-4 text-[1rem] font-semibold leading-[1.4]',
          /*
           * Both markers, and both are needed. `list-none` and
           * `::-webkit-details-marker` between them cover Firefox and older
           * WebKit, but Chrome lays out a `::marker` box as the first flex item
           * of a `display: flex` summary even with `list-style: none` — measured
           * at 5px of horizontal overflow on every row, which `rhythm.mjs`
           * reports as clipping because that is exactly what it is.
           */
          '[&::-webkit-details-marker]:hidden [&::marker]:content-[""]',
          'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]',
        )}
      >
        {question}
        {/*
          The glyph turns, the ring does not.

          Rotating the 24px ring itself gives it a 33.9px diagonal bounding box,
          and a transform contributes to scrollable overflow — measured, the open
          row reported 5px of horizontal clipping in `rhythm.mjs` at all three
          widths while the three closed rows were clean. Turning the plus inside
          a ring that stays put is the same movement with no layout cost.
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

/** One text-led bento cell: a specific heading and two useful sentences. */
function Cell({
  title,
  children,
  className,
  ink = false,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  ink?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-[var(--radius-lg)] px-6 py-6',
        ink ? 'feature-block' : CARD,
        className,
      )}
    >
      <h3 className={H3}>{title}</h3>
      <p
        className={cn(
          'mt-3 max-w-[56ch] text-[0.9375rem] leading-[1.6]',
          ink ? 'text-[var(--stage-mid)]' : 'text-[var(--muted-foreground)]',
        )}
      >
        {children}
      </p>
    </div>
  );
}

/**
 * One still, sharp.
 *
 * `alt=""` with a real caption: the caption is the description, and a screen
 * reader that reads both hears the same sentence twice. The picture is never
 * swapped, cross-faded or punched into — it keeps its own identity for the
 * whole visit, which is the thing the deleted hover effect took away.
 */
function Still({ src, caption, className }: { src: string; caption: string; className?: string }) {
  return (
    <figure className={cn('m-0 flex flex-col', className)}>
      {/*
        The picture is absolutely positioned inside its frame, and that is the
        whole trick of this bento.

        In flow, a 420x420 file in a 455px cell contributes 455px of intrinsic
        height; spanning two text rows of about 145px each, it forced the pair
        to 490 and left 200px of nothing under every paragraph beside it — the
        same "uneven spacing between text and images" fault, moved rather than
        fixed. Out of flow it contributes none, so the rows are sized by the
        type and the photograph fills exactly what the type came to. The floor
        is for the stacked layout below `lg`, where there is no row to fill.
      */}
      <div className={cn('relative min-h-[13rem] flex-1 overflow-hidden bg-[var(--muted)]', CARD)}>
        <img
          src={src}
          alt=""
          width={420}
          height={420}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <figcaption className="mt-3 text-[0.8125rem] leading-[1.5] text-[var(--muted-foreground)]">
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * The credits line, and it is a link to the file rather than a claim.
 *
 * Two of the photographs on this page are generated placeholders and
 * `CREDITS.json` records that. A landing that shows them with no route to that
 * fact is a landing implying the pictures are documentary, which they are not.
 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-24 border-t border-[var(--border)] px-4 py-8 text-center sm:px-6">
      <a
        href="/tiles/CREDITS.json"
        data-cursor-highlight
        className={cn(
          'text-[0.75rem] underline decoration-current/40 underline-offset-2',
          'transition-colors duration-150 ease-[var(--ease)] hover:decoration-current',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
        )}
      >
        {children}
      </a>
    </footer>
  );
}
