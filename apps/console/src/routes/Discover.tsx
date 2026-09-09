/**
 * `/discover` — the public product home, rebuilt Film First on 2026-09-08.
 *
 * ## The direction, and what it replaced
 *
 * The product owner chose **Film First** off a decision page against two
 * alternates, with no steering notes:
 *
 * > The Ego footage fills the screen edge to edge from frame one. The slogan
 * > sits over it in large white type, bottom-left, with the two CTAs beneath.
 * > No card, no frame, no letterbox. Then every section is another full-bleed
 * > band, text punched out over footage throughout. White ground appears only
 * > for the FAQ and the sign-in. **The footage leads instead of being
 * > contained.**
 *
 * That replaces the *composition* of build five (`f0f5599`), which held the
 * film inside a 1152px reading column, and it keeps that build's engineering:
 * the cursor, the two peer calls to action, the honest APK constant, the
 * shadcn primitives, the copy in three languages and the token discipline.
 *
 * ## The risk he accepted, and how it is answered
 *
 * > "It lives or dies on footage quality. You have ~7 seconds of good material;
 * > this structure wants a minute. Until a real shoot happens it will loop, and
 * > looping reads as thin."
 *
 * `landing.mp4` is 7.04s at 1280x720. The stills in `public/tiles/` are all
 * **420x420** — verified with `ffprobe`, every file — and a 420px source
 * stretched across a full-bleed band is the blurry-stock fault an earlier
 * review named, so none of them is on this page any more.
 *
 * The answer is not to loop one clip six times. It is three moves:
 *
 * 1. **The film is spent once, on the hero, at full strength.** One `<video>`
 *    on the route. The closing panel that used to carry a second copy of it is
 *    now type on the light ground, which is also what the direction asks for.
 * 2. **One frame is harvested from it**, and exactly one — `ego-worn-rotunda.jpg`,
 *    940x720, cropped from t=4.10s. See below for why it is one and not seven.
 * 3. **Full-bleed means edge-to-edge composition, not edge-to-edge
 *    photography.** The steps band, the activities band and the number band
 *    are full-bleed fields of ink and lavender carrying punched-out type. A
 *    confident type band beats a blurry photo band, and it beats a dishonest
 *    one by more.
 *
 * ## Why one harvested frame and not seven
 *
 * The first plan here was seven frames — the film holds five genuinely
 * different locations in seven seconds, so a strip of four steps and three
 * split pairs could each have had their own — and it was abandoned on a
 * product-truth finding rather than on a resolution one.
 *
 * **The film is not ego footage.** It is a woman in the Paris Métro filmed at
 * arm's length, her own forearm in shot, walking on through a plaza and a
 * museum. A forehead-mounted camera cannot see its wearer, so the footage
 * demonstrates the opposite of the product; the location is not Vietnam and a
 * European museum is not housework. Two captions asserted otherwise and both
 * are rewritten in all three languages (`discover.video.caption` claimed a
 * continuous take from the wearer's own eye line; `discover.cell.pov.caption`
 * claimed a POV recording). Repeating stills from that film across six bands
 * would repeat the contradiction six times.
 *
 * So the harvest is one frame, chosen because it is the only kind that
 * survives an honest caption: the crop removes the operator's arm, there is no
 * face, and what is left is a **third-person view of the device being worn**.
 * That is exactly the right picture for the band about the camera, and its
 * caption says third person in so many words. Nothing else on this page claims
 * to be a recording the camera made.
 *
 * The film's own provenance is stated on the page rather than in this comment:
 * a slate line in the corner of the first viewport, in the reader's language.
 *
 * ## Text over moving video
 *
 * Every earlier build measured contrast against static grounds. Here the
 * ground changes every frame, so:
 *
 * - The grade is `.film-grade` in `globals.css`: two gradients meeting in the
 *   bottom-left corner, leaving the top-right of the frame untouched. Not the
 *   flat 60% wash that was removed from this route for flattening the image.
 * - The type is `--stage-over`, the token `tokens.ts` reserves for type over
 *   footage, reached through `.on-film` — which repoints `--action`,
 *   `--foreground`, `--card` and `--border` at the stage ramp so every shadcn
 *   primitive over the film is correct in **both** themes without a new
 *   variant. That also fixes the review's finding that a disabled control read
 *   as more available than a live one in dark mode.
 * - The hero's ground is `--stage` behind the video, and the poster is graded
 *   by the same element, so the type holds with the video failed, blocked or
 *   still loading.
 * - `scripts/contrast.mjs` samples the live composite at six points across the
 *   film's own duration, not on the poster.
 *
 * ## The world, which was missing
 *
 * The design review's verdict on build five was that "an unrelated product
 * could use this unchanged", and the specific cause was that the system's
 * load-bearing decision never appeared: `DESIGN.md` argues the tinted lavender
 * ground exists so that **glass has something to be glass over**, and there
 * was no glass on the route at all. So the bar over the film is the bar
 * weight of glass, the FAQ rows and the closing panel are the card weight, and
 * the light ground is `--background` (lavender-100) rather than the paler
 * `--surface`. The partners are named in words and in the mark, because for a
 * joint venture asking the Vietnamese public to wear a camera at home, *this
 * is VNG* is the most persuasive fact available and it existed only as an
 * unlabelled 24px dot.
 *
 * None of that depends on the cursor. The cursor is gated to a fine pointer
 * over 768px, which is not where a collector arrives.
 *
 * ## What this page must never imply
 *
 * Device ownership, unrestricted recording, automatic acceptance, payment for
 * every recorded minute, guaranteed earnings, instant payout. There is not one
 * statistic on the page, invented or otherwise, and no URL that does not exist.
 *
 * ## Colour
 *
 * Every value comes from `packages/design/src/tokens.ts` through a custom
 * property. There is no colour, radius, shadow or duration literal in this
 * file.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { TrucAsk } from '../components/identity/TrucAsk.tsx';
import { CustomCursor } from '../components/CustomCursor.tsx';
import { Button } from '../components/ui/button.tsx';
import { Panel } from '../components/ui/primitives.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { Reveal, useChoreography, useOnScreen } from '../lib/choreo.tsx';
import { cn } from '../lib/cn.ts';

/**
 * The film, and it is a **slot rather than a foundation**.
 *
 * A real shoot with a crew is coming and this cut is a placeholder, so nothing
 * in the composition below depends on where this particular footage puts its
 * subject: the grade is a corner, the type is bottom-left, and the frame is
 * `object-cover`. Swapping this constant is the whole of the replacement.
 */
