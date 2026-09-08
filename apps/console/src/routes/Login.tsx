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
 * ## The composition, in two screens
 *
 * **The landing.** Twelve small tilted photographs ringing the product's three
 * sentences, over the console's near-black. The reference is Luma and the
 * direction was chosen from a comp, not invented here: a dense scatter that
 * rests still and dark, drifting slowly, and ignites into a prismatic burst
 * behind the type when a pointer is over it. What the tiles show is the
 * product — five frames of our own demo film, one generated plate of a
 * collector planting in a head-mounted camera, and six reference photographs
 * of ordinary household work. `public/tiles/CREDITS.json` names every one of
 * them and marks the four uncleared ones as placeholders.
 *
 * **The split, unchanged in kind.** Scrolling resolves the field into the
 * 50/50 this screen has always been: the demo film full-bleed under a flat ink
 * scrim on the left, the form on paper on the right.
 *
 * The three slogans moved up to the landing rather than being repeated on it.
 * They are the product's one sentence and a page that says "Wear it. Live your
 * day." twice, a screen apart, is a page that wrote its headline twice.
 *
 * ## What sign-in does not depend on
 *
 * All of the above is decoration over a form that already works, and each
 * dependency was cut separately rather than as a group:
 *
 * - **The keyboard reaches the form first.** The skip link is the first thing
 *   in the tab order and jumps to `#signin`; it is an ordinary same-page anchor
 *   and needs no script. The same words are a visible control at the foot of
 *   the landing, because a person with a pointer needs the same way out.
 * - **GSAP is imported dynamically and its failure is caught.** Blocked, the
 *   landing is a still field and the page scrolls to the split the way any
 *   page scrolls. `router.tsx` imports every route eagerly, so a static
 *   `import 'gsap'` would also put the tween engine in the chunk `/review`
 *   loads.
 * - **The drift is CSS, not GSAP** (`globals.css`, `.tile`). Blocking the
 *   tween engine does not stop the field breathing, and the compositor runs it
 *   for free. GSAP is left with the one thing only it can do here: scrubbing
 *   the field against scroll position.
 * - **Blocked images leave the near-black ground and the type**, because every
 *   tile is `alt=""` inside an `aria-hidden` field. There is no broken-image
 *   text and nothing shifts.
 * - **No WebGL leaves the flat panda**, exactly as before: `TrucAsk` falls
 *   through `PandaStage` to `Panda`.
 * - **There is one form instance and it is never remounted.** The landing is a
 *   sibling section, not a state the form lives inside, so scrolling, resizing
 *   and reversing the scrub cannot touch a field's value or where the caret
 *   is. The only scroller the choreography uses is the document's; the form
 *   column keeps its own, and the two are not pointed at each other.
 *
 * ## Motion, and the two different promises
 *
 * `prefers-reduced-motion` gets a **static** composition: the drift is removed
 * rather than shortened, the burst is not built at all, the scrub never
 * registers, and the film does not autoplay. Nothing on the screen changes
 * between two paints, which is the property that makes two screenshots two
 * seconds apart identical.
 *
 * That is not the same promise as **Pause, Stop, Hide** (WCAG 2.2 SC 2.2.2),
 * and honouring one does not discharge the other. The tiles drift for longer
 * than five seconds for everybody who has not asked for stillness, so there is
 * a real labelled button that stops them — keyboard reachable, `aria-pressed`,
 * and it stops the burst as well.
 *
 * ## Weight
 *
 * Twelve tiles, 218 KiB, requested at first paint because they are the first
 * paint. The film (1.39 MB) and Trúc's glTF (1.29 MB) are **not**: the video
 * has no `src` and `TrucAsk` is not mounted until an `IntersectionObserver`
 * says the split is within 600px of the viewport. `React.lazy` alone would not
 * have done this — it defers until mount, and the mount was happening on load.
 *
 * ## The type over moving pictures
 *
 * Every contrast figure in this world was measured against a fixed ground, and
 * a drifting field is not one. So the slogan does not sit on the field: it
 * sits on `.type-halo`, an opaque core of `--stage` covering the whole type
 * block with room to spare (`globals.css`). Under every glyph, on every frame,
 * in both schemes, the ground is `--stage` `#101215` and the type is
 * `--stage-over` `#FFFFFF`: **18.76:1**, sampled from rendered pixels with the
 * burst lit rather than asserted from the tokens — the brightest pixel found
 * anywhere inside the type block, with the type itself hidden, was
 * `rgb(16,18,21)`, which is `--stage` exactly. Eighteen runs: three viewports
 * × three languages × both schemes. The landing is `.on-stage`, which is
 * near-black in both schemes, so there is one number and not two.
 *
 * The first version of this measured **4.36:1** at 1440×900 and the fault was
 * the width of the type, not the protection: at 46rem the last line ran the
 * width of the void, a lit spoke crossed the corner of the block, and no core
 * that covered that corner could also stay off the tiles beside it. The block
 * is 34rem now and the last line wraps.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { TrucAsk } from '../components/identity/TrucAsk.tsx';
