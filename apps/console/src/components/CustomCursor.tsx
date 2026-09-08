/**
 * The signature: the pointer becomes a lens.
 *
 * Ported from the product owner's own portfolio
 * (`PortfolioWebsite/src/app/components/CustomCursor.tsx`) rather than
 * reinvented. Four landings were rejected for running six effects at once; the
 * decision this build is held to is **one signature interaction and everything
 * else quiet**, and this is it. The mechanics below are his — the sizes, the
 * two lerp rates, the eased growth, the single `requestAnimationFrame` loop,
 * the cloned element revealed through a radial mask — and the three things that
 * changed are named where they happen.
 *
 * ## What it does
 *
 * A 12px dot follows the pointer. Over anything carrying
 * `[data-cursor-highlight]` it grows to 140px, and inside that disc a **clone
 * of the hovered element is drawn in the accent** through a `radial-gradient`
 * mask pinned to the disc — so the label under the lens reads in lime on ink
 * while the same label outside it stays in the page's own ink.
 * `data-cursor-highlight="circle"` renders a plain accent disc with no content.
 *
 * ## What changed from the portfolio, and why
 *
 * 1. **The accent is a token.** `#f4a89a` is his palette; this one reads
 *    `--lime-500` off the cascade, which is the one highlight colour this world
 *    allows, and the disc is `--stage`, the console's single near-black. That
 *    pair is the same two values `DESIGN.md` already measures at 13.5:1 for the
 *    headline marker, and `packages/design/test/contrast.test.ts` pins it.
 *
 * 2. **The mask radius tracks the disc, frame by frame.** His mask is a fixed
 *    70px circle while the disc is still growing through 12 to 140, so for the
 *    length of the growth the revealed clone spills past the ink and lands on
 *    the page ground: lime on near-white, which is about 1.6:1. Setting
 *    `--cursor-r` from the same eased size that draws the disc makes the mask
 *    and the ink the same circle on every intermediate frame, so there is no
 *    frame where accent type is drawn on anything but `--stage`. This is the
 *    one correctness fix in the port and it is not optional — the page is
 *    payout-bearing and an intermediate frame is a frame somebody reads.
 *
 * 3. **The overlay is `inert` as well as `aria-hidden`.** A live clone of a
 *    button, carrying that button's own text, sitting in the accessibility tree
 *    is a duplicate control; `inert` takes it out of hit-testing and out of the
 *    tab order as well as out of the tree.
 *
 * 4. **The loop idles out.** His schedules `requestAnimationFrame` from mount
 *    and never cancels, so it runs for as long as the tab is open with nothing
 *    to draw. Here it stops as soon as the disc is within a quarter of a pixel
 *    of where it is going, and `mousemove`, `scroll` and `resize` start it
 *    again. See `wake` for the measurement that forced this.
 *
 * ## What it must never cost
 *
 * - **The pointer is never lagged.** The lerp is on the *decoration*. Hit
 *   testing, `:hover`, focus and clicks are the browser's, at the real
 *   coordinates, on the real elements; nothing here calls `preventDefault` and
 *   both layers are `pointer-events: none`.
 * - **The native cursor is only hidden while this is mounted and painting.**
 *   The rule in `globals.css` is keyed on `:root[data-cursor='on']`, which this
 *   component sets when it starts and removes when it stops — so a browser that
 *   never ran the effect, a reader who asked for reduced motion, and a touch
 *   device all keep the cursor the operating system gave them.
 * - **Focus is untouched.** Every `[data-cursor-highlight]` target on
 *   `/discover` is a real `<a>`, `<button>` or `<summary>` and takes the
 *   console's one focus ring from `:focus-visible`. The lens is a pointer
 *   affordance and the keyboard path does not know it exists.
 *
 * ## Where it does not run
 *
 * Coarse pointers, viewports under 768px, and `prefers-reduced-motion: reduce`.
 * The gate is a live `matchMedia` listener rather than a read at mount, so an
 * operator who turns reduced motion on mid-session gets the native cursor back
 * without a reload. **There is no mobile substitute and there must not be one**
 * — the phone page stands on its composition and its type, which is the whole
 * argument of this build.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SIZE = 12;
const SIZE_BIG = 140;
/** His two rates: slower while large, so a 140px disc does not skate. */
const LERP = 0.18;
const LERP_BIG = 0.12;
/** The eased growth, per frame. */
const GROW = 0.15;
/**
 * Sub-pixel. Below this the disc has arrived and the loop stops.
 *
 * A quarter of a pixel is under the smallest step any display can draw and well
 * under the smallest step this page's `deviceScaleFactor` of 1 can composite, so
 * the frame that settles is visually identical to the frame that would follow
 * it. See `wake` for why stopping matters.
 */
