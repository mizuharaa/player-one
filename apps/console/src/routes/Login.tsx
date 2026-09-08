/**
 * Sign in, and the one place in this console that has to persuade before it
 * can operate.
 *
 * ## The direction, as a contract
 *
 * Chosen by the product owner against two alternates, 2026-09-07, and named
 * **The Drift**. Every pass on this file audits the render against these five.
 *
 * **THESIS.** The scatter is the product: a thousand ordinary rooms,
 * recorded.
 *
 * **OWN-WORLD.** Off-white ground, work stills at genuinely varied sizes and
 * crops, one prismatic disc as the only saturated thing on the screen. Not a
 * grid of same-size cards; not the reference's retro styling.
 *
 * **STORY.** The field drifts → the call to action fires the disc and renames
 * the claim → the marquee states the unit of payment → the form asks who you
 * are. One choreography, not four entrances.
 *
 * **FIRST VIEWPORT.** Slogan, scatter, two buttons. Nothing else, and no
 * scroll needed to understand the offer.
 *
 * **FORM.** Two credentials, one segmented control, four fields, one submit —
 * arriving as a stagger, usable before it does.
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
 * behind the type when a pointer is over one of the tiles. What the tiles show
 * is the
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
 * **Re-measured after the burst became a spectrum**, because a brighter burst
 * is a different worst frame and a number carried over is not a measurement.
 * All eighteen runs still read `rgb(16,18,21)` and 18.76:1, with the burst
 * lit by a tile hover rather than by the pointer merely being on the page.
 * The two controls at the foot of the landing were measured on the same lit
 * frame: their labels read 17.10:1 and 18.76:1 at worst, over 4.5:1 by a wide
 * margin, and the pause pill's boundary — see the note on its border — is the
 * one number that had to change.
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
import { cva } from 'class-variance-authority';
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
 * The eleven tiles: what each one is, where it stands, and how big and how
 * near it is.
 *
 * **The variance is the direction, not a garnish.** The version the product
 * owner rejected was a ring of near-identical rounded squares at one size,
 * and the named risk on the approved direction is that it flattens back into
 * that. So no two tiles here share a shape: `w` and `h` are separate
 * multipliers of the panel's one tile unit, and they run from a 0.58 square
 * through 1.5-wide landscapes to 1.5-tall portraits — a factor of about seven
 * in area between the smallest and the largest.
 *
 * `d` is depth, 0 far and 1 near, and it is a number of its own rather than
 * something derived from size. A small tile is usually a far one but not
 * always, and tying the two together is what makes a scatter read as a scaled
 * grid. `globals.css` turns `d` into blur and into held-back opacity.
 *
 * `zoom` is crop tightness: the image is scaled inside its frame, so two
 * tiles of the same subject are not the same picture. `pos` moves the crop
 * off centre — a face is cropped high, a pair of hands low.
 *
 * `tilt` runs -11deg to +10deg, wider than the ±8 it was, because a scatter
 * whose rotations all sit in one narrow band reads as a sheet that has been
 * nudged.
 *
 * **Three came out**, on the product owner's reading of the live page: the
 * back cover of a book (`film-books.jpg`) and a dancer in a headset against a
 * black studio (`ref-headset.jpg`). Neither is somebody doing housework in an
 * Ego camera, and this landing is a claim about what the product collects.
 * `hf-garden2.jpg`, held back as a duplicate, takes one of the places, and
 * `bookshelf.jpg` stays out for the same reason `film-books.jpg` left. He also
 * named a third — a browser screenshot reading "High memory usage: 1.6 GB".
 * There is no such file: `public/tiles/` holds fourteen images and all
 * fourteen are photographs, so that is the reader's own browser drawn over the
 * page and not a tile. Said rather than silently ignored.
 *
 * `CREDITS.json` credits every file that ships, which is still all fourteen,
 * so it stays correct without an edit.
 *
 * **`pov` is the punch-in.** Hovering a tile zooms into its middle and
 * cross-fades to a still of the same kind of work from the camera's own
 * position — hands and the work, not a person seen from across a room. Every
 * one of them is already in the set and already requested by another tile, so
 * the second image costs no bytes.
 *
 * **`ring` is the wave.** 0 is nearest the middle, 2 is furthest out. Tiles in
 * a ring arrive together and the rings arrive one after another, which is the
 * breadth-first entrance the product owner asked for.
 *
 * Two invariants, both measured rather than eyeballed, and both re-measured
 * after every move: **nothing enters the void the slogan stands in**, and
 * **nothing leaves the panel on any frame at any viewport** — checked over
 * thirty samples of the drift cycle at five viewports on all four edges,
 * because a tilt grows a tile's axis-aligned box by up to a fifth and the
 * drift then adds two degrees and eight pixels on top of that.
 */
