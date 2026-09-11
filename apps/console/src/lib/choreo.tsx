/**
 * The scroll choreography this console's public and home screens share.
 *
 * Lifted out of `routes/Home.tsx` unchanged when `/discover` was built: two
 * screens now reveal a sequence of sections in reading order, and a second
 * copy of a motion system is how two screens start moving differently.
 */
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';

/**
 * Has this element reached the viewport yet — and it only ever answers once.
 *
 * Two jobs, one observer. The gauge uses it to start its sweep when the ring is
 * on screen, and `TrucPanel` uses it a viewport early to decide when the
 * three.js chunk and the glTF are worth fetching. It latches: a sweep that has
 * run does not run again, and a model that has been loaded is not unloaded
 * behind the operator's back.
 *
 * Neither caller can cost content. The gauge draws its true arc whether or not
 * `seen` ever turns true, and the panel holds the flat panda at the same size
 * until the chunk lands — so a browser with no `IntersectionObserver`, or an
 * observer that never fires, costs a performance and never costs a figure.
 */
export function useOnScreen<T extends HTMLElement>(
  rootMargin = '0px',
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, seen]);

  return [ref, seen];
}

/** A section the choreography picks up. Visible at rest; GSAP finds it by attribute. */
export function Reveal({ children, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <section data-choreo="" {...rest}>
      {children}
    </section>
  );
}

/**
 * The scroll choreography, and the one rule it is built around.
 *
 * **Nothing is hidden by the stylesheet.** Every hidden start state on this
 * screen is set by GSAP, inside `matchMedia`, at the moment it creates the
 * tween that will clear it — so the three ways this goes wrong all fail safe:
 * an operator who asked for no motion never enters the block, a browser that
 * cannot fetch the chunk never runs it, and `matchMedia.revert()` on unmount
 * or on a media change puts the inline styles back. A `.reveal { opacity: 0 }`
 * in CSS has none of those, and this route shipped one.
 *
 * `gsap.matchMedia` rather than a `matchMedia('...').matches` branch: it owns
 * the teardown, so an operator who turns reduced motion on mid-session gets the
 * styles reverted rather than gets whatever frame the tween had reached.
 *
 * The import is dynamic for the same reason `Login.tsx`'s is — a static
 * `import 'gsap'` puts the tween engine in the shared chunk, and `/review` is
 * the one screen in this console where nothing moves at all.
 *
 * Three behaviours and no more:
 *
 * - **the opening sequence** on a screen that declares `[data-choreo-hero]`
 *   beats — slogan, pan, film. `/discover` is the only one. It is documented
 *   where it is built, including the four ways it is allowed to fail.
 * - **the sections rise**, once each, when they reach the lower eighth of the
 *   viewport. **Only the ones that start below it are ever hidden** — a section
 *   already on screen is left alone rather than faded in, because animating
 *   what is already there is a page-load sequence and this screen does not have
 *   one.
 * - **the photograph drifts** against the scroll, scrubbed. It is the one
 *   scrubbed tween on the screen, it moves a picture and never a surface type
 *   is set on, and what travels is the `cover` crop rather than the element,
 *   so nothing overflows its frame at either end of the range.
 *
 * **The refresh is not optional, and leaving it out was measured.** Triggers
 * cache their document positions when they are built, and this page is still
 * growing at that moment: the shift query lands, the ledger fills, the recent
 * table replaces three skeleton rows with as many verdicts as there are, and
 * `TrucPanel` swaps a flat SVG for a three.js canvas. Built once and never
 * refreshed, both below-fold sections held `opacity: 0` through a scroll to the
 * bottom of the page and only began to clear at the very end of it — two
 * sections of a payments screen invisible, which is exactly the failure this
 * whole arrangement exists to make impossible. A `ResizeObserver` on the root
 * calls `ScrollTrigger.refresh()` whenever the page changes height, and the
 * observer is disconnected by the same `revert()` that puts the styles back.
 */