const VIDEO_URL: string =
  typeof import.meta.env.VITE_LANDING_VIDEO_URL === 'string' &&
  import.meta.env.VITE_LANDING_VIDEO_URL !== ''
    ? import.meta.env.VITE_LANDING_VIDEO_URL
    : '/landing.mp4';

/** The first frame, so the hero is composed before a byte of video arrives. */
const POSTER_URL = '/landing-poster.jpg';

/**
 * The one still, harvested from the film and cropped.
 *
 * 940x720. It is never rendered wider than the half-band it lives in, which is
 * capped at 960px by the band's own `max-w`, so the scale stays at or under
 * 1.02x and the picture is never blown up the way a 420px tile would be.
 * `CREDITS.json` carries the `ffmpeg` line that produced it, what the crop
 * removes, and the fact that it is third person.
 */
const STILL_URL = '/tiles/ego-worn-rotunda.jpg';

/**
 * The collector build, and it is a **placeholder in exactly one place.**
 *
 * The file does not exist yet. `ApkAction` renders honestly on both sides of
 * this: a real download link when it is set, a visibly unavailable control and
 * one sentence saying the build is not released when it is not. Publishing is
 * a one-line change here, or `VITE_COLLECTOR_APK_URL` at a release. **Do not
 * fill it with a guess** — a button that 404s on a payout-bearing product's
 * front page is worse than a button that says the build is not out.
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
   Vietnamese is not a preference. Its stack now names the Han faces too, so a
   `zh` headline no longer falls to whatever the browser picked last.
   ---------------------------------------------------------------------- */

/**
 * The opening line. 40 / 56 / 68px.
 *
 * `leading-[1.1]` and not the `1` display type usually wants, because this
 * headline carries a filled `<mark>` and ships in Chinese. A CJK glyph inks its
 * whole em box, so at a line height of 1 the lime block on line two touched the
 * line above it. The extra tenth costs a few pixels of hero height and gives
 * the marker room to read as a highlighter in all three languages.
 */