const SETTLE = 0.25;

/** Fine pointer, desktop width, and nobody has asked for stillness. */
const QUERY = '(min-width: 768px) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

export function CustomCursor() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia(QUERY);
    const read = () => setOn(q.matches);
    read();
    q.addEventListener('change', read);
    return () => q.removeEventListener('change', read);
  }, []);

  return on ? <Lens /> : null;
}

function Lens() {
  const disc = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const clone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const discEl = disc.current;
    const overlayEl = overlay.current;
    const cloneEl = clone.current;
    if (discEl === null || overlayEl === null || cloneEl === null) return;

    /*
     * The accent, off the cascade rather than out of this file. `--lime-500` is
     * the same value in both schemes, which is why the disc can be `--stage` in
     * both without a second measurement.
     */
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--lime-500').trim() ||
      'currentColor';

    document.documentElement.dataset.cursor = 'on';

    let mouseX = -200;
    let mouseY = -200;
    let x = -200;
    let y = -200;
    let size = SIZE;
    let over = false;
    let raf = 0;
    let last: HTMLElement | null = null;
    let signature = '';

    /**
     * Wake the loop, and only if it is not already awake.
     *
     * The portfolio's version schedules `requestAnimationFrame` unconditionally
     * from mount and never cancels, which is a loop that runs for as long as the
     * tab is open whether or not anything is moving. On a real machine that is a
     * flat battery and a warm phone; measured in headless Chrome, which does not
     * vsync-throttle rAF, one such page held **85.7% of twelve cores** and
     * OOM-killed both dev servers during a screenshot pass.
     *
     * So the loop here is demand-driven: `frame` stops scheduling once the disc
     * and its size are both within a quarter of a pixel of their targets, and
     * these three events start it again. `scroll` and `resize` are in the list
     * because the clone is positioned from a viewport rect: a settled lens over
     * a link that then scrolls would otherwise leave its reveal behind.
     */
    const wake = () => {
      if (raf === 0) raf = requestAnimationFrame(frame);
    };

    const onMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      const target = event.target as HTMLElement | null;
      over = target?.closest?.('[data-cursor-highlight]') != null;
      wake();
    };

    const frame = () => {
      const want = over ? SIZE_BIG : SIZE;
      size += (want - size) * GROW;
      const lerp = over ? LERP_BIG : LERP;
      x += (mouseX - size / 2 - x) * lerp;
      y += (mouseY - size / 2 - y) * lerp;

      /*
       * Settled: snap to the exact target and paint that, so the last frame of
       * a movement is the true position rather than whatever the lerp had
       * reached when it fell under the threshold.
       */
      const done =
        Math.abs(want - size) < SETTLE &&
        Math.abs(mouseX - size / 2 - x) < SETTLE &&
        Math.abs(mouseY - size / 2 - y) < SETTLE;
      if (done) {
        size = want;
        x = mouseX - size / 2;
        y = mouseY - size / 2;
      }

      discEl.style.width = `${size}px`;
      discEl.style.height = `${size}px`;
      discEl.style.transform = `translate(${x}px, ${y}px)`;

      /* The mask is the disc. See note 2 at the top of this file. */
      overlayEl.style.setProperty('--cursor-x', `${x + size / 2}px`);
      overlayEl.style.setProperty('--cursor-y', `${y + size / 2}px`);
      overlayEl.style.setProperty('--cursor-r', `${size / 2}px`);
      /* Fade with the growth, so nothing appears at a size it cannot cover. */
      overlayEl.style.opacity = String(Math.max(0, Math.min(1, (size - SIZE) / (SIZE_BIG - SIZE))));

      if (over) {
        const under = document.elementFromPoint(mouseX, mouseY) as HTMLElement | null;
        const target = under?.closest?.('[data-cursor-highlight]') as HTMLElement | null;
        if (target) {
          const rect = target.getBoundingClientRect();
          cloneEl.style.left = `${rect.left}px`;
          cloneEl.style.top = `${rect.top}px`;
          cloneEl.style.width = `${rect.width}px`;
          cloneEl.style.height = `${rect.height}px`;

          /*
           * Rebuild only when the target actually changes — his guard, kept,
           * because re-parsing `innerHTML` at 60fps is how a decoration starts
           * costing frames. `lang` joined the signature here: switching the
           * console between `en`, `vi` and `zh` swaps the label inside an
           * element that is otherwise the same node at the same size, and
           * without it the lens would keep revealing the previous language.
           */
          const circle = target.getAttribute('data-cursor-highlight') === 'circle';
          const next = [
            circle ? '1' : '0',
            `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            target.innerHTML.length,
            document.documentElement.lang,
          ].join('|');

          if (last !== target || signature !== next) {
            last = target;
            signature = next;
            build(cloneEl, target, circle, accent);
          }
        } else if (last !== null) {
          last = null;
          signature = '';
        }
      }

      /* Nothing left to move: stop asking for frames until something wakes it. */
      raf = done ? 0 : requestAnimationFrame(frame);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', wake, { passive: true });
    wake();

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', wake);
      if (raf !== 0) cancelAnimationFrame(raf);
      delete document.documentElement.dataset.cursor;
    };
  }, []);

  /*
   * A hard-edged mask with a two-pixel feather rather than his `black,
   * transparent` ramp. A long ramp draws the outer half of every glyph at
   * partial alpha over whatever is behind it, which is the same intermediate
   * contrast fault as note 2 in a second form.
   */
  const mask =
    'radial-gradient(circle var(--cursor-r) at var(--cursor-x) var(--cursor-y),' +
    ' #000 0 calc(100% - 2px), transparent 100%)';

  return createPortal(
    <>
      <div
        ref={overlay}
        aria-hidden="true"
        inert
        className="pointer-events-none fixed inset-0 z-[9999]"
        style={{
          maskImage: mask,
          WebkitMaskImage: mask,
          opacity: 0,
        }}
      >
        <div ref={clone} className="absolute overflow-hidden whitespace-nowrap" />
      </div>
      <div
        ref={disc}
        aria-hidden="true"
        inert
        className="pointer-events-none fixed left-0 top-0 z-[9998] rounded-full"
        style={{
          width: SIZE,
          height: SIZE,
          transform: 'translate(-200px, -200px)',
          background: 'var(--stage)',
          /*
           * The rim is what keeps the replacement visible on the ink panels.
           * A near-black disc on `--stage` in section four, or on the dark
           * scheme's own near-black page, is a pointer the reader has lost —
           * and hiding the native cursor without a visible replacement is the
           * one thing this effect is not allowed to do.
           */
          boxShadow: '0 0 0 2px var(--stage-over), 0 2px 8px rgba(0,0,0,.35)',
        }}
      />
    </>,
    document.body,
  );
}

/**
 * Draw the hovered element again, in the accent, inside the lens.
 *
 * The computed padding, font, gap and alignment are copied so the clone lands
 * on the same baseline as the original underneath it — the effect is that one
 * label is lit, not that a second label appeared beside it. Every descendant is
 * forced to the accent, including SVG `currentColor` strokes, which is why an
 * icon inside a button comes through lit rather than as a hole.
 */
function build(clone: HTMLDivElement, target: HTMLElement, circle: boolean, accent: string) {
  if (circle) {
    clone.innerHTML = '';
    Object.assign(clone.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: accent,
      color: 'transparent',
      padding: '0',
      gap: '0',
      borderRadius: getComputedStyle(target).borderRadius,
    });
    return;
  }

  const cs = getComputedStyle(target);
  Object.assign(clone.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: cs.justifyContent === 'normal' ? 'center' : cs.justifyContent,
    gap: cs.gap === 'normal' ? '8px' : cs.gap,
    padding: cs.padding,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    textAlign: cs.textAlign,
    background: 'transparent',
    borderRadius: cs.borderRadius,
    color: accent,
  });

  const html = target.innerHTML.trim();
  if (html === '') {
    clone.textContent =
      target.innerText || target.textContent || target.getAttribute('aria-label') || '';
    return;
  }

  clone.innerHTML = html;
  for (const node of clone.querySelectorAll<HTMLElement>('*')) {
    node.style.color = accent;
    node.style.background = 'transparent';
    node.style.borderColor = 'transparent';
  }
  for (const svg of clone.querySelectorAll<SVGElement>('svg')) {
    (svg as unknown as HTMLElement).style.color = accent;
    svg.setAttribute('stroke', 'currentColor');
  }
}