export function useChoreography(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (el === null) return;

    let media: { revert: () => void } | null = null;
    let cancelled = false;

    /*
     * Reduced motion: do not even fetch the engine.
     *
     * Everything below is inside `gsap.matchMedia('(prefers-reduced-motion:
     * no-preference)')`, so for a reader who has asked for stillness the import
     * used to land, register three plugins, start GSAP's ticker and then build
     * nothing. **That ticker is a permanent `requestAnimationFrame` loop**:
     * measured on this route with a counting wrapper, `/discover` ran at 64
     * rAF/s while completely idle — with reduced motion on, where not one tween
     * exists — against 0 rAF/s on `/login`, which imports no GSAP at all. Real
     * browsers throttle those callbacks to vsync and each does almost nothing,
     * but headless Chrome does not throttle rAF, and a verification pass that
     * holds several pages open was measured at 85.7% of twelve cores.
     *
     * A reader who turns motion back on mid-session keeps the complete page
     * they already have rather than gaining the reveals. That is the safe
     * direction of the two, and it is why there is no listener here to re-run.
     */
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    void (async () => {
      const [{ gsap }, { ScrollTrigger }, { CustomEase }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
        import('gsap/CustomEase'),
      ]);
      /* Unmounted while the chunk was in flight: build nothing. */
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger, CustomEase);

      /*
       * The ease and the duration are the tokens, read off the cascade rather
       * than retyped here. GSAP has no `cubic-bezier()` ease of its own, so
       * `--ease` is converted to the path form `CustomEase` takes — the same
       * four control numbers, in the notation the plugin wants — and
       * `--duration-slow` is the milliseconds the rest of the console's slow
       * transitions run at. A hand-picked `power3.out` and a `0.42` would be a
       * second motion system living in a `.tsx`, which is exactly what
       * `tokens.ts` exists to prevent.
       */
      const tokens = getComputedStyle(document.documentElement);
      const curve = tokens.getPropertyValue('--ease').match(/-?[\d.]+/g);
      const ease =
        curve && curve.length === 4
          ? CustomEase.create('playerone', `M0,0 C${curve.join(',')} 1,1`)
          : 'power3.out';
      const duration =
        (Number.parseFloat(tokens.getPropertyValue('--duration-slow')) || 320) / 1000;

      const m = gsap.matchMedia();
      m.add('(prefers-reduced-motion: no-preference)', () => {
        /*
         * `gsap.set` on what is below the start, and nothing on what is not.
         * `gsap.from` would hide every section including the ones already being
         * read, and it hides them at build time whether or not their trigger is
         * ever going to fire.
         */
        const below = [...el.querySelectorAll<HTMLElement>('[data-choreo]')].filter(
          (section) =>
            /* A section the opening sequence owns is not also a scroll reveal.
               The film band is both a `Reveal` and the sequence's third beat,
               and two systems tweening one element's opacity — one of them
               with `overwrite: true` — is how the third beat gets killed
               mid-clip by a trigger firing underneath it. */
            !section.hasAttribute('data-choreo-hero') &&
            section.getBoundingClientRect().top > window.innerHeight * 0.88,
        );
        gsap.set(below, { opacity: 0, y: 16 });
        ScrollTrigger.batch(below, {
          start: 'top 88%',
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { opacity: 1, y: 0, duration, ease, stagger: duration / 4, overwrite: true }),
        });

        /*
         * The opening sequence, and it is one timeline with three named beats.
         *
         * The owner has asked for this composition three times and it has
         * never been built. In his words: a near-white screen carrying **only
         * the slogan**; the type then **slides and pans upward smoothly**,
         * settling near the top; and the demo film's frame is then
         * **gradually revealed beneath it**. So:
         *
         * | Beat | What moves | Which elements |
         * |---|---|---|
         * | 1 | the slogan resolves out of a blur, in place, low on a bare page | `[data-choreo-hero="line"]` |
         * | 2 | it pans up to its resting position | the same element, `y` only |
         * | 3 | the page's furniture arrives and the film frame opens downward | `chrome`, `lead`, `actions`, `film` |
         *
         * ## Four failure paths, and none of them is allowed to cost the page
         *
         * **Nothing is hidden by the stylesheet.** Every start state below is a
         * `gsap.from`, created inside this `matchMedia` block, whose
         * `immediateRender` writes the hidden state at build time and whose
         * `revert()` takes it off again. So a blocked or failed GSAP chunk
         * never runs any of it and the page lands complete — slogan, both
         * calls to action and the film frame all at rest — and
         * `prefers-reduced-motion: reduce` returns before the import even
         * starts. A `.hidden { opacity: 0 }` in CSS has neither escape and this
         * route has shipped one.
         *
         * **The film is on a clock, not on the video.** Beat 3 tweens the
         * band's own `clipPath` and opacity and never waits for `loadeddata`,
         * `canplay` or a `play()` promise. The `<video>` carries a `poster`, so
         * the frame is composed before a byte of video arrives; a slow
         * connection changes what is inside the frame and never whether the
         * sequence finishes.
         *
         * **A reader who scrolls is never fought.** Nothing here touches
         * `scroll-behavior`, `overflow`, or the scroll position, and every
         * property tweened is composited — opacity, transform, clip and blur.
         * Scrolling through the sequence carries the reader past it; it does
         * not stall, snap back, or re-run.
         *
         * `clipPath` and `filter` rather than a third opacity fade, because a
         * page whose only vocabulary is transform-and-opacity is what a
         * generated page looks like. A screen with no `[data-choreo-hero]` —
         * `Home.tsx` — gets none of this.
         */
        const beat = (name: string) => [
          ...el.querySelectorAll<HTMLElement>(`[data-choreo-hero="${name}"]`),
        ];
        /*
         * The sequence is a *page-load* sequence, so it runs only on a page
         * that has just loaded. This is a fifth failure path, and it is the
         * one a blocked chunk does not cover.
         *
         * GSAP is imported dynamically. If the chunk is merely **slow** rather
         * than blocked, the page paints complete and the timeline then hides
         * eight elements of a composition the reader is already reading, to
         * play an opening they have already watched not happen. That is the
         * blank-screen-waiting-for-a-chunk fault arriving late instead of
         * early, and it is worse, because it takes away something that was
         * there. Verified: with the chunk delayed 2.5s, twelve samples over
         * five seconds all read a minimum opacity of 1.00 across every
         * `[data-choreo-hero]` element.
         *
         * Measured on this dev server over three loads: first contentful paint
         * at 376-392ms and the sequence hiding the bar at 414-439ms — a gap of
         * **38 to 47 milliseconds**, two or three frames, which is why the
         * sequence is worth having at all. 600ms is more than twelve times
         * that headroom and still refuses the case this guard is for. A
         * browser that reports no paint entry falls through to running it,
         * which is the same answer a fast load gets.
         */
        const painted = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
        const line = performance.now() - painted < 600 ? beat('line') : [];
        if (line.length > 0) {
          /*
           * How far below its resting place the slogan starts, and every term
           * in it is measured off the live layout rather than chosen.
           *
           * The natural figure is where the block would sit if it were centred
           * in this viewport, which is what "pans upward and settles near the
           * top" describes. On `/discover` at 1440x900 that is **47px** — the
           * hero column is tall enough that its resting place is already near
           * the middle — and a 47px pan on a 345px block is not a pan, it is a
           * nudge. So the floor is 160px, screenshotted at three points and
           * chosen as the smallest travel that reads as movement.
           *
           * `room` is what stops that floor doing damage. Beat one exists to
           * show the slogan **whole** on an otherwise empty screen, so the
           * start position may never be lower than the space actually below
           * the block: on a 600px-tall window the block already reaches the
           * fold, `room` is about zero, and the sequence correctly degrades to
           * a fade with no pan rather than opening on a clipped slogan.
           */
          const box = (line[0] as HTMLElement).getBoundingClientRect();
          const room = window.innerHeight - box.bottom - 24;
          const centred = (window.innerHeight - box.height) / 2 - box.top;
          const lift = Math.max(0, Math.min(Math.max(centred, 160), room, 240));

          const timeline = gsap.timeline({ defaults: { ease } });
          timeline
            /* Beat 1: the slogan, and nothing else on the page. */
            .from(line, { opacity: 0, filter: 'blur(12px)', duration: duration * 1.4 })
            /* Beat 2: the pan. Overlaps the tail of the blur so it reads as one
               movement rather than as a fade followed by a slide. */
            .from(line, { y: lift, duration: duration * 3 }, `-=${duration * 0.5}`)
            .addLabel('settled')
            /* Beat 3. The bar, the eyebrow, the contact sheet, the flat shapes
               and the floating fragments come back together — they are the
               page's furniture and arriving in pieces would read as noise. */
            .from(beat('chrome'), { opacity: 0, duration: duration * 2 }, `settled-=${duration * 1.5}`)
            .from(
              [...beat('lead'), ...beat('actions')],
              { opacity: 0, y: 14, duration: duration * 2, stagger: duration / 2 },
              `settled-=${duration * 1.2}`,
            )
            /* The film frame opens downward, from the settle, so it is the last
               thing that happens and it happens under a slogan that has
               already stopped. */
            .from(
              beat('film'),
              { opacity: 0, clipPath: 'inset(0% 0% 100% 0%)', duration: duration * 4 },
              'settled',
            );
        }

        /* The page is still growing when the triggers are built. See above. */
        const observer = new ResizeObserver(() => ScrollTrigger.refresh());
        observer.observe(el);

        const photo = el.querySelector<HTMLElement>('[data-choreo-photo]');
        if (photo !== null) {
          gsap.fromTo(
            photo,
            { objectPosition: '50% 36%' },
            {
              objectPosition: '50% 64%',
              /* Linear, because a scrubbed tween's curve is the scroll's. */
              ease: 'none',
              scrollTrigger: {
                trigger: photo.parentElement ?? photo,
                start: 'top bottom',
                end: 'bottom top',
                scrub: duration,
              },
            },
          );
        }

        /* `matchMedia`'s own cleanup, so the observer dies with the styles. */
        return () => observer.disconnect();
      });
      media = m;
    })();

    return () => {
      cancelled = true;
      media?.revert();
    };
  }, [root]);
}