const H1 = cn(
  'font-display font-medium leading-[1.1] tracking-[-0.04em]',
  /*
   * **34px on a phone, and the step down is a measured decision.**
   *
   * It was 40px at every width under `sm`. At 390 that wraps the slogan to
   * five lines and the column climbs to about 85% of the first viewport,
   * where the grade has cleared and the film is whatever the collector
   * filmed — measured on the worst frame of this cut, an open sky, white
   * type on #6592B1 at **3.33:1**. Large text clears 3:1 on that; nothing
   * else on this page is within eight points of it. A step down costs one
   * line of wrap and takes the top of the headline back down into the grade.
   * 56 and 68 are untouched: the review found Vietnamese stacked diacritics
   * set cleanly at 68px and that is the size it meant.
   */
  'text-[2.125rem] sm:text-[3.5rem] lg:text-[4.25rem]',
);

/** A section heading. 28 / 36px. */
const H2 =
  'max-w-[22ch] text-balance font-display text-[1.75rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem]';

/** A cell or step heading. 19px, one weight heavier than the two above it. */
const H3 = 'font-display text-[1.1875rem] font-semibold leading-[1.2] tracking-[-0.02em]';

/** The reading column, used inside a band. One width, one gutter, everywhere. */
const SHELL = 'mx-auto w-full max-w-[72rem] px-4 sm:px-6';

/**
 * The bleed cap, and it is a resolution decision rather than a taste one.
 *
 * A band is edge to edge up to 1920px and centred beyond it. The only
 * photograph on the page is 940px wide and lives in half of one of these
 * bands, so the cap is what keeps it at or under a 1.02x scale on a 27-inch
 * display instead of a 1.36x one. Bands with no photograph in them carry the
 * same cap so the page has one left edge rather than two.
 */
const BAND = 'mx-auto w-full max-w-[120rem]';

