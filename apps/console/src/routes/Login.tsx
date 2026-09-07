/**
 * Sign in, and the one place in this console that has to persuade before it
 * can operate.
 *
 * Two credentials, because every mutation in this service carries two: a
 * machine token proving *where* and an operator token proving *who* (PRD
 * §8.3.2 rule 1). The form says so rather than presenting four boxes and
 * letting an operator guess why their username is split in half.
 *
 * PLT-10 is the other half of this screen. PaXini's reviewers are in Shenzhen
 * and are not standing at a VNG counter, so choosing "Reviewer" drops the
 * machine fieldset entirely — there is no machine — and the session the server
 * issues reaches the review lane and nothing else. The choice is a real
 * `<fieldset>` of radios rather than two tabs or two pages: two options
 * visible at once, working before any script has run, announced as one
 * question.
 *
 * **The composition.** A hard vertical seam, not a centred card on a grey
 * field. Left is the demo film, full bleed, under one flat ink scrim; the mark
 * and three short slogans sit at the top of it and Trúc stands at the bottom,
 * centred in that column and fully inside it. Right is paper and carries the
 * form, over an ambient bamboo-and-sun ground below the split — the one
 * decorative use of a brand ramp anywhere in this console, granted by name in
 * `DESIGN.md` and pinned by a contrast test.
 *
 * He used to straddle the seam at 240px, which cut the mascot in half and drew
 * the other half over the first field. Centred and larger, the cursor tracking
 * he has always done is finally visible: at 240px on a 720px column the turn of
 * his head was a few pixels and read as a still image.
 *
 * **The film plays first, and it is the only thing on this screen that moves
 * by itself.** Muted, looped, `playsInline`, poster first — so the panel is a
 * picture of the product before a single frame has decoded, and stays one if
 * the file is missing. Under `prefers-reduced-motion` it does not start: it
 * becomes a poster with a control on it, which is the same content without the
 * movement.
 *
 * **The scrim is flat and measured, not a fade.** `--stage` at 60%: over the
 * worst pixel a video can contain — pure white — the composite is
 * `rgb(112,113,115)`, and white type on it measures **4.90:1**, so the slogans
 * clear the body-text floor whatever the film is showing at that moment. A
 * gradient would clear it in one half of the panel and fail in the other, and
 * this world has no gradients in it anyway. The type is pure white rather than
 * `--stage-fg`, which on the same composite is 4.22:1 and would not.
 *
 * **The submit, the refusal and both policy links are on screen at first paint,
 * at every viewport and in all three languages — and nothing is behind them.**
 *
 * That took three attempts and the first two were wrong in ways worth keeping
 * written down, because both of them measured something and both measurements
 * were true.
 *
 * The bar was `sticky` below `lg` only, and the desktop column had no overflow
 * — so at 1280×720 and 1024×640 the button was simply drawn past the bottom of
 * a box with nothing to scroll. Fixed by giving the column its own overflow and
 * the bar every width. Measured across ten viewport-and-language combinations,
 * all reachable.
 *
 * That measurement asked the wrong question. It tabbed to the last field before
 * measuring, which scrolls it into view — so it proved every control could be
 * *reached*, and said nothing about what a person sees when the page has just
 * loaded and they have not touched it. A design critique measured at first
 * paint and found the sticky bar drawn over `external_ref` and `operator_secret`
 * at 1280×720, over `machine_secret` and `external_ref` at 1024×640 with
 * `operator_secret` off the bottom, and over `operator_secret` at 390×844. A
 * sticky bar is *over* the content by construction; that is what sticky means.
 *
 * So the bar is not sticky. The column is a fixed-height flex box of three
 * rows — a header strip, the fields, and the bar — the middle row scrolls, and
 * the bar is a sibling that nothing can pass under. The button lives outside
 * the `<form>` and is bound to it with `form="signin"`.
 *
 * Now measured by hit-testing rather than by rectangle arithmetic, which is the
 * third thing that was wrong: a field clipped by a scroll container still has a
 * bounding box that overlaps whatever is below it, so the rectangle check
 * reported fields as covered that were merely scrolled. `elementFromPoint`
 * answers the question a person actually has. Eight viewports × three
 * languages, 1440×900 down to a 390×667 phone: submit visible and hit-testable,
 * both policy links visible and hit-testable, the last field reachable, no
 * horizontal overflow.
 *
 * Everything GSAP does here is layered on top of a page that is already
 * finished, and under `prefers-reduced-motion` no timeline is built at all —
 * all three slogans are simply on screen, which is their default with no
 * script running.
 *
 * **GSAP is imported dynamically**, inside the effect. `router.tsx` imports
 * every route eagerly, so a static `import 'gsap'` would put the tween engine
 * in the chunk `/review` loads — the same argument that keeps three.js behind
 * `React.lazy`.
 */
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import type { PandaMood } from '../components/identity/PandaStage.tsx';
import { Button } from '../components/ui/button.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { cn } from '../lib/cn.ts';