import { Button } from '../components/ui/button.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { cn } from '../lib/cn.ts';

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
 * the same word, with Trúc's head over the partner's. The cut now ends at
 * 12.95s on the last clean frame of the planting beat.
 */
const VIDEO_URL: string =
  typeof import.meta.env.VITE_LANDING_VIDEO_URL === 'string' &&
  import.meta.env.VITE_LANDING_VIDEO_URL !== ''
    ? import.meta.env.VITE_LANDING_VIDEO_URL
    : '/landing.mp4';

const POSTER_URL = '/landing-poster.jpg';

/**
 * The scrim, as one value used twice — once here in the class and once in the
 * ratio quoted below. `color-mix` with `transparent` gives `--stage` at exactly
 * this alpha and leaves the hue alone, which is what makes the measurement
 * reproducible from the token rather than from a literal somebody tuned by eye.
 *
 * `--stage` at 60%: over the worst pixel a video can contain — pure white — the
 * composite is `rgb(112,113,115)`, and white type on it measures 4.90:1.
 */
const SCRIM = 'bg-[color-mix(in_srgb,var(--stage)_60%,transparent)]';

/**
 * The twelve tiles, and where each one stands.
 *
 * Fourteen files ship; twelve are used. `hf-garden2.jpg` is a variant of
 * `hf-garden.jpg` and `bookshelf.jpg` is the heaviest file in the set covering
 * the same subject as `film-books.jpg`, so those two are the ones left out —
 * 218 KiB requested against the 300 KiB gate, 285 KiB on disk for all fourteen
 * against the 600 KiB one.
 *
 * `x` and `y` are the tile's own centre as a fraction of the panel, `tilt` is
 * its rotation and `s` scales the panel's one tile size. They are geometry and
 * they live here; the size, the radius, the shadow and the drift are in
 * `globals.css` where the tokens are.
 *
 * Two properties are load-bearing and both were arrived at by measuring rather
 * than by eye. **Nothing enters the middle** — no tile has `x` between 24 and
 * 76 while `y` is between 30 and 70 — which is the void the slogan stands in.
 * And **nothing leaves the panel** at any viewport in the set, including at the
 * far end of a drift: at 1280×720, the tightest of them, the lowest tile's
 * bottom edge lands 22px short of the panel's. A tile that overhangs would put
 * a scrollbar on the document, which is the one thing a full-bleed field must
 * never do.
 */