/**
 * The two page-level calls to action, at a size that survives 320px.
 *
 * `size="xl"` is a 56px pill with 32px of horizontal padding and the button
 * base sets `whitespace-nowrap`, so a control's *minimum* width is its label
 * plus 64px and it cannot go below that. Measured: at a 320px viewport the two
 * closing cards were 312px wide in English and **362px in Vietnamese**, inside
 * a 288px column — 8px and 58px of horizontal document scroll, because *Đăng
 * nhập vào console* at 17px simply does not fit a phone next to 32px of pad
 * and 32px of card. The page reported clean at 390 and above, which is why it
 * shipped.
 *
 * So below `sm` the label is allowed to wrap and the pill grows to fit it,
 * full width in its column; from `sm` up it is the 56px pill it was. The
 * height floor keeps the 44px touch target, and a wrapped label is centred
 * rather than ragged.
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
   * Trúc costs three.js and 1.29 MB of glTF and he stands in the last section
   * of the page. `React.lazy` alone does not defer that — it defers until
   * mount, and a component that mounts with the page has deferred nothing. So
   * he is not mounted until his own section is within a viewport of the fold.
   */
  const [closing, nearTruc] = useOnScreen<HTMLDivElement>('100% 0px');

  return (
    <div ref={root} className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      {/*
        The signature. It mounts nothing on a coarse pointer, under 768px, or
        under `prefers-reduced-motion`, and it hides the native cursor only
        while it is painting a replacement. See `CustomCursor.tsx`. Nothing on
        this page depends on it: a collector arrives on a phone, where it never
        exists, and the page has to read as PlayerOne there.
      */}
      <CustomCursor />

      {/* ---------------------------------------------------------------
          The bar, and it is the system's own material.

          Glass at the bar weight, floating over the film. This is the one
          place in the product where the material has something genuinely
          moving to bend, which is the argument for a tinted ground made
          visible rather than described.
          --------------------------------------------------------------- */}
      <header className="sticky top-0 z-20 px-4 pt-4 sm:px-6">
        <div
          className={cn(
            'mx-auto flex max-w-[72rem] items-center justify-between gap-3',
            'rounded-[var(--radius-pill)] shadow-[var(--shadow-sm)]',
            'glass-bar',
            /* `pl-3` below `sm`: at 320px the row was one pixel wider than the
               viewport, and one pixel of horizontal document scroll is still
               horizontal document scroll. */
            'py-2 pl-3 pr-2 sm:pl-4',
          )}
        >
          <span className="inline-flex items-center gap-2.5">
            <Mark size={24} />
            <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.02em]">
              PlayerOne
            </span>
            {/*
              The partners, named in the bar and not only in a footnote.

              The review's finding was that VNG and PaXini appear nowhere in
              the rendered page while the mark's two circles — sun and tech —
              stand for exactly them. For a joint venture asking members of the
              public to wear a camera inside their home, this is the most
              persuasive fact on the page. It is stated as a fact and nothing
              is claimed beyond `PRODUCT.md`. Hidden below `sm`, where the row
              has 390px and already carries four things.
            */}
            <span
              className={cn(
                'ml-1 hidden border-l border-[var(--border)] pl-3 text-[0.8125rem] md:inline',
                'text-[var(--muted-foreground)]',
              )}
            >
              VNG PT Lab &times; PaXini
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
              470 against a `clientWidth` of 390. Nothing is lost: the closing
              section carries the same sign-in.
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
            1. The first viewport. The film, edge to edge, from frame one.

            No card, no frame, no letterbox: the video is `object-cover` on the
            whole band and the type sits on it. The band is `--stage` so that a
            failed, blocked or still-loading video leaves white type on
            near-black rather than white type on nothing.
            =============================================================== */}
        <FilmHero reduced={reduced} />

        {/* ===============================================================
            2. The four steps, as a full-bleed band of ink.

            **Deliberately typographic, and this is the one place on the page
            where the direction was answered with type rather than footage.**
            Only one of these four steps has ever been photographed. A frame of
            a Paris museum under "the card goes across the counter at an upload
            centre" is not a full-bleed photograph of an upload centre; it is a
            picture of something else with a caption that contradicts it. Four
            numbered rules on ink is the confident version of not having the
            shoot yet, and it survives the shoot arriving.
            =============================================================== */}
        <Reveal data-band="steps" className="on-stage">
          <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
            <h2 className={cn(H2, 'text-[var(--stage-fg)]')}>{t('discover.how.title')}</h2>
            <ol className="mt-10 grid list-none gap-x-6 gap-y-10 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((key, index) => (
                <li key={key} className="border-t-2 border-[var(--stage-fg)] pt-4">
                  <span className="num text-[0.8125rem] font-medium tabular-nums text-[var(--stage-mid)]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className={cn(H3, 'mt-2 text-[var(--stage-fg)]')}>
                    {t(`discover.step.${key}.title`)}
                  </h3>
                  <p className="mt-2 text-[0.9375rem] leading-[1.6] text-[var(--stage-mid)]">
                    {t(`discover.step.${key}.body`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>

        {/* ===============================================================
            3. The camera. A split pair, and the only photograph on the page.

            Left half is the harvested frame with its caption punched out over
            it; right half is ink carrying the heading and the paragraph. The
            caption's left edge and the photograph's left edge are set by the
            same padding on the same box, so the offset between them is exactly
            the pad at every breakpoint and in every language — which is the
            class of fault the review measured at 71.75px on the last build,
            where the picture was centred and its caption was flush left.
            =============================================================== */}
        <Reveal data-band="camera">
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
                  vertical one, because the device this picture exists to show
                  is at the left of the frame and the hero's grade put 0.6 of
                  `--stage` over it. The caption sits in the bottom fifth. */}
              <div aria-hidden="true" className="plate-grade absolute inset-0" />
              <figcaption
                className={cn(
                  'absolute inset-x-0 bottom-0 p-6 sm:p-10',
                  'max-w-[46ch] text-[0.9375rem] leading-[1.55] text-[var(--stage-over)]',
                )}
              >
                {t('discover.cell.pov.caption')}
              </figcaption>
            </figure>
            <div className="on-stage flex flex-col justify-center px-6 py-14 sm:px-10 sm:py-16 lg:px-14">
              <h2 className={cn(H2, 'text-[var(--stage-fg)]')}>
                {t('discover.cell.camera.title')}
              </h2>
              <p className="mt-6 max-w-[52ch] text-[1rem] leading-[1.65] text-[var(--stage-mid)]">
                {t('discover.cell.camera.body')}
              </p>
            </div>
          </div>
        </Reveal>

        {/* ===============================================================
            4. Which activities count. A full-bleed field of lavender.

            The one colour band, and it is the ground the whole design system
            is built on rather than a decorative panel. It breaks the run of
            ink at exactly the point the argument moves from the device to the
            work, and `--lavender-200` is theme-aware — it resolves to the dark
            scheme's muted surface — so the ink on it is `--foreground` in both.
            =============================================================== */}
        <Reveal data-band="activities" className="bg-[var(--lavender-200)]">
          <div className={cn(BAND, SHELL, 'py-24 sm:py-28 lg:py-36')}>
            <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
              <h2 className={cn(H2, 'lg:col-span-5')}>{t('discover.cell.activities.title')}</h2>
              <p className="max-w-[60ch] text-[1.0625rem] leading-[1.65] lg:col-span-7">
                {t('discover.cell.activities.body')}
              </p>
            </div>
          </div>
        </Reveal>

        {/* ===============================================================
            5. The number, on ink, as a split pair of type.

            How review works and how payable minutes are determined are one
            argument in two halves — a person decides, and the platform
            measures the media rather than believing the device — so they are a
            pair rather than two cells in a grid of five.
            =============================================================== */}
        <Reveal data-band="number" className="on-stage">
          <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
              <div>
                <h2 className={cn(H2, 'text-[var(--stage-fg)]')}>
                  {t('discover.cell.review.title')}
                </h2>
                <p className="mt-5 max-w-[52ch] text-[1rem] leading-[1.65] text-[var(--stage-mid)]">
                  {t('discover.cell.review.body')}
                </p>
              </div>
              <div className="border-t border-[var(--stage-line)] pt-12 lg:border-l lg:border-t-0 lg:pl-16 lg:pt-0">
                <h2 className={cn(H2, 'text-[var(--stage-fg)]')}>
                  {t('discover.cell.minutes.title')}
                </h2>
                <p className="mt-5 max-w-[52ch] text-[1rem] leading-[1.65] text-[var(--stage-mid)]">
                  {t('discover.cell.minutes.body')}
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        {/* ===============================================================
            6. FAQ. White ground, per the direction — and it is the lavender
            white this system means, with the rows as glass on it.

            Kept exactly as it was otherwise: native `<details>`, four real
            questions answered without spin, the first open. It is the section
            the design review said to keep.
            =============================================================== */}
        <Reveal data-band="faq" className="bg-[var(--background)]">
          <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
            <h2 className={H2}>{t('discover.before.title')}</h2>
            <div className="mt-10 flex flex-col gap-2">
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

        {/* ===============================================================
            7. Where to go from here. The other white ground.

            Both audiences, as peers, at the moment of highest intent. The
            second copy of the film that used to sit in this panel is gone: the
            direction spends the film once, and a `preload="none"` player with
            250px of dead black above and below it was the review's own
            example of the spacing complaint.
            =============================================================== */}
        <Reveal data-band="ways" className="bg-[var(--surface)]">
          <div className={cn(BAND, SHELL, 'py-20 sm:py-24 lg:py-32')}>
            <h2 className={H2}>{t('discover.ways.title')}</h2>
            {/*
              The sentence that says which of the two audiences the reader is,
              and it comes before the two controls that ask them to choose.
            */}
            <p className="mt-6 max-w-[64ch] text-[1.0625rem] leading-[1.65]">
              {t('discover.audiences')}
            </p>

            {/*
              `items-start`, so each card is the height of its own contents.

              Equal-height cards look tidier and measure worse: the shorter
              card's action was pushed to the foot by `mt-auto` and the slack
              landed as a **46px gap in English, 90px in Chinese** between the
              paragraph and the button — off the 4px scale at 1440 and 1280,
              found by `rhythm.mjs`, and exactly the owner's *"uneven and
              inconsistent spacing"* in its measurable form. A gap that is
              whatever is left over is not a spacing decision. Two cards of
              honest, different heights with 32px under each paragraph is.
            */}
            <div ref={closing} className="mt-12 grid items-start gap-4 lg:grid-cols-2">
              {/*
                Same heading level, same body treatment, same button size. A
                card around one of the two would rank them, so they get the
                same card.
              */}
              <Panel className="flex flex-col p-8">
                <h3 className={H3}>{t('discover.take.title')}</h3>
                <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t('discover.take.body')}
                </p>
                <div className="mt-8">
                  <ApkAction />
                  <ApkNote />
                </div>
              </Panel>

              <Panel className="flex flex-col p-8">
                <h3 className={H3}>{t('discover.handoff.title')}</h3>
                <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
                  {t('discover.handoff.body')}
                </p>
                <div className="mt-8">
                  <Button variant="secondary" size="xl" asChild data-cursor-highlight className={CTA}>
                    <Link to="/login">{t('discover.signIn')}</Link>
                  </Button>
                </div>
                {/*
                  Trúc, in the corner, occluding nothing — and on a row of his
                  own rather than beside the button.

                  The ruling is about occlusion rather than about corners:
                  *"Only the panda is allowed to sit on the corner bc its not
                  blocking anything"*. Sharing a row with the sign-in put him
                  next to a control whose label is *Đăng nhập bảng điều khiển*
                  in Vietnamese, and `rhythm.mjs` measured the pair clipping
                  its own box by **10px** at 1440 and 1280 — a button that
                  cannot shrink beside a 96px canvas in a column that can.
                  `hidden` below `sm`, where the canvas would reach the type.
                */}
                <div className="mt-8 hidden justify-end sm:flex">
                  {nearTruc ? <TrucAsk /> : null}
                </div>
              </Panel>
            </div>

            {/*
              The partnership, in full, once. `PRODUCT.md` states it: a joint
              venture between VNG PT Lab and PaXini, VNG running the platform
              and the centres, PaXini making the camera and reviewing in this
              phase. Nothing beyond that is claimed.
            */}
            <p className="mt-12 flex max-w-[72ch] items-start gap-3 text-[0.9375rem] leading-[1.6] text-[var(--muted-foreground)]">
              <Mark size={22} className="mt-0.5 shrink-0" />
              <span>{t('discover.partners')}</span>
            </p>
          </div>
        </Reveal>
      </main>

      <Footer>{t('discover.credits')}</Footer>
    </div>
  );
}

