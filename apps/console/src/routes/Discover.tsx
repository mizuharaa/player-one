/**
 * `/discover` — what the product is, on a public route of its own.
 *
 * ## Why it exists
 *
 * This was the top four fifths of `/login`. An operator arriving at an
 * internal console had to scroll or skip past a sales presentation to reach a
 * password box, and the presentation itself was rejected: *"it looks
 * horrendous"*, *"The current design is meh"*. The story is worth telling —
 * he asked for more product information and an opening line that means
 * something in all three languages — but not in front of the form. So it is
 * here, `/login` is plain, and an unauthenticated visit to `/` lands on this
 * page with sign-in one click away in the bar.
 *
 * ## What came off this route, permanently
 *
 * The single biggest tell of a generated page is arbitrary arrangement plus
 * unrelated animation. All of this is gone and none of it has a second caller:
 *
 * - the scatter of eleven tilted photographs at eleven different sizes;
 * - the rainbow prism disc, and the three-variant burst it fired on hover;
 * - the horizontal marquee;
 * - the rotating circular type element, which sat **on top of the film** —
 *   *"theres random circular text blocking the demo"*;
 * - the flat scrim over the film, which existed only to make that circular
 *   type legible and dimmed the footage for no other reason;
 * - the hover effect that replaced each photograph with a different
 *   photograph — *"so weird uncanny img i dont even know where it came from"*,
 *   and he is right: swapping one photo for another photo means nothing.
 *
 * **Nothing is drawn over the video.** No scrim, no filter, no type, no
 * mascot. There is exactly one player on this page and it is the only place
 * `landing.mp4` appears. Trúc kept his corner and lost the film — the ruling
 * was *"Only the panda is allowed to sit on the corner bc its not blocking
 * anything"*, which is a rule about occlusion rather than about corners, so he
 * stands in the corner of the closing card, over empty card and nothing else.
 *
 * ## The six sections, in this order
 *
 * 1. **Hero** — the introduction, one explanatory sentence, a real photograph
 *    of the camera being worn during an activity, the "see how it works"
 *    action and a clearly labelled operator sign-in.
 * 2. **Demonstration** — `landing.mp4`, captioned, unobstructed.
 * 3. **Four-step strip** — record → upload → human review → payment for
 *    approved effective minutes. A numbered strip, not four cards.
 * 4. **Product mosaic** — text-led cells with selected stills, adding detail
 *    the strip does not carry: the camera, which activities count, how review
 *    works, how payable minutes are determined.
 * 5. **Before you participate** — four questions answered with established
 *    facts.
 * 6. **Handoff** — already an operator or a reviewer? Sign in. And an explicit
 *    statement that this is not collector registration.
 *
 * ## The opening line, and what it must not imply
 *
 * *"Meet Ego. Everyday tasks, from your point of view."* with the explanatory
 * sentence directly under it, which is **not optional**: "Meet Ego" on its own
 * reads as a consumer-device launch and says nothing about taking part. The
 * sentence names the two conditions the product actually runs on — that a
 * human reviews the footage, and that only approved effective minutes are
 * paid.
 *
 * Nothing on this page implies device ownership, unrestricted recording,
 * automatic acceptance, payment for every recorded minute, guaranteed earnings
 * or instant payout. Section 5 exists to say the opposite of each in plain
 * words.
 *
 * ## The grid, and why it is not random
 *
 * Fauna's feature grid and Orchid's mosaic are not random. They are strict
 * grids with deliberately **unequal spans**, and the gutter and the corner
 * radius never vary. Genuine randomness reads as a mistake, which is exactly
 * what the old scatter read as.
 *
 * One twelve-column grid, one gutter (12px, `space[3]`), one radius
 * (`--radius-lg`). The hero is 7+5, the mosaic runs 7+5 / 7+5 / 8+4, and the
 * strip is four equal columns because a sequence with a wider third step would
 * be saying the third step is bigger. Below `lg` every span collapses to full
 * width **in the same order**, because the order is the argument.
 *
 * The mosaic is `items-start`, which was measured rather than chosen. Stretched
 * to the height of the still beside it, a three-sentence cell was 150px of type
 * in a 455px card — 67% empty, which is the "no empty panels" rule broken by
 * geometry rather than by copy. Each cell is its own height now and the rows
 * step, which is what a bento does.
 *
 * ## Why the photographs are small, on purpose
 *
 * Every still in `public/tiles/` is 420×420. Across a 1152px column a 420px
 * source is a 2.7× upscale and visibly soft, and these photographs are the
 * page's only *evidence* of what the product collects — blurring or stretching
 * scarce evidence weakens the one proof the page has. So the stills sit in
 * five-column cells (about 455px at the widest container, a 1.08× upscale) and
 * there are three of them rather than eleven. The video is 1280×720 and is the
 * only asset that can carry a wide column sharply, which is why it does.
 *
 * ## Colour: three roles, not three hues
 *
 * `--surface` is the broad near-white ground. `--foreground` is the ink.
 * `--action` / `--action-ink` is the primary button. Lime is spent **once**,
 * on the highlight marker in the headline. No yellow, no orange, no prism: sun
 * and tech are the partner mark and nothing else. The mosaic's payable-minutes
 * cell is the screen's one ink block.
 *
 * ## Numbers
 *
 * Every figure here is a **process fact** — how the platform works — and not a
 * statistic. There are no user counts, no payout totals and no percentages,
 * invented or otherwise. This is a payout-bearing product and a made-up number
 * on its landing is the worst thing it could ship.
 *
 * ## Motion
 *
 * `useChoreography` — the same one Home uses, now shared. Sections that start
 * below the fold rise once as they reach it, in document order; a section
 * already on screen is left alone. Every hidden start state is created by GSAP
 * at the moment it builds the tween that clears it, so reduced motion, a
 * blocked chunk and a script that threw all leave a complete page.
 *
 * The video carries native `controls`: WCAG 2.2 SC 2.2.2 wants a mechanism to
 * stop content that moves for more than five seconds, and the browser's own is
 * better than a bespoke glyph this console would then have to name in three
 * languages.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { TrucAsk } from '../components/identity/TrucAsk.tsx';
import { Button } from '../components/ui/button.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { Reveal, useChoreography, useOnScreen } from '../lib/choreo.tsx';
import { cn } from '../lib/cn.ts';

/**
 * The film. `apps/console/public/landing.mp4` (12.96s, 1280×720, 1.39 MB)
 * ships with the console, so the page is complete with no environment set.
 * `VITE_LANDING_VIDEO_URL` stays as the seam a deployment uses to point at a
 * longer cut or a CDN copy without a rebuild of this file.
 */