const TILES = [
  { src: '/tiles/film-face.jpg', pov: '/tiles/film-chop.jpg', x: '10.5%', y: '24%', w: 0.95, h: 1.35, d: 0.9, tilt: '-7deg', zoom: 1.05, pos: '50% 34%', ring: 2 },
  { src: '/tiles/kitchen-chopping.jpg', pov: '/tiles/film-chop.jpg', x: '23%', y: '12%', w: 1.5, h: 0.95, d: 0.55, tilt: '5deg', zoom: 1.2, pos: '50% 50%', ring: 2 },
  { src: '/tiles/film-chop.jpg', pov: '/tiles/ironing-hands.jpg', x: '38%', y: '13%', w: 0.62, h: 0.62, d: 0.2, tilt: '-10deg', zoom: 1.35, pos: '46% 60%', ring: 1 },
  { src: '/tiles/ref-kitchen.jpg', pov: '/tiles/film-chop.jpg', x: '53%', y: '12%', w: 1.35, h: 0.85, d: 0.75, tilt: '8deg', zoom: 1.0, pos: '50% 42%', ring: 1 },
  { src: '/tiles/hf-garden2.jpg', pov: '/tiles/film-garden.jpg', x: '69.5%', y: '20%', w: 0.85, h: 1.25, d: 0.5, tilt: '-5deg', zoom: 1.15, pos: '52% 46%', ring: 2 },
  { src: '/tiles/hf-garden.jpg', pov: '/tiles/film-garden.jpg', x: '87%', y: '36%', w: 1.2, h: 1.2, d: 1, tilt: '6deg', zoom: 1.0, pos: '50% 50%', ring: 2 },
  { src: '/tiles/ref-yoga.jpg', pov: '/tiles/ironing-hands.jpg', x: '86%', y: '67%', w: 1.15, h: 0.7, d: 0.35, tilt: '-9deg', zoom: 1.25, pos: '50% 44%', ring: 2 },
  { src: '/tiles/film-kitchen.jpg', pov: '/tiles/film-chop.jpg', x: '73.5%', y: '84%', w: 0.58, h: 0.58, d: 0.15, tilt: '10deg', zoom: 1.3, pos: '55% 50%', ring: 1 },
  { src: '/tiles/ironing-hands.jpg', pov: '/tiles/ironing-hands.jpg', x: '48.5%', y: '82%', w: 0.9, h: 1.3, d: 0.95, tilt: '-4deg', zoom: 1.1, pos: '50% 62%', ring: 0 },
  { src: '/tiles/ref-cleaning.jpg', pov: '/tiles/ironing-hands.jpg', x: '27%', y: '84%', w: 1.25, h: 0.8, d: 0.45, tilt: '7deg', zoom: 1.18, pos: '48% 55%', ring: 1 },
  { src: '/tiles/film-garden.jpg', pov: '/tiles/film-garden.jpg', x: '11%', y: '66%', w: 1.05, h: 1.5, d: 0.85, tilt: '-11deg', zoom: 1.0, pos: '50% 55%', ring: 2 },
] as const;

/**
 * The three burst variants, and each one is a kind of work this pilot pays
 * for rather than a mood.
 *
 * The reference swaps the effect and one word of the headline together, and
 * the product owner asked for the same thing "tailored ... to tasks we have".
 * So the key line — the one about money — names the work, the disc behind it
 * changes with it, and the two lines above, which are the product's own
 * sentence, do not move.
 *
 * The order is his: the vivid magenta-into-orange and the prismatic rays are
 * the two he picked out, so they are the two a person sees first.
 */