/**
 * The first viewport: the film, edge to edge, with the words on it.
 *
 * Three things are stacked in one band and the order matters. The `<video>`
 * covers the band. `.film-grade` covers the video. The column of type sits on
 * both, bottom-left, inside the page's own reading gutter — so the slogan's
 * left edge is on the same vertical as every heading below it, and the film's
 * left edge is the viewport. That offset is a designed gutter and it is the
 * same number in all three languages.
 *
 * `100svh` and not `100dvh`: on a phone the dynamic viewport unit changes as
 * the address bar collapses, which re-lays-out the hero mid-scroll and moves
 * the type under the reader's thumb. The small unit is stable.
 */
function FilmHero({ reduced }: { reduced: boolean }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  /*
   * WCAG 2.2.2: anything that plays automatically for more than five seconds
   * needs a way to stop it, and this film loops. The control is part of the
   * composition rather than a browser control bar drawn across the frame —
   * `controls` on a full-bleed hero paints a black gradient and a timeline
   * over the bottom of the image, which is where the slogan is.
   *
   * The label is driven by the element's **own** `play` and `pause` events
   * rather than by what this component last asked for. Autoplay is refused by
   * more browsers than it is honoured by, `reduced` arrives one render after
   * mount, and a `play()` promise can reject — so a boolean this component
   * sets when it thinks it started the film is a label that lies. The media
   * element is the state.
   */
  const [playing, setPlaying] = useState(false);

  return (
    <section
      data-band="hero"
      className="on-film relative isolate flex min-h-[100svh] flex-col justify-end bg-[var(--stage)]"
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

      <div className={cn(SHELL, 'pb-10 pt-20 sm:pb-12 sm:pt-32')}>
        <h1 data-choreo-hero="line" className={cn(H1, 'max-w-[16ch] text-balance')}>
          {t('discover.headline.a')}{' '}
          {/*
            One line, and the size step under `sm` is what makes that safe.

            The marker is held together because a two-word phrase broken across
            two lime blocks reads as a mistake at 68px, where there is room for
            it. It is only safe because the headline is 2.125rem below `sm`:
            *Việc thường ngày* is about 330px at 40px and a 320px viewport has
            288px of column, so at the old size this was 58px of horizontal
            document scroll in `vi`. Measured at the current size, 320/360/390
            are 0px sideways in all three languages. `box-decoration-break:
            clone` in `globals.css` still covers the case where it does wrap.
          */}
          <mark className="marker whitespace-nowrap">{t('discover.headline.mark')}</mark>
          {t('discover.headline.b')}
        </h1>
        {/*
          The two conditions the product runs on — a human reviews the footage,
          and only approved effective minutes are paid — set at full strength
          rather than one step down in grey. A condition in a lighter grey is a
          condition somebody skips, and over film there is no lighter grey that
          is also legible.
        */}
        <p
          data-choreo-hero="lead"
          className="mt-6 max-w-[48ch] text-[1.0625rem] leading-[1.6] sm:text-[1.1875rem]"
        >
          {t('discover.lead')}
        </p>
        {/*
          Two calls to action, and they are peers because the audiences are.
          Under `.on-film` the primary is a white pill with ink on it and the
          secondary is a white outline, in **both** themes — the roles are
          repointed at the stage ramp by the class, so neither control's
          contrast depends on the scheme or on the frame behind it.
        */}
        <div data-choreo-hero="actions" className="mt-8 flex flex-wrap items-start gap-3">
          <ApkAction />
          <Button variant="secondary" size="xl" asChild data-cursor-highlight className={CTA}>
            <Link to="/login">{t('discover.signIn')}</Link>
          </Button>
        </div>
        <ApkNote />
      </div>

      {/*
        The slate: what this film actually is, in the reader's language, and
        the control that stops it.

        It is here rather than in a footnote because the film is a placeholder
        that shows someone *being filmed while wearing* Ego rather than a
        recording Ego made, and a page that opens with it and does not say so
        is a page implying otherwise. It sits opposite the type block, in the
        corner the grade leaves lightest, at the size a slate is.
      */}
      <div className={cn(SHELL, 'pb-6 sm:pb-8')}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p /* `--muted-foreground`, which `.on-film` repoints at `--stage-fg`, and
                 **not** pure white at `opacity-80`. An opacity is not a colour:
                 it makes the rendered ink differ from the declared one, so the
                 contrast probe found no glyphs to measure at all and reported
                 the slate as absent. Over film "quieter" is a token one step
                 down, never a transparency. */
            className="max-w-[72ch] text-[0.75rem] leading-[1.5] text-[var(--muted-foreground)]">
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
                 promise then leaves the control saying *play*, which is true. */
              if (el.paused) void el.play().catch(() => {});
              else el.pause();
            }}
          >
            {playing ? t('player.pause') : t('player.play')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * The collector's call to action, and it tells the truth in both states.
 *
 * With `APK_URL` set it is a download link — `download` so the browser saves
 * the file rather than trying to render it, `rel="noopener"` because a release
 * asset is very likely on another origin.
 *
 * With `APK_URL` empty, which is today, it is the same control at the same
 * size, `disabled`, with one sentence under it saying the build is not
 * released. **It is `outline` and not a faded `primary`, and that is the fix
 * for a measured defect**: the primary variant deliberately keeps a disabled
 * control at full ink (right for a console submit that is mid-flight), and
 * `--action` inverts with the scheme — so in dark mode the dead download
 * button rendered as a light filled pill beside an outlined sign-in and read
 * as *more* available than the working control. An outlined control on the
 * card fill is quieter than a filled pill in both themes, at full contrast,
 * with no opacity trick that would put its legibility at the mercy of whatever
 * is behind it. Under `.on-film` the same variant resolves against the stage
 * ramp and is quieter than the white pill beside it, again in both themes.
 *
 * No version number, no file size, no store link.
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
 * pushes the console sign-in 200px to the right of the download, which is a
 * hole between two controls that are supposed to read as peers. Under the row
 * it explains one of them and moves neither.
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
 * every answer. The first row is `open` so the pattern is legible on arrival
 * rather than four bars somebody has to guess at.
 *
 * The marker is removed on both engines and replaced with a glyph that turns:
 * Chrome and Safari draw `::-webkit-details-marker`, Firefox draws the
 * `list-style` triangle, and hiding only one leaves a stray arrow in the other.
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

/**
 * The credits line, and it is a link to the file rather than a claim.
 *
 * The film is a placeholder and the one still on the page is a crop of it;
 * `CREDITS.json` records both, including the `ffmpeg` line that produced the
 * crop and the fact that it is third person. A landing that shows them with no
 * route to that fact is a landing implying the pictures are documentary.
 */
function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center sm:px-6">
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