const VIDEO_URL: string =
  typeof import.meta.env.VITE_LANDING_VIDEO_URL === 'string' &&
  import.meta.env.VITE_LANDING_VIDEO_URL !== ''
    ? import.meta.env.VITE_LANDING_VIDEO_URL
    : '/landing.mp4';

/** The three facts under the hero action. Facts about the process, not counts. */
const FACTS = ['paid', 'path', 'judgement'] as const;

/** The sequence, and the order is the argument. */
const STEPS = ['record', 'upload', 'review', 'payment'] as const;

/** The four questions in section 5. */
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

/** A category label: small, faint, tracked out. */
const EYEBROW = 'text-[0.6875rem] font-bold uppercase tracking-[0.09em]';

/* -------------------------------------------------------------------------
   The display scale, declared once.

   `DESIGN.md` asks for this: a page's type scale belongs in one block, not
   spread through the component as arbitrary sizes nobody can compare. Three
   steps, and the **weight runs the opposite way to the size** — 500 on the
   headline, 600 on a cell heading — which is most of the difference between
   display type that looks expensive and display type that looks like a
   browser default. Tracking tightens as the size grows, for the same reason.

   Orchid's contribution is the ratio and the air around it rather than its
   serif: `--font-display` is Hanken Grotesk Variable, which is already
   verified to ship a Vietnamese subset, and it stays.
   ---------------------------------------------------------------------- */

/** The opening line. 40 / 56 / 68px. */
const H1 =
  'font-display text-[2.5rem] font-medium leading-[1] tracking-[-0.04em] sm:text-[3.5rem] lg:text-[4.25rem]';

/** A section heading. 28 / 36px. */
const H2 =
  'max-w-[22ch] text-balance font-display text-[1.75rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem]';

/** A cell or step heading. 19px, one weight heavier than the two above it. */
const H3 = 'font-display text-[1.1875rem] font-semibold leading-[1.2] tracking-[-0.02em]';

/** One card. One radius, one hairline, one fill — used by every cell here. */
const CARD = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)]';