const BURSTS = [
  { key: 'kitchen', slogan: 'login.slogan.3.kitchen' },
  { key: 'garden', slogan: 'login.slogan.3.garden' },
  { key: 'cleaning', slogan: 'login.slogan.3.cleaning' },
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
   * Which burst is armed, and it advances on the *approach* rather than on the
   * click.
   *
   * The button is the trigger for the effect and the way into the product, and
   * those are two different moments: `pointerenter` and `focus` arm the next
   * variant and light it, and the click that follows goes to the form. So a
   * person who runs the pointer over the button three times sees three
   * different things and reads three different sentences, and a person who
   * just presses it never notices there were three.
   */
  const [burst, setBurst] = useState(0);
  const variant = BURSTS[burst % BURSTS.length] ?? BURSTS[0];
  const nextBurst = () => setBurst((n) => (n + 1) % BURSTS.length);

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
  const band = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);

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

      /**
       * One choreography, three beats, and that is deliberate.
       *
       * The brief for this screen asks for more life and the craft floor asks
       * for *one authored moment rather than five unrelated tricks*, and those
       * two only agree if the whole page is one movement. So this is a single
       * `matchMedia` context holding one continuous idea — the field opens,
       * the claim runs past, the form arrives — rather than three components
       * each with an entrance of its own.
       *
       * **Everything starts from an already-visible default.** Nothing here
       * declares an `opacity: 0` in CSS that a script has to clear; each tween
       * animates *from* an offset state, so a blocked tween engine leaves a
       * finished page rather than an invisible one. That is the difference
       * between a progressive enhancement and a dependency, and it is the
       * reason the whole import is inside a `catch`.
       */
      media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
        const trigger = landing.current;
        if (trigger === null) return;
        const scrollTrigger = { trigger, start: 'top top', end: 'bottom bottom', scrub: 0.4 };

        /* Beat one: the field opens out and the claim goes with it. */
        if (field.current) {
          gsap.to(field.current, { scale: 1.16, opacity: 0, ease: 'none', scrollTrigger });
        }
        if (type.current) {
          gsap.to(type.current, { yPercent: -14, opacity: 0, ease: 'none', scrollTrigger });
        }

        /*
         * Beat two: the band. Its sideways run is CSS and never stops; what
         * scroll decides is how the strip arrives — it rises and its letters
         * come out of a blur, which is the one place blur is a material here
         * rather than decoration. `once: true`, because a strip that
         * re-assembles every time it is scrolled past is a strip that is never
         * finished.
         */
        if (band.current) {
          gsap.from(band.current, {
            yPercent: 40,
            opacity: 0,
            filter: 'blur(14px)',
            duration: 0.9,
            ease: 'expo.out',
            scrollTrigger: { trigger: band.current, start: 'top 92%', once: true },
          });
        }

        /*
         * Beat three: the form arrives, and this is the part the product
         * owner named — the panel used to simply be there. It is a stagger
         * across the panel's own parts in reading order, not one fade of the
         * whole column: the heading, then the sentence, then each fieldset,
         * then the submit. `expo.out` and 40ms apart, so it reads as one
         * movement settling rather than as five things arriving.
         *
         * `[data-arrive]` and not a class: a class is a styling decision and
         * moves, and this is the same reason `steps.ts` addresses the guided
         * tour by data attribute.
         */
        const parts = panel.current?.querySelectorAll('[data-arrive]');
        if (parts && parts.length > 0) {
          gsap.from(parts, {
            y: 26,
            opacity: 0,
            duration: 0.7,
            ease: 'expo.out',
            stagger: 0.04,
            scrollTrigger: { trigger: panel.current, start: 'top 78%', once: true },
          });
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
        data-burst={variant.key}
        className={cn('landing relative', reduced ? 'h-dvh' : 'h-dvh lg:h-[180vh]')}
      >
        <div className="landing-panel sticky top-0 flex h-dvh flex-col items-center justify-center overflow-hidden px-5 sm:px-8">
          {/*
            The field. `aria-hidden` and every image `alt=""`: eleven
            photographs of housework are the atmosphere this page is set in,
            not twenty-two things to read out one after another before
            reaching the sentence they are arranged around.

            Two images per tile, and the second costs nothing: every `pov`
            file is another tile's `src`, so the browser has already
            downloaded all of them by the time a pointer reaches one.
          */}
          <div ref={field} aria-hidden="true" className="tile-field">
            {TILES.map((tile) => (
              <div
                key={tile.src}
                className="tile"
                style={
                  {
                    '--x': tile.x,
                    '--y': tile.y,
                    '--tilt': tile.tilt,
                    '--w': tile.w,
                    '--h': tile.h,
                    '--d': tile.d,
                    '--zoom': tile.zoom,
                    '--pos': tile.pos,
                    '--ring': tile.ring,
                  } as React.CSSProperties
                }
              >
                <img
                  src={tile.src}
                  alt=""
                  width={420}
                  height={420}
                  decoding="async"
                  className="tile-face"
                />
                <img
                  src={tile.pov}
                  alt=""
                  width={420}
                  height={420}
                  decoding="async"
                  className="tile-pov"
                />
              </div>
            ))}
          </div>

          <div ref={type} className="relative w-full max-w-[min(34rem,86vw)] text-center">
            {/* ---------------------------------------------------------------
                Three layers, in this order, and the order is the whole of the
                layering. There is not a `z-index` on any of them.

                1. `.type-halo` — the slogan's own ground. Invisible, because
                   it is `--background`, the same colour as the page; its job
                   is that a tile can never be the thing under a letter. The
                   number that made it necessary is 1.08:1, measured at
                   390×844 without it.
                2. `.prism` — the disc, blended over the tiles and the halo.
                3. the type and the button, painted last and so never blended.

                **It was three `z-index` values and that was a bug**, found by
                measuring rather than by reading: with `z-index: 1` on the disc
                and `2` on the type, Chromium composited the disc's pattern
                straight over the button, in dark theme, where the pill
                measured `rgb(15,16,24)` against a `--action` of `#ECEDF5`.
                Raising the type to `z-index: 9` changed nothing; setting the
                disc back to `z-index: 0` fixed it instantly. A `mix-blend-mode`
                element with a positive `z-index` does not stay under the
                things painted after it. So the disc moved here, between the
                halo and the text, and every `z-index` came out — document
                order does the same job and cannot be defeated by a compositing
                rule nobody remembers.

                The disc is centred on this wrapper rather than on the panel,
                which is what the reference asks for anyway: the burst is
                behind the headline, not behind the screen.
                --------------------------------------------------------------- */}
            <div className="type-halo" aria-hidden="true" />
            <div className="prism" aria-hidden="true" />

            <div className="type-stack">
            {/*
              Three beats, and the third is the one about money.

              The comp set the last line in a gradient. `DESIGN.md` and the
              craft floor both refuse gradient lettering and they are right to:
              emphasis on this page is size and weight, so the key line is one
              step of each above the two before it and that is the whole of
              the emphasis.

              It is also the line the burst variant renames. The two above it
              are the product's own sentence and never change; what changes is
              which work is being paid for, because that is the only part of
              the claim that has three answers.

              `aria-live` is deliberately absent. The word changes under a
              pointer on a decorative control, and announcing a headline
              rewriting itself every time somebody grazes a button is noise. A
              screen reader gets whichever sentence is on the page when it
              reaches it, and all three say the same thing.

              No size, weight or tracking here: they are the landing's type
              scale in `globals.css`, three steps per role with an optical
              weight at each.
            */}
            <ul className="m-0 list-none p-0">
              {['login.slogan.1', 'login.slogan.2'].map((key) => (
                <li key={key} className="slogan">
                  {t(key)}
                </li>
              ))}
              <li className="slogan-key">{t(variant.slogan)}</li>
            </ul>

            {/* ---------------------------------------------------------------
                One control, and it is both the way in and the thing that
                lights the page.

                It replaces two floating pills — a labelled "Pause the moving
                background" and an outlined "Skip to sign in" — which was the
                first thing the eye landed on and neither of which was the
                action. This is the `Button` primitive at the size the sign-in
                submit already uses, so the two ends of the screen are the
                same control, and it is an `<a>` through `asChild`: it moves
                the page to the form and needs no script to do it.

                `onPointerEnter` and `onFocus` arm the next variant. The CSS
                does the lighting from `:hover` and `:focus-visible` on this
                same element, so a keyboard gets the effect and a pointer that
                is merely passing through does not have to click to see it.
                --------------------------------------------------------------- */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-10">
              <Button
                variant="primary"
                size="xl"
                asChild
                /*
                 * `hover:opacity-100`, overriding the primary's own hover.
                 *
                 * `Button`'s primary answers hover by dropping to 90% opacity,
                 * which is right everywhere else in the console — an ink pill
                 * has no lighter step to move to. Here it is wrong twice over:
                 * hovering this button is also what lights the disc, so at the
                 * exact moment the pill goes translucent there is a saturated
                 * gradient directly behind it. Measured at 1280×720 the fill
                 * went from `rgb(20,21,26)` to `rgb(38,40,46)` and picked up
                 * the disc's hue, which is a control whose colour is decided
                 * by a decoration.
                 *
                 * The lift replaces it. `--shadow-lg` is a token, it reads at
                 * a glance, and it is still there when the disc is not — under
                 * reduced motion, or with the motion control pressed, where an
                 * opacity change would have been the only feedback and the
                 * disc cannot give any.
                 */
                className="landing-cta hover:opacity-100 hover:shadow-[var(--shadow-lg)]"
                onPointerEnter={nextBurst}
                onFocus={nextBurst}
              >
                <a href="#signin">{t('login.cta')}</a>
              </Button>

              {/*
                One solid pill and one quiet second, which is the shape every
                reference in the set uses. They are not two ways to the same
                place dressed up as a choice: the primary is the marketing
                verb and the secondary is what an operator who already has an
                account is looking for, and an operator who reads "Get started"
                and hesitates is exactly the person the second one is for. Both
                land on the same form because there is only one, and that is
                honest rather than redundant — the form asks who you are.
              */}
              {/*
                `secondary` and not `ghost`. A ghost is a label and nothing
                else, and this label stands on the disc: measured at 1280×720
                with the rays lit, `--muted-foreground` on a spoke read under
                the floor and the word simply went missing. The ink outline is
                the console's own quiet-second treatment, it draws a boundary
                the disc cannot erase, and it inverts to a filled ink block on
                hover — which is the same punch the primary has, one step down.
              */}
              <Button variant="secondary" size="lg" asChild>
                <a href="#signin">{t('login.ctaSecondary')}</a>
              </Button>
            </div>
            </div>
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
              Pause, Stop, Hide — the mechanism, not the old pill.

              WCAG 2.2 SC 2.2.2 needs a way to stop motion that runs for more
              than five seconds, and the drift runs forever. It used to be a
              labelled pill in the middle of the hero, which is the loudest
              possible answer to a requirement about not being distracting;
              the product owner's word for it was unprintable and he was
              right. It is a 36px glyph in the bottom corner now, with the
              same accessible name it always had, the same `aria-pressed`, the
              same place in the tab order and the same effect on both the
              drift and the disc. Nothing about the mechanism moved except how
              much of the screen it takes.

              Not rendered under reduced motion, because nothing is moving for
              it to stop.
              --------------------------------------------------------------- */}
          {reduced ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-pressed={paused}
              aria-label={t(paused ? 'login.resumeMotion' : 'login.pauseMotion')}
              onClick={() => setPaused((was) => !was)}
              className="absolute bottom-5 right-5 sm:bottom-6 sm:right-6"
            >
              <MotionGlyph paused={paused} />
            </Button>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------
          The band.

          A horizontal marquee of one true sentence, taken as *structure* from
          the product owner's reference and not as styling. "Paid per reviewed
          minute" is the platform's actual unit of payment — the thing this
          whole console exists to compute — so the one line that repeats across
          the screen is a claim the product keeps rather than a decorative
          word.

          It is `aria-hidden`, and the same sentence sits once in the document
          as visually-hidden text directly above it. A screen reader hears the
          claim once; a marquee announced eight times is a marquee nobody
          finishes.

          Not rendered at all under reduced motion. The band IS the motion —
          a still strip of the same four words repeated is a worse thing than
          no strip, and the sentence is still in the document for a reader.
          --------------------------------------------------------------- */}
      <div ref={band} data-motion={paused ? 'paused' : undefined}>
        <p className="sr-only">{t('login.marquee')}</p>
        {reduced ? null : (
          <div className="band py-7 lg:py-10" aria-hidden="true">
            <div className="band-track">
              {/*
                Eight copies: two identical halves of four, because the loop
                translates by exactly half the track and lands on a copy of its
                own first frame. An odd count leaves a seam.
              */}
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="flex items-center">
                  <span className="band-word">{t('login.marquee')}</span>
                  <span className="band-dot" />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

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
          {/* ---------------------------------------------------------------
              The spiral: circular type turning on the dark half.

              The reference sets a hard light/dark split with a large rotating
              circular type element in the dark half, and this screen already
              had the split — the film band is `.on-stage`, near-black in both
              themes, for the reason `DESIGN.md` gives about footage. So the
              signature moment costs one `<svg>` and a rotation, and it goes
              exactly where the reference puts it.

              What is not taken from that reference: its tracked mono eyebrows.
              `--font-mono` is reserved for `.num` measurements here and
              monospace as a costume for "technical" is refused; this is the
              display face, which is what the words are.

              `--stage-mid` and not `--stage-over`: it is a mark on the film,
              not a caption, and it must not compete with either Trúc below it
              or the sign-in opposite. Hidden below `lg`, where the film band
              is 30svh and there is no room for it.
              --------------------------------------------------------------- */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-8 top-1/2 hidden -translate-y-1/2 lg:block xl:right-14"
          >
            <svg width={188} height={188} viewBox="0 0 200 200" className="spiral" fill="none">
              <defs>
                <path
                  id="spiral-path"
                  d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0"
                />
              </defs>
              <text
                fill="var(--stage-mid)"
                fontSize="15.5"
                fontWeight={500}
                letterSpacing="0.02em"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                <textPath href="#spiral-path">{t('login.spiral')}</textPath>
              </text>
              <circle cx="100" cy="100" r="52" stroke="var(--stage-line)" strokeWidth="1" />
            </svg>
          </div>

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
          ref={panel}
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
              {/*
                Headline scale, so it takes the display face and the same
                discipline the slogan does: one step lighter than the old
                `extrabold` and tracked in rather than out. `font-display` is
                the Tailwind utility over `--font-display`; the two other
                pieces of type on this column — the `h2` and the sentence
                under it — stay Be Vietnam Pro, because they are the UI voice
                and not a headline.
              */}
              <h1 data-arrive className="sr-only lg:not-sr-only lg:text-balance lg:font-display lg:text-[2.25rem] lg:font-medium lg:leading-[1] lg:tracking-[-0.035em]">
                PlayerOne
              </h1>
              {/*
                The title follows the role, the way the sentence under it
                already did. "Sign in to review" was shown to the upload-centre
                operator in all three languages, and an operator imports TF
                cards and reviews nothing.
              */}
              {/*
                The panel's pacing, and it was the second thing the product
                owner called weird.

                Three pieces of type, and between them they had five different
                rhythms: the heading's leading was 1.05 while the title's was
                the body default, the sentence under the title was
                `leading-snug` below `lg` and `leading-relaxed` above it — the
                same paragraph paced two different ways at two widths, for no
                reason anybody could name — and the gaps were `mt-1` and
                `mt-1.5`, which are 4px and 6px and read as neither.

                One leading for the sentence at every width, tracking that
                tightens with size the way the landing's does, and gaps from
                the space scale: 8px from the heading to the title, 8px from
                the title to its sentence. The heading is a size apart and does
                not need a third number to say so.
              */}
              <h2 data-arrive className="text-[1.3125rem] font-semibold leading-[1.15] tracking-[-0.022em] lg:mt-2">
                {t(reviewer ? 'login.title' : 'login.titleOperator')}
              </h2>
              <p data-arrive className="mt-2 max-w-[42ch] text-[0.875rem] leading-[1.55] text-[var(--muted-foreground)]">
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
                <fieldset data-arrive className="flex flex-col gap-2">
                  <legend className="mb-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--faint-foreground)]">
                    {t('login.role')}
                  </legend>
                  {/*
                    One pill track with two equal segments, not two buttons with
                    a gap between them. The track is what says "these two are
                    the same question"; a gap says "these are two decisions".
                  */}
                  <div
                    role="presentation"
                    className={segmentedTrack()}
                  >
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

                <div data-arrive className="pt-1">
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
 * Pause and play, on the same 20x20 grid and the same 1.9 stroke as
 * `components/icons.tsx`.
 *
 * ponytail: authored here rather than added to the shared icon file, because
 * this is the only screen in the console with something to pause and the
 * shared file is being edited by somebody else this session. Move it there
 * the moment a second screen wants it.
 */
function MotionGlyph({ paused }: { paused: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {paused ? (
        <path
          d="M7 4.5 15.5 10 7 15.5Z"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinejoin="round"
        />
      ) : (
        <g stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
          <path d="M7.5 4.75v10.5" />
          <path d="M12.5 4.75v10.5" />
        </g>
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------
   Three more controls in the project's shadcn anatomy.

   `cva` variants, token values, every state declared — the same shape as
   `components/ui/button.tsx`, so a reader fluent in shadcn reads them without
   a translation layer and so they lift into `components/ui/` as
   `input.tsx` and `segmented.tsx` in one move.

   **They are here and not there on purpose, and it is an ownership decision
   rather than a design one.** `components/ui/` is shared and is being edited
   by somebody else this session; these were hand-rolled inline on this screen
   before, so moving them into a `cva` here is a strict improvement that
   cannot collide. ponytail: promote them the moment a second screen wants
   either one — the sign-in on the collector app is the obvious next caller.
   ---------------------------------------------------------------------- */

/**
 * The field.
 *
 * 48px, one hairline, a 12px radius, and the sun focus ring the rest of the
 * console uses. That outline is the global `:focus-visible` rule in
 * `globals.css`, so this must NOT suppress it: the border and the ring are
 * different jobs, the border saying "a field" and the ring saying "the
 * keyboard is here".
 *
 * `scroll-mb-40` is what the browser's own scroll-into-view honours, and it
 * works for both scrollers on this screen — the form column and the document.
 * WCAG 2.2 SC 2.4.11.
 *
 * `invalid` is declared even though nothing sets it yet, because a control
 * shipped with half its states is how a tool starts feeling unfinished, and
 * because the server's refusal has to have somewhere to land when it names a
 * field.
 */
const input = cva(
  cn(
    'num h-12 w-full scroll-mb-40 rounded-[var(--radius-base)] border bg-[var(--card)] px-4',
    'text-[0.9375rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
    'transition-colors duration-150 ease-[var(--ease)]',
    'disabled:cursor-not-allowed disabled:opacity-45',
  ),
  {
    variants: {
      tone: {
        default: cn(
          'border-[var(--field-border)]',
          'hover:border-[var(--foreground)]',
          'focus:border-[var(--foreground)]',
        ),
        invalid: cn('border-[var(--reject)]', 'focus:border-[var(--reject)]'),
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

/**
 * The segmented control's track, and its two segments.
 *
 * One pill track with two equal halves, not two buttons with a gap between
 * them: the track is what says "these two are the same question", and a gap
 * says "these are two decisions". Underneath it is still a real `<fieldset>`
 * of radios, so arrow keys move between them, the browser enforces that
 * exactly one is chosen, and it works before any script has run.
 */
const segmentedTrack = cva(
  cn(
    'flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border)]',
    'bg-[var(--muted)] p-1',
  ),
);

const segment = cva(
  cn(
    'flex h-9 flex-1 cursor-pointer items-center justify-center rounded-[var(--radius-pill)] px-3',
    'text-[0.875rem] font-semibold transition-colors duration-150 ease-[var(--ease)]',
    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
  ),
  {
    variants: {
      state: {
        on: 'bg-[var(--foreground)] text-[var(--background)]',
        off: 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
      },
    },
    defaultVariants: { state: 'off' },
  },
);

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
    <fieldset data-arrive className="flex flex-col gap-5">
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
    <label className={segment({ state: checked ? 'on' : 'off' })}>
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
        className={input()}
      />
    </label>
  );
}