const PandaStage = lazy(() =>
  import('../components/identity/PandaStage.tsx').then((m) => ({ default: m.PandaStage })),
);

type Failure = 'credentials' | 'mismatch' | 'network' | 'sign_in_rate_limited' | null;

/**
 * The film.
 *
 * `apps/console/public/landing.mp4` (12.96s, 1280×720, 1.39 MB) ships with the
 * console,
 * so the default is the real file and the screen is complete with no
 * environment set. `VITE_LANDING_VIDEO_URL` stays as the seam a deployment
 * uses to point at a longer cut or a CDN copy without a rebuild of this file.
 *
 * **The end card came off.** The 15.83s cut finished on its own outro — a
 * second PlayerOne wordmark, a second brand mark, "VNG × PaXini" — and this
 * panel `loop`s, so every sixteen seconds the left half of the sign-in became
 * a title card carrying the product's name directly opposite the 56px `h1` of
 * the same word, with Trúc's head over the partner's. That is precisely the
 * duplication the note about the mark below congratulates itself for avoiding.
 * The cut now ends at 12.95s on the last clean frame of the planting beat.
 *
 * Re-encoded while it was open, at CRF 26 rather than the original's quality:
 * 2.33 MB to 1.39 MB, on a panel that is never seen except under a 60% ink
 * scrim, which is 40% off the largest thing this screen fetches.
 */
const VIDEO_URL: string =
  typeof import.meta.env.VITE_LANDING_VIDEO_URL === 'string' &&
  import.meta.env.VITE_LANDING_VIDEO_URL !== ''
    ? import.meta.env.VITE_LANDING_VIDEO_URL
    : '/landing.mp4';

const POSTER_URL = '/landing-poster.jpg';

/**
 * The scrim, as one value used twice — once here in the class and once in the
 * ratio quoted at the top of this file. `color-mix` with `transparent` gives
 * `--stage` at exactly this alpha and leaves the hue alone, which is what
 * makes the measurement above reproducible from the token rather than from a
 * literal somebody tuned by eye.
 */
const SCRIM = 'bg-[color-mix(in_srgb,var(--stage)_60%,transparent)]';

/**
 * How big Trúc's canvas is, and why the number is so much larger than he looks.
 *
 * He used to be 240px pinned to the bottom-right corner and translated half his
 * width off it, so the seam cut him down the middle and half the mascot was
 * drawn over the form. He is centred in the film column now.
 *
 * The box is not the panda. `PandaStage` normalises any model into a two-unit
 * box and the camera sits at z=6.4 with a 34° field, which makes the visible
 * plane about 3.9 units tall — so a panda whose widest dimension is his arms
 * fills roughly 40% of the square he is given. 520px of canvas is therefore
 * about 210px of drawn panda, which on a 720px column is a character rather
 * than an icon. Raising this number was the cheap knob; the alternative was a
 * second camera distance, and the camera is shared with the coach mark and the
 * shift gauge, where the framing is already right.
 *
 * `lg` and up only, and `overflow-hidden` on the wrapper. Below the split the
 * film is a 30svh band, and a figure standing in a band that short lands on
 * the face of whoever the film is showing — measured at 962×961, where he sat
 * squarely on the collector's cheek. A band is a header, not a stage.
 */
const PANDA = 520;

