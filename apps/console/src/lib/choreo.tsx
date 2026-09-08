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
 * Two behaviours and no more:
 *
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
          (section) => section.getBoundingClientRect().top > window.innerHeight * 0.88,
        );
        gsap.set(below, { opacity: 0, y: 16 });
        ScrollTrigger.batch(below, {
          start: 'top 88%',
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { opacity: 1, y: 0, duration, ease, stagger: duration / 4, overwrite: true }),
        });

        /*
         * The hero's one authored sequence, and it is one timeline.
         *
         * `/discover` opens with a slogan that resolves out of a blur, a
         * column that lifts, and the film frame below it that opens — in that
         * order, as a single tween chain, because the fault the previous four
         * landings shared was three unrelated effects firing at the same
         * moment and reading as noise. A screen with no `[data-choreo-hero]`
         * gets nothing; this is not a second motion system, it is the same one
         * with a first beat.
         *
         * `clipPath` and `filter` are here rather than a second opacity fade
         * because a page whose only vocabulary is transform-and-opacity is
         * what a generated page looks like. Both are composited.
         *
         * Everything it touches is visible at rest and is hidden only by the
         * `from` that is about to clear it, inside the same `matchMedia` that
         * reverts it — so reduced motion, a blocked chunk and a script that
         * threw all leave a complete hero.
         */
        const beat = (name: string) => el.querySelector<HTMLElement>(`[data-choreo-hero="${name}"]`);
        const line = beat('line');
        if (line !== null) {
          const timeline = gsap.timeline({ defaults: { ease, duration: duration * 2.4 } });
          timeline.from(line, { opacity: 0, y: 20, filter: 'blur(10px)' });
          const rest = [beat('lead'), beat('audiences'), beat('actions')].filter(
            (n): n is HTMLElement => n !== null,
          );
          if (rest.length > 0) {
            timeline.from(rest, { opacity: 0, y: 14, stagger: duration / 2 }, `-=${duration}`);
          }
          const film = beat('film');
          if (film !== null) {
            timeline.from(
              film,
              { opacity: 0, y: 40, clipPath: 'inset(0% 0% 100% 0%)', duration: duration * 3 },
              `-=${duration}`,
            );
          }
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