const TILES = [
  { src: '/tiles/film-face.jpg', x: '10%', y: '22%', tilt: '-7deg', s: 0.92 },
  { src: '/tiles/kitchen-chopping.jpg', x: '22%', y: '9%', tilt: '6deg', s: 0.84 },
  { src: '/tiles/film-chop.jpg', x: '38%', y: '16%', tilt: '-4deg', s: 0.72 },
  { src: '/tiles/ref-kitchen.jpg', x: '56%', y: '10%', tilt: '8deg', s: 0.9 },
  { src: '/tiles/ref-headset.jpg', x: '74%', y: '20%', tilt: '-6deg', s: 1 },
  { src: '/tiles/hf-garden.jpg', x: '89%', y: '38%', tilt: '5deg', s: 0.86 },
  { src: '/tiles/ref-yoga.jpg', x: '84%', y: '68%', tilt: '-8deg', s: 0.96 },
  { src: '/tiles/film-kitchen.jpg', x: '66%', y: '86%', tilt: '7deg', s: 0.82 },
  { src: '/tiles/ironing-hands.jpg', x: '47%', y: '89%', tilt: '-3deg', s: 0.94 },
  { src: '/tiles/ref-cleaning.jpg', x: '28%', y: '80%', tilt: '6deg', s: 0.78 },
  { src: '/tiles/film-garden.jpg', x: '14%', y: '62%', tilt: '-5deg', s: 1 },
  { src: '/tiles/film-books.jpg', x: '10%', y: '43%', tilt: '4deg', s: 0.8 },
] as const;

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
  const reviewer = role === 'reviewer';
  const reduced = useReducedMotion();

  /** The operator has stopped the drift. WCAG 2.2 SC 2.2.2. */
  const [paused, setPaused] = useState(false);

  /**
   * Whether the split is close enough to be worth fetching its two heavy
   * assets — 1.39 MB of film and 1.29 MB of glTF, which together are more than
   * half of the whole page's budget and neither of which is on the first
   * screen. `React.lazy` does not do this: it defers until mount, and the
   * mount used to happen on load.
   */
  const [near, setNear] = useState(false);

  const landing = useRef<HTMLElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const type = useRef<HTMLDivElement>(null);
  const split = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = split.current;
    if (target === null) return;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      /* Far enough ahead that the poster has been replaced by the time the
         split is the thing being looked at, close enough that a person who
         signs in from the landing never pays for either file. */
      { rootMargin: '600px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  /**
   * The one authored moment on this screen: the field resolving into the
   * split.
   *
   * `gsap.matchMedia` rather than a `window.innerWidth` branch — it registers
   * the timeline against a media query, reverts it when the window leaves the
   * range, and takes `prefers-reduced-motion` as part of the same query, so
   * under reduced motion the timeline is never built and there is nothing to
   * "collapse to a shorter duration". A still page, not a fast one.
   *
   * Desktop only, because desktop is the only place with a scrub to ride: the
   * landing is 180vh at `lg` with its panel pinned inside it, and the tiles
   * spread and fade over that distance while the slogan settles back. Below
   * `lg` the landing is exactly one screen and scrolling reaches the split the
   * ordinary way.
   *
   * The import is caught rather than left to reject. A blocked CDN or a broken
   * chunk must be a still landing and a working form, not an unhandled
   * rejection in the console of an upload centre.
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
        const trigger = landing.current;
        if (trigger === null) return;
        const scrollTrigger = { trigger, start: 'top top', end: 'bottom bottom', scrub: 0.4 };

        if (field.current) {
          gsap.to(field.current, { scale: 1.16, opacity: 0, ease: 'none', scrollTrigger });
        }
        if (type.current) {
          gsap.to(type.current, { yPercent: -14, opacity: 0, ease: 'none', scrollTrigger });
        }
      });

      context = media;
    })().catch(() => {
      /* No tween engine. The landing is still a landing and the form works. */
    });

    return () => {
      live = false;
      context?.revert();
    };
  }, [reduced]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
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
    } catch {
      /* The LAN dropped, or the API is not running. Say which is possible. */
      setFailure('network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative bg-[var(--background)]">
      {/*
        The first thing in the tab order, and the whole of this screen's promise
        that the choreography is optional. An ordinary same-page anchor: no
        script, no listener, nothing to fail. `#signin` is the form's own
        column, which takes focus because it carries `tabIndex={-1}`.
      */}
      <a
        href="#signin"
        className={cn(
          'sr-only rounded-[var(--radius-pill)] bg-[var(--action)] px-4 py-2',
          'text-[0.8125rem] font-semibold text-[var(--action-ink)] no-underline',
          'focus:not-sr-only focus:absolute focus:left-5 focus:top-5 focus:z-50',
        )}
      >
        {t('login.skip')}
      </a>

      {/* ---------------------------------------------------------------
          The landing.

          180vh at `lg` with the panel pinned inside it, which is where the
          scrub comes from. One screen everywhere else, and one screen under
          reduced motion at every width — there would be nothing moving through
          the other eighty percent, and asking somebody who has said "stop
          moving things" to scroll past a still picture is not a courtesy.
          --------------------------------------------------------------- */}
      <section
        ref={landing}
        data-motion={paused ? 'paused' : undefined}
        className={cn('landing on-stage relative', reduced ? 'h-dvh' : 'h-dvh lg:h-[180vh]')}
      >
        <div className="sticky top-0 flex h-dvh items-center justify-center overflow-hidden px-5 sm:px-8">
          {/*
            The field. `aria-hidden` and every tile `alt=""`: twelve
            photographs of housework are the atmosphere this page is set in,
            not twelve things to read out one after another before reaching
            the sentence they are arranged around.
          */}
          <div ref={field} aria-hidden="true" className="tile-field">
            {TILES.map((tile) => (
              <img
                key={tile.src}
                src={tile.src}
                alt=""
                width={420}
                height={420}
                decoding="async"
                className="tile"
                style={
                  {
                    '--x': tile.x,
                    '--y': tile.y,
                    '--tilt': tile.tilt,
                    '--s': tile.s,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>

          {/*
            The burst, behind everything the type stands on. It is a sibling of
            the type block rather than a child of it, because it is a great
            deal larger than the words and a child would be measured against
            them.
          */}
          <div className="prism" aria-hidden="true" />

          <div ref={type} className="relative w-full max-w-[min(34rem,86vw)] text-center">
            <div className="type-halo" aria-hidden="true" />

            {/*
              Three beats, one line each, and the third carries the weight.

              The comp set the last line in a gradient. `DESIGN.md` and the
              craft floor both refuse gradient lettering and they are right to:
              emphasis on this page comes from weight and size, so the third
              line is a step larger and 900 against the 800 above it. It is
              also the only one of the three that is about money.
            */}
            <ul className="relative m-0 flex list-none flex-col gap-2 p-0 text-[var(--stage-over)]">
              {['login.slogan.1', 'login.slogan.2'].map((key) => (
                <li
                  key={key}
                  className="text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[2.75rem] lg:text-[3.25rem]"
                >
                  {t(key)}
                </li>
              ))}
              <li className="text-balance text-[2.5rem] font-black leading-[1.05] tracking-[-0.035em] sm:text-[3.25rem] lg:text-[3.75rem]">
                {t('login.slogan.3')}
              </li>
            </ul>
          </div>

          {/*
            The mark, once, where a landing puts it. The word is the `h1` on the
            other half of the split below, so this is the mark and not the
            lockup — a wordmark here would be the product's name twice.
          */}
          <div className="absolute left-5 top-5 sm:left-8 sm:top-8">
            <Mark size={30} />
          </div>

          {/* ---------------------------------------------------------------
              The landing's two controls, and both go somewhere real.

              The pause button stops the drift and the burst; the link is the
              same skip link as the one at the top of the tab order, drawn for
              a person holding a mouse. Under reduced motion the button is not
              rendered, because nothing is moving for it to stop.
              --------------------------------------------------------------- */}
          <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap sm:gap-4">
            {reduced ? null : (
              <button
                type="button"
                aria-pressed={paused}
                onClick={() => setPaused((was) => !was)}
                className={cn(
                  'rounded-[var(--radius-pill)] border border-[var(--stage-line)] px-3.5 py-2',
                  'bg-[color-mix(in_srgb,var(--stage)_72%,transparent)] backdrop-blur-sm',
                  'text-[0.75rem] font-semibold text-[var(--stage-over)]',
                  'transition-colors duration-150 ease-[var(--ease)]',
                  'hover:bg-[var(--stage-panel)]',
                )}
              >
                {t(paused ? 'login.resumeMotion' : 'login.pauseMotion')}
              </button>
            )}

            <a
              href="#signin"
              className={cn(
                'rounded-[var(--radius-pill)] bg-[var(--stage-over)] px-4 py-2',
                'text-[0.75rem] font-semibold text-[var(--stage)] no-underline',
                'transition-colors duration-150 ease-[var(--ease)]',
                'hover:bg-[var(--lime-500)]',
              )}
            >
              {t('login.skip')}
            </a>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          The split: the film on the left, the form on paper on the right.
          --------------------------------------------------------------- */}
      <div ref={split} className="relative lg:grid lg:grid-cols-2">
        {/*
          The band's height, and the one measurement that made this screen look
          broken.

          `aspect-video` alone means the band is 9/16 of the *window* width
          until the split arrives at `lg`. On a 962×961 tablet that is 540px —
          56% of the viewport — so the form underneath was crushed into the
          remaining 421px. From `md` it is a fraction of the *height* instead,
          which is the dimension the form is actually competing for.

          `svh` and not `vh`, because on a phone-shaped tablet in portrait `vh`
          is the height with the browser chrome retracted, and a band measured
          against it grows when the chrome slides away mid-scroll.
        */}
        <div className="on-stage relative aspect-video md:aspect-auto md:h-[30svh] lg:h-dvh">
          <div className="absolute inset-0 overflow-hidden">
            <video
              /*
               * No `src` until the observer above says the split is close.
               * `preload="metadata"` on a `src` that is present from the first
               * paint fetched the container of a 1.39 MB file for a screen
               * that had not been scrolled to yet.
               */
              src={near ? VIDEO_URL : undefined}
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

          {/* The flat scrim. One value, measured; see the note at the top. */}
          <div className={cn('pointer-events-none absolute inset-0', SCRIM)} aria-hidden="true" />

          {/*
            The mark in its own two colours, not the one-colour lockup. On ink
            the monochrome version is right; on a photograph two white circles
            of different opacity read as a UI toggle rather than as a logo.
            Sun and tech on the scrim are unmistakably the mark — and it is the
            mark and not the wordmark, because the word is the `h1` directly
            opposite it across the seam.
          */}
          <div className="pointer-events-none absolute left-5 top-5 sm:left-8 sm:top-8 lg:left-14 lg:top-14">
            <Mark size={30} />
          </div>

          {/*
            Trúc, in the corner, as something you can ask.

            He was 520px in the middle of this panel, which drew a cartoon
            panda across the mouth and chin of the collector the film is about.
            A mascot that covers the product is not a mascot, and the film is
            the one thing on this half doing the selling. He is not mounted at
            all until the split is close, which is what keeps three.js and
            1.29 MB of glTF off the landing.
          */}
          <div className="absolute bottom-8 right-4 z-10 hidden sm:block lg:bottom-10 lg:right-8">
            {near ? <TrucAsk /> : null}
          </div>
        </div>

        {/* ---------------------------------------------------------------
            The paper half, and the reason it is a fixed-height flex column
            rather than an ordinary block.

            The submit used to be `position: sticky` inside the form, which
            puts it *over* the fields rather than after them. That satisfies
            "the button is always visible" and quietly breaks something worse:
            at first paint, with nobody having scrolled, the bar covered
            `external_ref` and `operator_secret` at 1280×720, covered
            `machine_secret` and `external_ref` at 1024×640 and pushed
            `operator_secret` off the bottom entirely, and covered
            `operator_secret` at 390×844.

            So the column is exactly the height of what is left of the viewport
            after the film band, it is a flex column, the fields scroll inside
            the middle row, and the submit is the last thing in the form in
            ordinary flow. `56.25vw` is the band's own height below `md`, where
            it is `aspect-video` of the full width; `min-h` is the guard for a
            short landscape phone, where the document is allowed to scroll
            rather than crush the form into nothing.

            `id` and `tabIndex` are the skip link's landing site. Focus has to
            move, not just the scroll position, or the next Tab press starts
            again from the top of the landing.
            --------------------------------------------------------------- */}
        <main
          id="signin"
          tabIndex={-1}
          className="relative isolate flex h-[calc(100dvh-56.25vw)] min-h-[22rem] scroll-mt-0 flex-col px-5 pb-0 pt-2 focus:outline-none sm:px-10 md:h-[70svh] lg:h-dvh lg:min-h-0 lg:self-start lg:px-14 lg:py-6"
        >
          {/* ---------------------------------------------------------------
              The ground the form sits on, below the split.

              Two soft fields of colour, blurred past the point where either has
              an edge. `DESIGN.md` bans a gradient on the *inks* — the three
              verdicts and the two brand ramps are flat wherever they carry
              meaning, and nothing here carries meaning. This is light in the
              room, not a colour with a job.

              It exists below `lg` only. Above it the film is the atmosphere and
              a second one would be two.

              Measured on rendered pixels rather than asserted: `--foreground`
              over the worst composite reads 16.7:1 light and 14.2:1 dark, and
              `--muted-foreground` — which carries the field labels — reads
              5.21:1 light and 6.76:1 dark.
              --------------------------------------------------------------- */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden lg:hidden"
          >
            <div className="absolute -left-[15%] -top-[10%] h-[70vw] w-[85vw] rounded-full bg-[var(--bamboo-50)] opacity-60 blur-[64px]" />
            <div className="absolute -right-[20%] top-[26%] h-[60vw] w-[75vw] rounded-full bg-[var(--warn-bg)] opacity-50 blur-[64px]" />
          </div>

          <div className="flex items-center justify-end gap-1">
            <LocaleSwitch />
            <ThemeSwitch />
          </div>

          {/*
            Two boxes, and the inner one is the reason.

            A `justify-center` flex box whose content is taller than it centres
            the overflow, which means it clips *both* ends and the top end
            cannot be scrolled to — measured on a 390px phone, where the heading
            was sliced through the middle by the row above it and no amount of
            scrolling brought it back. The scroller must not be the thing doing
            the centring.
          */}
          <div className="min-h-0 w-full flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[27rem] flex-col justify-center py-2 lg:py-5">
              {/*
                The name, once, at a size that means it. Below `lg` it is the
                accessible name of the page and nothing else: the mark is
                already on the band above, and 34px of wordmark is 34px the
                fields need on an 844px phone.
              */}
              <h1 className="sr-only lg:not-sr-only lg:text-[2.25rem] lg:font-extrabold lg:leading-[1.05] lg:tracking-[-0.03em]">
                PlayerOne
              </h1>
              {/*
                The title follows the role, the way the sentence under it
                already did. "Sign in to review" was shown to the upload-centre
                operator in all three languages, and an operator imports TF
                cards and reviews nothing.
              */}
              <h2 className="text-[1.3125rem] font-bold tracking-[-0.02em] lg:mt-4">
                {t(reviewer ? 'login.title' : 'login.titleOperator')}
              </h2>
              <p className="mt-1 max-w-[42ch] text-[0.875rem] leading-snug text-[var(--muted-foreground)] lg:mt-1.5 lg:leading-relaxed">
                {t(reviewer ? 'login.reviewerIntro' : 'login.intro')}
              </p>

              {/*
                One rhythm: 8 / 24 / 36. A label sits 8px above its own field,
                fields inside a group are 24px apart, and groups are 36px apart.
                Every number is a multiple of four and each one is clearly larger
                than the one inside it, which is the only property that makes a
                grouping legible without a rule or a box.
              */}
              <form onSubmit={submit} className="mt-4 flex flex-col gap-6 lg:mt-4 lg:gap-6">
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--faint-foreground)]">
                    {t('login.role')}
                  </legend>
                  {/*
                    One pill track with two equal segments, not two buttons with
                    a gap between them. The track is what says "these two are
                    the same question"; a gap says "these are two decisions".
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
                  Unmounted, not hidden. A hidden-but-present input still posts
                  its value, and a machine identifier travelling with a reviewer
                  sign-in is exactly the confusion this screen exists to end.
                */}
                {reviewer ? null : (
                  <Fieldset legend={t('login.groupMachine')}>
                    {/*
                      `section-machine` is not decoration. Both pairs on this
                      form are a username and a password, and with the bare
                      tokens a password manager treats them as one credential.
                    */}
                    {/*
                      No `autoFocus` any more, and its removal is the landing's
                      cost. It used to be right: the form was the first screen
                      and the field was the only thing to do on it. With a
                      screen of landing above, autofocus put the caret in a box
                      a metre below the fold — a keyboard operator's focus ring
                      was off screen at first paint, the first Tab moved it to
                      another box they could not see, and typing went somewhere
                      invisible. Measured: `scrollY` 0, `activeElement`
                      `machine_identifier`, at 1440×900 and at 390×844. The
                      skip link is what puts a keyboard on the form now, and it
                      is the first thing in the tab order.
                    */}
                    <Input
                      name="machine_identifier"
                      label={t('login.fieldIdentifier')}
                      autoComplete="section-machine username"
                    />
                    <Input
                      name="machine_secret"
                      label={t('login.fieldSecret')}
                      type="password"
                      autoComplete="section-machine current-password"
                    />
                  </Fieldset>
                )}

                <Fieldset legend={reviewer ? t('login.groupReviewer') : t('login.groupOperator')}>
                  <Input
                    name="external_ref"
                    label={t('login.fieldReference')}
                    autoComplete="username"
                  />
                  <Input
                    name="operator_secret"
                    label={t('login.fieldSecret')}
                    type="password"
                    autoComplete="current-password"
                  />
                </Fieldset>

                <div className="pt-1">
                  {/*
                    The refusal sits with the button, above it, and not at the
                    end of the fields. It used to be the last thing in the form,
                    which put it below the fold at 1280×720 — the screen after a
                    refused sign-in was pixel-identical to the screen before it.
                  */}
                  {failure ? (
                    <p
                      role="alert"
                      className="mb-3 rounded-[var(--radius-base)] bg-[var(--reject-bg)] px-3.5 py-2.5 text-[0.875rem] font-medium text-[var(--reject)]"
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
                    variant="primary"
                    size="xl"
                    disabled={busy}
                    aria-busy={busy}
                    className="w-full"
                  >
                    {busy ? '…' : t('login.submit')}
                  </Button>

                  {/*
                    The legal line, and it is under the button because that is
                    the moment it describes: signing in is when a person's data
                    starts being handled, and a notice above the control they
                    are reaching for is a notice they scroll past.

                    Two links on their own line rather than one sentence with
                    the links inside it: Vietnamese and Chinese do not put the
                    clause in the same place, so an interpolated sentence reads
                    wrong in two of the three languages we ship.
                  */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[0.75rem] leading-relaxed text-[var(--muted-foreground)]">
                    <span>{t('login.legal')}</span>
                    <span className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                      <Legal href="#privacy">{t('login.legalPrivacy')}</Legal>
                      <Legal href="#data-collection">{t('login.legalData')}</Legal>
                    </span>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * One of the two policy links.
 *
 * A link, and therefore tech — `DESIGN.md` assigns that ramp to links and this
 * is one, so it takes the global anchor colour rather than a muted grey.
 *
 * The targets are placeholders and are marked as such rather than quietly
 * pointing at `/`: the documents are legal's to write, and a link that names
 * itself as unwritten is better than one that confidently goes to the wrong
 * page.
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
 *
 * Small, faint and tracked out, because it is a category and not a field name.
 */
function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5">
      <legend className="mb-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--faint-foreground)]">
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
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[0.8125rem] font-semibold text-[var(--foreground)]">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        spellCheck={false}
        className={cn(
          /* 48px, one hairline, a 12px radius, and the sun focus ring the rest
             of the console uses — that outline is the global `:focus-visible`
             rule in globals.css, so this must NOT suppress it. The border and
             the ring are different jobs: the border says "a field", the ring
             says "the keyboard is here". */
          /* `scroll-margin-bottom` is what the browser's own scroll-into-view
             honours, and it works for both scrollers here: the form column and
             the document. WCAG 2.2 SC 2.4.11. */
          'scroll-mb-40',
          'num h-12 rounded-[var(--radius-base)] border border-[var(--field-border)] bg-[var(--card)] px-4',
          'text-[0.9375rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
          'transition-colors duration-150 ease-[var(--ease)]',
          'hover:border-[var(--foreground)]',
          'focus:border-[var(--foreground)]',
        )}
      />
    </label>
  );
}