/** Whether the operator has asked the machine to stop moving things. */
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

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'operator' | 'reviewer'>('operator');
  const [mood, setMood] = useState<PandaMood>('idle');
  const reviewer = role === 'reviewer';
  const reduced = useReducedMotion();

  const root = useRef<HTMLDivElement>(null);
  const film = useRef<HTMLDivElement>(null);
  const slogans = useRef<HTMLUListElement>(null);

  /**
   * The one authored motion on this screen.
   *
   * `gsap.matchMedia` rather than a `window.innerWidth` branch: it registers
   * the timeline against a media query, reverts it when the window is resized
   * out of range, and — the reason it is here — takes `prefers-reduced-motion`
   * as part of the same query, so under reduced motion the timeline is never
   * built and there is nothing to "collapse to a shorter duration". A still
   * page, not a fast one.
   *
   * Desktop only, and desktop is the only viewport with anything to scrub
   * against: the film column is two and a bit screens tall with the panel
   * pinned inside it, so the scroll is the film's, never the form's. The
   * slogans rise through it, staggered so the three beats spread apart rather
   * than sliding as one block; the film itself drifts a little less, which is
   * the whole of the parallax. Nothing fades to nothing — every slogan is
   * readable at every scroll position, because a sentence that is only legible
   * mid-scroll is a sentence nobody reads.
   */
  useEffect(() => {
    if (reduced) return;
    let context: { revert: () => void } | null = null;
    let live = true;

    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (!live) return;
      gsap.registerPlugin(ScrollTrigger);

      const media = gsap.matchMedia();

      media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        const trigger = root.current;
        const items = slogans.current?.children;
        if (trigger === null || !items) return;

        gsap.to(items, {
          yPercent: -55,
          ease: 'none',
          stagger: 0.35,
          scrollTrigger: { trigger, start: 'top top', end: 'bottom bottom', scrub: 0.4 },
        });

        if (film.current) {
          gsap.to(film.current, {
            yPercent: -4,
            ease: 'none',
            scrollTrigger: { trigger, start: 'top top', end: 'bottom bottom', scrub: 0.4 },
          });
        }
      });

      context = media;
    })();

    return () => {
      live = false;
      context?.revert();
    };
  }, [reduced]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMood('happy');
    setFailure(null);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      if (res.ok) {
        // Where the session can actually go. A reviewer is scoped to the review
        // lane server-side, so the home screen would be a page of 403s.
        const body = (await res.json().catch(() => ({}))) as { role?: string };
        void navigate({ to: body.role === 'reviewer' ? '/review' : '/' });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      // SEC-03: a 429 is a refusal with a name, and the person gets the
      // sentence that says the wait ends by itself — not "wrong password",
      // which is what they would otherwise read after typing a right one.
      setFailure(
        body.reason === 'mismatch' || body.reason === 'sign_in_rate_limited'
          ? body.reason
          : 'credentials',
      );
      setMood('idle');
    } catch {
      /* The LAN dropped, or the API is not running. Say which is possible. */
      setFailure('network');
      setMood('idle');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="relative min-h-dvh bg-[var(--background)] lg:grid lg:grid-cols-2">
      {/* ---------------------------------------------------------------
          The film half.

          Two and a bit screens tall at `lg`, with the panel pinned inside it:
          that is where the scroll the slogans ride on comes from, and it is
          why the form column opposite can be pinned too. Below `lg` the same
          markup is a 16:9 band at the top of an ordinary page.

          Under reduced motion the extra height goes away with the timeline
          that used it. Nothing would move through those two screens, so
          keeping them would be asking somebody who has said "stop moving
          things" to scroll past a still picture to reach the bottom of a page
          that has nothing at the bottom.
          --------------------------------------------------------------- */}
      <div className={reduced ? undefined : 'lg:h-[220vh]'}>
        {/*
          The band's height, and the one measurement that made this screen
          look broken.

          `aspect-video` alone means the band is 9/16 of the *window* width
          until the split arrives at `lg`. On a 962×961 tablet that is 540px —
          56% of the viewport — so the form underneath was crushed into the
          remaining 421px and the sticky submit floated over the machine-secret
          field. The button was not the fault; the band was. From `md` it is a
          fraction of the *height* instead, which is the dimension the form is
          actually competing for: 288px of that same 961px viewport, leaving
          673px for a form that needs about 600.

          `svh` and not `vh`, because on a phone-shaped tablet in portrait
          `vh` is the height with the browser chrome retracted, and a band
          measured against it grows when the chrome slides away mid-scroll.
        */}
        <div className="on-stage relative aspect-video md:aspect-auto md:h-[30svh] lg:sticky lg:top-0 lg:h-dvh">
          {/*
            The clip box is here and not on the panel, so that Trúc can stand
            ON the seam rather than be cut in half by it. It is 12% taller than
            the panel because the parallax lifts the film 4% of its own height
            and a clip box the exact size of the panel would show the ink under
            it as a band along the bottom edge.
          */}
          <div className="absolute inset-0 overflow-hidden">
            {/*
              The extra 6% exists so the parallax has somewhere to lift the
              film from without showing the ink underneath. Under reduced
              motion there is no parallax, and the overhang put the video's own
              control bar below the clip box where it was cut off entirely — so
              the "poster with a control on it" this file promises had no
              control a pointer could reach. Measured: `elementFromPoint` on
              the play button returned `null` at 1440×900 and the slogan column
              at 390×844.
            */}
            <div
              ref={film}
              className={cn('absolute inset-x-0', reduced ? 'inset-y-0' : '-inset-y-[6%]')}
            >
              <video
                src={VIDEO_URL}
                poster={POSTER_URL}
                muted
                loop
                playsInline
                preload="metadata"
              /* Under reduced motion nothing plays by itself; it becomes a
                 video the reader can start, which is the same content without
                 the movement. */
                autoPlay={!reduced}
                controls={reduced}
                aria-label={t('login.video.region')}
                className="h-full w-full object-cover"
              />
            </div>
          </div>

          {/* The flat scrim. One value, measured; see the note at the top. */}
          <div className={cn('pointer-events-none absolute inset-0', SCRIM)} aria-hidden="true" />

          {/*
            `pointer-events-none` on the whole column, because nothing in it is
            a control — a logo and three sentences — and it is `h-full`, so it
            covered the film underneath. Under reduced motion the film shows
            the browser's own controls and every press on the play button and
            the timeline landed on this div instead: hit-testing returned it,
            and a real click left the video paused at zero. The list carried
            the rule for one revision, which fixed nothing, because the list is
            not what the pointer was hitting.

            Below `md` the mark is at the top and the slogans at the bottom,
            which is the whole band. From `md` up they close together at the
            top and the bottom of the band belongs to Trúc — one list, one
            ref, one place in the reading order, and the composition changes
            by moving the justification rather than by rendering the sentences
            twice.
          */}
          <div className="pointer-events-none relative flex h-full flex-col justify-between p-5 sm:p-8 md:justify-start md:gap-6 lg:gap-10 lg:p-14">
            {/*
              The mark, and not the mark plus the word. The word is the `h1` on
              the other half of the seam, and a wordmark 200px from a 3.5rem
              heading of the same word is the name twice.
            */}
            {/*
              The mark in its own two colours, not the one-colour lockup. On
              ink the monochrome version is right; on a photograph two white
              circles of different opacity read as a UI toggle rather than as
              a logo. Sun and tech on the scrim are unmistakably the mark.
            */}
            <Mark size={30} />

            {/*
              Three beats, one line each. Pure white on the measured scrim, in
              the display weight — the only place in the console where type is
              set over a picture, and the reason the scrim exists at all.
            */}
            <ul
              ref={slogans}
              className="m-0 flex list-none flex-col gap-0.5 p-0 text-white lg:gap-2"
            >
              {['login.slogan.1', 'login.slogan.2', 'login.slogan.3'].map((key) => (
                <li
                  key={key}
                  className="text-[1.0625rem] font-bold leading-tight tracking-[-0.02em] sm:text-[1.375rem] lg:text-[2.5rem] lg:font-extrabold lg:tracking-[-0.035em]"
                >
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>

          {/*
            Trúc, standing on the seam.

            `pointer-events` are off inside `PandaStage`, so he never takes a
            click away from the field behind him. He is the mascot and not a
            control, so he carries no label and is hidden from the
            accessibility tree; the flat `Panda` holds his place while the
            three.js chunk arrives, at the same size and in the same spot, so
            nothing shifts when it does. He lives inside the pinned panel
            rather than on the page, so he stays on the seam for the whole
            scroll instead of leaving with the first screen.
          */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden justify-center overflow-hidden lg:flex">
            <Suspense fallback={<Panda size={PANDA} />}>
              <PandaStage mood={mood} size={PANDA} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------
          The paper half. The form is the first thing here and it is reachable
          without scrolling at every viewport.
          --------------------------------------------------------------- */}
      {/*
        `lg:overflow-y-auto` is the second half of the fix, and it is the half
        that matters on a laptop.

        The form column is pinned to the viewport at `lg` and is exactly one
        `dvh` tall. Four fields, a role pill, a heading, a sentence, a 56px
        button and a legal line do not fit in 720px of that — the height half
        the laptops in an upload centre have — and with no overflow set the
        column simply drew its own content past its bottom edge, off screen,
        with nothing to scroll. Measured before it was changed: at 1280×720 and
        at 1024×640, in English and in Vietnamese, the submit and the legal line
        were both below the fold and unreachable. That is Daniel's report, and
        it was never only the tablet band.

        With the column scrolling in its own right, the sticky submit below has
        something to stick to and the guarantee becomes the same one at every
        width: the button a person came for is on screen from the first paint.
        It overflows at every `lg` height, including 1440×900 — by 35px there,
        215px at 1280×720 — which is the point: the content is genuinely taller
        than the column and used to be drawn off the end of it. An earlier
        version of this comment claimed 1440×900 fitted. It does not, and the
        35px is the legal line.
      */}
      {/* ---------------------------------------------------------------
          The paper half, and the reason it is a fixed-height flex column
          rather than an ordinary block.

          The submit used to be `position: sticky` inside the form, which puts
          it *over* the fields rather than after them. That satisfies "the
          button is always visible" and quietly breaks something worse: at
          first paint, with nobody having scrolled, the bar covered
          `external_ref` and `operator_secret` at 1280×720, covered
          `machine_secret` and `external_ref` at 1024×640 and pushed
          `operator_secret` off the bottom entirely, and covered
          `operator_secret` at 390×844. An operator at a counter sees a role
          pill, part of one field and a large orange button, fills what they
          can see and is refused.

          I measured this wrong the first time and said so in the commit. My
          check tabbed to the last field before measuring, which scrolls it
          into view — so it answered "can this be reached", which was true,
          and not "is this visible at rest", which was not. A design critique
          measured at first paint and found three viewports.

          So the column is exactly the height of what is left of the viewport
          after the film band, it is a flex column, the fields scroll inside
          the middle row, and the bar is an ordinary static row underneath
          them. Nothing is ever behind it. `56.25vw` is the band's own height
          below `md`, where it is `aspect-video` of the full width; `min-h` is
          the guard for a short landscape phone, where the document is allowed
          to scroll rather than crush the form into nothing.
          --------------------------------------------------------------- */}
      <main className="relative isolate flex h-[calc(100dvh-56.25vw)] min-h-[22rem] flex-col px-5 pb-0 pt-2 sm:px-10 md:h-[70svh] lg:sticky lg:top-0 lg:h-dvh lg:min-h-0 lg:self-start lg:px-14 lg:py-6">
        {/* ---------------------------------------------------------------
            The ground the form sits on, below the split.

            Two soft fields of colour, blurred past the point where either has
            an edge. `DESIGN.md` bans a gradient on the *inks* — the three
            verdicts and the two brand ramps are flat wherever they carry
            meaning, and nothing here carries meaning. This is light in the
            room, not a colour with a job: `bamboo-50` and `sun-50`, the palest
            step either ramp has, under a 64px blur. Both are steps that invert
            with the scheme, which is the safety property and not a preference
            — the fixed steps above 100 are pale tints, and a pale tint over a
            near-black page is a disc, not a ground.

            It exists below `lg` only. Above it the film is the atmosphere and
            a second one would be two.

            Measured, because a wash under type is the easy way to lose a
            contrast floor. Measured on rendered pixels rather than asserted:
            `--foreground` over the worst composite reads 16.7:1 light and
            14.2:1 dark, and `--muted-foreground` — which carries the field
            labels — reads 5.21:1 light and 6.76:1 dark. The wash costs that
            ink 0.17 of a ratio in light. An earlier version of this comment
            said "over 6:1" for both schemes, which was true of dark and wrong
            about light. `packages/design/test/contrast.test.ts` pins all four.
            --------------------------------------------------------------- */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden lg:hidden"
        >
          <div className="absolute -left-[15%] -top-[10%] h-[70vw] w-[85vw] rounded-full bg-[var(--bamboo-50)] opacity-60 blur-[64px]" />
          <div className="absolute -right-[20%] top-[26%] h-[60vw] w-[75vw] rounded-full bg-[var(--sun-50)] opacity-50 blur-[64px]" />
        </div>

        <div className="flex items-center justify-end gap-1">
          <LocaleSwitch />
          <ThemeSwitch />
        </div>

        {/*
          Two boxes, and the inner one is the reason.

          A `justify-center` flex box whose content is taller than it centres
          the overflow, which means it clips *both* ends and the top end cannot
          be scrolled to — measured on a 390px phone, where the heading "Sign in
          to the upload centre" was sliced through the middle by the row above
          it and no amount of scrolling brought it back. The scroller must not
          be the thing doing the centring.

          So the outer box scrolls and the inner one is `min-h-full` with the
          centring on it: shorter than the box, it centres; taller, it grows,
          and every pixel of it is reachable.
        */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[27rem] flex-col justify-center lg:py-8">
          {/*
            The name, once, at a size that means it. Be Vietnam Pro at 800 —
            the display weight in the token scale — and tracked in, because a
            word set this large loosens visually at its default tracking.

            Below `lg` it is the accessible name of the page and nothing else:
            the mark is already on the band above, and 34px of wordmark is 34px
            the fields need on an 844px phone.
          */}
          <h1 className="sr-only lg:not-sr-only lg:text-[3.5rem] lg:font-extrabold lg:leading-[1.02] lg:tracking-[-0.035em]">
            PlayerOne
          </h1>
          {/*
            The hero sentence, and it is the hero's. Below `lg` there is no
            split and no hero: the band is short, the form comes up, and two
            paragraphs of prose between the name and the first field would push
            the fields down an 844px phone. `login.intro` stays at every width,
            because it explains why sign-in asks for two credentials and that is
            the form's own sentence rather than the hero's.
          */}
          {/*
            The title follows the role, the way the sentence under it already
            did. "Sign in to review" was shown to the upload-centre operator in
            all three languages, and an operator imports TF cards and reviews
            nothing — the one word on the screen naming what they are about to
            do named somebody else's job.
          */}
          <h2 className="text-[1.3125rem] font-bold tracking-[-0.02em] lg:mt-8">
            {t(reviewer ? 'login.title' : 'login.titleOperator')}
          </h2>
          <p className="mt-1 max-w-[42ch] text-[0.875rem] leading-snug text-[var(--muted-foreground)] lg:mt-1.5 lg:leading-relaxed">
            {t(reviewer ? 'login.reviewerIntro' : 'login.intro')}
          </p>

          <form
            id="signin"
            onSubmit={submit}
            onFocus={() => setMood((m) => (m === 'happy' ? m : 'thinking'))}
            /* Only when focus actually leaves the form. Without the
               `relatedTarget` check, tabbing from one field to the next blurs
               and focuses in the same tick and the mascot flickers. */
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              setMood((m) => (m === 'happy' ? m : 'idle'));
            }}
            className="mt-3 flex flex-col gap-2.5 lg:mt-6 lg:gap-5"
          >
            <fieldset className="flex flex-col gap-1.5 lg:gap-2">
              <legend className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
                {t('login.role')}
              </legend>
              {/*
                One pill track with two equal segments, not two buttons with a
                gap between them. The track is what says "these two are the
                same question"; a gap says "these are two decisions". 44px
                tall on a 4px inset, so the chosen segment is a pill inside a
                pill and the hit target is the whole half.
              */}
              <div className="flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--muted)] p-1">
                <Role
                  value="operator"
                  checked={!reviewer}
                  label={t('login.roleCounter')}
                  onPick={setRole}
                />
                <Role
                  value="reviewer"
                  checked={reviewer}
                  label={t('login.roleReviewer')}
                  onPick={setRole}
                />
              </div>
            </fieldset>

            {/*
              Unmounted, not hidden. A hidden-but-present input still posts its
              value, and a machine identifier travelling with a reviewer
              sign-in is exactly the confusion this screen exists to end.
            */}
            {reviewer ? null : (
              <Fieldset legend={t('login.groupMachine')}>
                {/*
                  `section-machine` is not decoration. Both pairs on this form
                  are a username and a password, and with the bare tokens a
                  password manager treats them as one credential: it fills the
                  machine boxes with the operator's, or overwrites what it had
                  stored. Chrome says so itself in the console on every load.
                  The section prefix is the standard way to say "two credential
                  sets, one form".
                */}
                <Input
                  name="machine_identifier"
                  label={t('login.machine')}
                  autoComplete="section-machine username"
                  autoFocus
                />
                <Input
                  name="machine_secret"
                  label={t('login.machineSecret')}
                  type="password"
                  autoComplete="section-machine current-password"
                />
              </Fieldset>
            )}

            <Fieldset legend={reviewer ? t('login.groupReviewer') : t('login.groupOperator')}>
              <Input
                name="external_ref"
                label={reviewer ? t('login.reviewer') : t('login.operator')}
                autoComplete="username"
              />
              <Input
                name="operator_secret"
                label={reviewer ? t('login.reviewerSecret') : t('login.operatorSecret')}
                type="password"
                autoComplete="current-password"
              />
            </Fieldset>


          </form>
          </div>
        </div>

        {/* ---------------------------------------------------------------
            The bar, and it is a sibling of the scrolling area rather than
            something floating over it.

            It was `position: sticky` inside the form, which is the shape that
            put it *over* the fields. Making it static was not enough on its
            own — it was still inside the box that scrolls, so it simply
            scrolled away with them and at 1024×640 the button went under the
            fold. The row has to be outside the scroller, which means the
            button is outside the `<form>`, which is what `form="signin"` is
            for: a submit control anywhere in the document, bound to the form
            by id. Every browser this console supports has done that since
            2011.

            So the column is three rows — a header strip, the fields, and this
            — and the last two never overlap. The submit, the refusal and both
            policy links are on screen at first paint at every viewport, with
            no scrolling and in all three languages.
            --------------------------------------------------------------- */}
          <div className="mt-1 border-t border-[var(--border)] pt-2 lg:pb-1 lg:pt-3">
            {/*
              The refusal sits with the button, above it, and not at the end
              of the fields.

              It used to be the last thing in the form, which put it below
              the fold at 1280×720 — the screen after a refused sign-in was
              pixel-identical to the screen before it. That is the SEC-03
              path: a rate-limited operator gets no signal at all and keeps
              pressing a button that is guaranteed to keep failing. The
              sentence that explains why the button did not work belongs
              against the button.
            */}
            {failure ? (
              <p
                role="alert"
                className="mb-2.5 rounded-[var(--radius-base)] bg-[var(--reject-bg)] px-3.5 py-2.5 text-[0.875rem] font-medium text-[var(--reject)]"
              >
                {failure === 'mismatch'
                  ? t('login.mismatch')
                  : failure === 'sign_in_rate_limited'
                    ? t('bo.refused.sign_in_rate_limited')
                    : failure === 'network'
                      ? t('login.network')
                      : t('login.failed')}
              </p>
            ) : null}

            <Button
              type="submit"
              form="signin"
              variant="primary"
              size="xl"
              disabled={busy}
              aria-busy={busy}
              className="w-full"
            >
              {busy ? '…' : t('login.submit')}
            </Button>

            {/*
              The legal line, and it is under the button because that is the
              moment it describes: signing in is when a person's data starts
              being handled, and a notice above the control they are reaching
              for is a notice they scroll past.

              Two links, on their own line, rather than one sentence with the
              links inside it. A sentence with embedded anchors has to be
              reassembled per language and Vietnamese and Chinese do not put
              the clause in the same place, so the interpolated version reads
              wrong in two of the three languages we ship. A lead sentence
              and two named links translate as whole units.

              The targets are placeholders and are marked as such here rather
              than quietly pointing at `/`: the documents are legal's to
              write, and a link that goes nowhere is better than a link that
              confidently goes to the wrong page.
            */}
            <div className="mt-2.5 flex flex-col items-center gap-1 text-[0.75rem] leading-relaxed text-[var(--muted-foreground)] lg:mt-3.5 lg:items-start">
              <p className="text-center lg:text-left">{t('login.legal')}</p>
              <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 lg:justify-start">
                <Legal href="#privacy">{t('login.legalPrivacy')}</Legal>
                <Legal href="#data-collection">{t('login.legalData')}</Legal>
              </p>
            </div>
        </div>
      </main>
    </div>
  );
}

/**
 * One of the two policy links.
 *
 * A link, and therefore tech — `DESIGN.md` assigns that ramp to links and this
 * is one, so it takes the global anchor colour rather than a muted grey.
 *
 * Muted grey was tried first, on the argument that a second accent under the
 * one glowing control competes with it. It does not: the button is a 56px
 * filled pill and this is 12px of text. What the grey actually did was make
 * two links look like a caption, and it put the console and the collector app
 * on different rules for the same line. The underline stays, offset so the
 * rule clears the descenders in all three languages.
 */
function Legal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        'underline decoration-current/40 underline-offset-2',
        'transition-colors duration-150 ease-[var(--ease)]',
        'hover:decoration-current',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
      )}
    >
      {children}
    </a>
  );
}