export function DiscoverScreen() {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useChoreography(root);

  /*
   * Trúc costs three.js and 1.29 MB of glTF, and he stands at the very bottom
   * of the page. `React.lazy` alone does not defer that — it defers until
   * mount, and a component that mounts with the page has deferred nothing. So
   * he is not mounted until his own section is within a viewport of the fold,
   * which is the same gate Home puts on him.
   */
  const [closing, nearTruc] = useOnScreen<HTMLDivElement>('100% 0px');

  return (
    <div ref={root} className="grid-ground min-h-dvh bg-[var(--surface)] text-[var(--foreground)]">
      {/* ---------------------------------------------------------------
          The bar: a small pill, which is the shape the reference set uses.
          The sign-in link is in it and says what kind of sign-in it is, so a
          collector who has arrived here is not invited into an operator form.
          --------------------------------------------------------------- */}
      <header className="sticky top-0 z-20 px-4 pt-4 sm:px-6">
        <div
          className={cn(
            'mx-auto flex max-w-[72rem] items-center justify-between gap-3',
            'rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--card)]',
            /* `pl-3` below `sm`: at 320px the row was one pixel wider than
               the viewport, and one pixel of horizontal document scroll is
               still horizontal document scroll. */
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
              button need 470px of row; at 390 the document's `scrollWidth`
              was 470 against a `clientWidth` of 390, so the whole page
              scrolled sideways by 80px and every measurement taken on it was
              taken 16px to the left of where the element actually sits.

              Nothing is lost by dropping it here: the hero's own operator
              sign-in is on the first screen at every width, and the handoff
              card carries a third. A sticky shortcut to a control that is
              already visible is not a shortcut.
            */}
            <Button
              variant="primary"
              size="sm"
              asChild
              className="ml-1 hidden rounded-[var(--radius-pill)] px-4 sm:inline-flex"
            >
              <Link to="/login">{t('discover.signIn')}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[72rem] px-4 pb-24 sm:px-6">
        {/* ===============================================================
            1. Hero.
            =============================================================== */}
        <section className="grid items-center gap-8 pt-14 sm:pt-20 lg:grid-cols-12 lg:gap-3">
          <div className="lg:col-span-7">
            <h1 className={cn(H1, 'max-w-[18ch] text-balance')}>
              {t('discover.headline.a')}{' '}
              <mark className="marker whitespace-nowrap">{t('discover.headline.mark')}</mark>
              {t('discover.headline.b')}
            </h1>
            {/*
              Ink, not muted grey. This sentence carries the two conditions the
              product runs on — a human reviews the footage, and only approved
              effective minutes are paid — and a condition set one step down
              from the headline in a lighter grey is a condition somebody skips.
            */}
            <p className="mt-6 max-w-[46ch] text-[1.0625rem] leading-[1.6] sm:text-[1.125rem]">
              {t('discover.lead')}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="xl" asChild>
                <a href="#how">{t('discover.how')}</a>
              </Button>
              {/*
                `bg-[var(--card)]` and not the variant's `bg-transparent`.

                A control has to carry its own ground. `secondary` is
                transparent everywhere else in the console, which is right on a
                page whose ground does not move; here it sits over the faint
                grid, so an opaque fill is what makes its measured contrast one
                number rather than two. That bug has already shipped on this
                route once.
              */}
              <Button variant="secondary" size="lg" asChild className="bg-[var(--card)]">
                <Link to="/login">{t('discover.signIn')}</Link>
              </Button>
            </div>
          </div>

          {/*
            The proof photograph, at a size it is actually sharp at. A 420×420
            source in a five-column cell; see the note at the top of this file.
          */}
          <figure className="lg:col-span-5">
            <div className={cn('overflow-hidden bg-[var(--muted)]', CARD)}>
              <img
                src="/tiles/film-kitchen.jpg"
                alt=""
                width={420}
                height={420}
                className="aspect-square w-full object-cover"
              />
            </div>
            <figcaption className="mt-3 text-[0.8125rem] leading-[1.5] text-[var(--muted-foreground)]">
              {t('discover.hero.caption')}
            </figcaption>
          </figure>

          {/* Teak's three-item row, directly under the action. */}
          <dl className="grid gap-3 sm:grid-cols-3 lg:col-span-12 lg:mt-5">
            {FACTS.map((key) => (
              <div key={key} className={cn(CARD, 'px-5 py-5')}>
                <dt className={cn(EYEBROW, 'text-[var(--faint-foreground)]')}>
                  {t(`discover.fact.${key}.label`)}
                </dt>
                <dd className="mt-2 text-[0.9375rem] font-medium leading-[1.5]">
                  {t(`discover.fact.${key}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ===============================================================
            2. Demonstration. One player. Nothing over it.
            =============================================================== */}
        <Reveal className="mt-24 sm:mt-32">
          <h2 className={H2}>{t('discover.demo.title')}</h2>
          <figure className="mt-8">
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
        </Reveal>

        {/* ===============================================================
            3. The four-step strip.

            A strip and not four cards: each step is a rule, a number and two
            lines of type, so the four read as one sequence rather than as four
            things to choose between. The rule is `--foreground` at 2px, the
            only ink hairline on this page, and it is what makes it a strip.
            =============================================================== */}
        <Reveal id="how" className="mt-24 scroll-mt-24 sm:mt-32">
          <h2 className={H2}>{t('discover.how.title')}</h2>
          <ol className="mt-8 grid list-none gap-x-3 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((key, index) => (
              <li key={key} className="border-t-2 border-[var(--foreground)] pt-4">
                <span className="num text-[0.8125rem] font-medium tabular-nums text-[var(--faint-foreground)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className={cn(H3, 'mt-2')}>
                  {t(`discover.step.${key}.title`)}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t(`discover.step.${key}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>

        {/* ===============================================================
            4. The mosaic: 7+5 / 7+5 / 8+4, text-led, two stills.

            Every cell is finished editorial copy with a subject of its own,
            and none of them repeats a step from the strip above: the strip
            says what happens, these say what the camera is, what counts as
            suitable, what a reviewer actually does, and how the payable number
            is arrived at.
            =============================================================== */}
        <Reveal className="mt-24 sm:mt-32">
          <h2 className={H2}>{t('discover.mosaic.title')}</h2>
          <div className="mt-8 grid items-start gap-3 lg:grid-cols-12">
            <Cell className="lg:col-span-7" title={t('discover.cell.camera.title')}>
              {t('discover.cell.camera.body')}
            </Cell>
            <Still
              className="lg:col-span-5"
              src="/tiles/film-garden.jpg"
              caption={t('discover.cell.pov.caption')}
            />
            <Cell className="lg:col-span-7" title={t('discover.cell.activities.title')}>
              {t('discover.cell.activities.body')}
            </Cell>
            <Still
              className="lg:col-span-5"
              src="/tiles/hf-garden.jpg"
              caption={t('discover.cell.work.caption')}
            />
            <Cell className="lg:col-span-8" title={t('discover.cell.review.title')}>
              {t('discover.cell.review.body')}
            </Cell>
            {/* The screen's one ink block, on the number the whole product
                turns on. `.feature-block` is the console's single near-black
                surface; see `DESIGN.md`. */}
            <Cell ink className="lg:col-span-4" title={t('discover.cell.minutes.title')}>
              {t('discover.cell.minutes.body')}
            </Cell>
          </div>
        </Reveal>

        {/* ===============================================================
            5. Before you participate.
            =============================================================== */}
        <Reveal className="mt-24 sm:mt-32">
          <h2 className={H2}>{t('discover.before.title')}</h2>
          <dl className="mt-8 grid gap-x-3 gap-y-8 sm:grid-cols-2">
            {QUESTIONS.map((key) => (
              <div key={key}>
                <dt className="text-[1.0625rem] font-semibold leading-[1.35]">
                  {t(`discover.before.q.${key}`)}
                </dt>
                <dd className="mt-2 max-w-[52ch] text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t(`discover.before.a.${key}`)}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* ===============================================================
            6. The handoff, and Trúc's corner.
            =============================================================== */}
        <Reveal className="mt-24 sm:mt-32">
          <div
            ref={closing}
            className={cn(CARD, 'relative px-6 py-10 text-center sm:px-10 sm:py-14')}
          >
            {/*
              He overlaps no photograph, no type and no frame of the film: this
              card's content is centred inside a `max-w` and the corner is
              empty. `hidden` below `sm`, where a 176px canvas would reach the
              text.
            */}
            <div className="pointer-events-none absolute bottom-0 right-2 hidden sm:block lg:right-6">
              <div className="pointer-events-auto">{nearTruc ? <TrucAsk /> : null}</div>
            </div>

            <h2 className={cn(H2, 'mx-auto max-w-[24ch]')}>{t('discover.handoff.title')}</h2>
            <p className="mx-auto mt-4 max-w-[54ch] text-[1rem] leading-[1.6] text-[var(--muted-foreground)]">
              {t('discover.handoff.body')}
            </p>
            <div className="mt-8">
              <Button variant="primary" size="xl" asChild>
                <Link to="/login">{t('discover.signIn')}</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </main>

      <Footer>{t('discover.credits')}</Footer>
    </div>
  );
}

/** One text-led mosaic cell: a specific heading and two useful sentences. */
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
    <figure className={cn('flex flex-col', className)}>
      <div className={cn('overflow-hidden bg-[var(--muted)]', CARD)}>
        <img
          src={src}
          alt=""
          width={420}
          height={420}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full object-cover"
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
 * One of the three photographs on this page is a generated placeholder and
 * `CREDITS.json` records that. A landing that shows it with no route to that
 * fact is a landing implying the picture is documentary, which it is not.
 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="border-t border-[var(--border)] px-4 py-8 text-center sm:px-6">
      <a
        href="/tiles/CREDITS.json"
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