/**
 * The two credentials are grouped, and the grouping is a real `<fieldset>` —
 * now drawn as well as announced.
 *
 * The legend was `sr-only`. So this screen's entire argument — that a mutation
 * carries two credentials, a machine proving *where* and an operator proving
 * *who* — lived in the accessibility tree and nowhere in the pixels, and a
 * sighted operator got four identical boxes and four identical grey labels.
 * The file's own header said the form exists so nobody has to "guess why their
 * username is split in half", and then the split was invisible. A design
 * critique put it plainly: the intent was written down and never drawn.
 *
 * Small, faint and tracked out, because it is a category and not a field name.
 * The labels under it stay: "Machine" then "Machine identifier" reads as a
 * heading and its first item, which is what it is.
 */
function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 lg:gap-3">
      <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--faint-foreground)]">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * One of the two roles. A real radio: arrow keys move between them, the browser
 * enforces that exactly one is chosen, and the label is the hit target.
 */
function Role({
  value,
  checked,
  label,
  onPick,
}: {
  value: 'operator' | 'reviewer';
  checked: boolean;
  label: string;
  onPick: (role: 'operator' | 'reviewer') => void;
}) {
  return (
    <label
      className={cn(
        'flex h-9 flex-1 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] px-3',
        'text-[0.875rem] font-semibold transition-colors duration-150 ease-[var(--ease)]',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
        checked
          ? 'bg-[var(--foreground)] text-[var(--background)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
      )}
    >
      <input
        type="radio"
        name="role"
        value={value}
        checked={checked}
        onChange={() => onPick(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
}

function Input({
  name,
  label,
  type = 'text',
  autoComplete,
  autoFocus,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  /** The first credential on the screen. See the call site. */
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0.5 lg:gap-1">
      <span className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        /* eslint-disable-next-line jsx-a11y/no-autofocus -- this route is the
           sign-in and nothing else; the field is the only thing to do on it,
           and the operator starts a shift here several times a day. */
        autoFocus={autoFocus}
        required
        spellCheck={false}
        className={cn(
          /* 52px, one hairline, a 12px radius, and the sun focus ring the
             rest of the console uses — that outline is the global
             `:focus-visible` rule in globals.css, so this must NOT suppress it
             the way it used to. The border and the ring are different jobs:
             the border says "a field", the ring says "the keyboard is here". */
          /* The bar at the foot of this form is 129–142px tall and is
             pinned, so a browser scrolling a focused field "into view" can
             land it squarely underneath — measured at 1280×720 in all three
             languages, and at 390×844 in Vietnamese where the fourth field was
             covered completely and typing into it showed nothing. WCAG 2.2
             SC 2.4.11. `scroll-margin-bottom` is what the browser's own
             scroll-into-view honours, and it works for both scrollers here:
             the pinned column at `lg` and the document below it. */
          'scroll-mb-40',
          'num h-[3.25rem] rounded-[var(--radius-base)] border border-[var(--field-border)] bg-[var(--card)] px-4',
          'text-[0.9375rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
          'transition-colors duration-150 ease-[var(--ease)]',
          'hover:border-[var(--foreground)]',
          'focus:border-[var(--foreground)]',
        )}
      />
    </label>
  );
}
