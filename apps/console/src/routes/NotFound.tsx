/**
 * The not-found page, and the objects fall.
 *
 * ## Why it is a page and not a redirect
 *
 * A mistyped console URL used to fall through to whatever TanStack Router
 * renders by default, which is nothing. Bouncing silently to `/discover`
 * would be worse than nothing: an operator who typed `/setle` would land on a
 * marketing page with no explanation and conclude the console had lost their
 * screen. So the address is named as wrong, once, and the only route out is
 * the one page a signed-out reader is allowed to reach.
 *
 * ## The composition
 *
 * From the reference: giant numerals, and shapes and photographs tumbling
 * around and behind them, cut off by the bottom edge of the frame. Ours are
 * this platform's own objects rather than a moodboard's — the same contact
 * sheet the landing is built on, the same three verdict glyphs, the same
 * stills out of the work grid, and the wash's own steps for the flat shapes.
 * Nothing is invented for this page.
 *
 * ## What the fall costs
 *
 * Nothing, after 1.6 seconds. `.drop` in `globals.css` is a `both`-filled
 * animation that runs **once** and settles; there is no loop, no
 * `requestAnimationFrame`, and no ticker left running behind a tab nobody is
 * looking at. This console has already OOM-killed two dev servers with a
 * permanent rAF loop and the lesson is written into `CustomCursor.tsx`; a
 * decorative page is not the place to pay that bill again.
 *
 * Under `prefers-reduced-motion: reduce` the same rule drops the animation
 * entirely and the objects are simply where they land. The arrangement is
 * composed to read at rest, so nothing is lost — which is the test of whether
 * an entrance animation was decoration or scaffolding.
 *
 * ## Geometry, and the two audits it has to survive
 *
 * The field is `overflow-clip` rather than `overflow-hidden`: a clipped box
 * is not a scroll container, so an object hanging past the bottom edge cannot
 * become scrollable overflow, and `scripts/rhythm.mjs` cannot read it as an
 * element clipping its own content or as horizontal document scroll. Every
 * object is `position: absolute`, which also keeps them out of that script's
 * sibling-gap check: a thing that has fallen out of flow is not in a vertical
 * rhythm and the distance to its neighbour is not a spacing decision.
 *
 * Every object is `aria-hidden`, and the field carries no text. What a
 * screen reader gets is the eyebrow, the sentence and the link — which is the
 * whole of the information on this page.
 *
 * No colour, radius, shadow or duration literal in this file.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { CustomCursor } from '../components/CustomCursor.tsx';
import { Button } from '../components/ui/button.tsx';
import { IconPartial, IconPass, IconReject } from '../components/icons.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { cn } from '../lib/cn.ts';

/**
 * The stills that tumble. Four of the ten in the work grid, all 420x420 and
 * all credited in `CREDITS.json` — none of them a recording the Ego camera
 * made, which is why none of them carries a caption here or anywhere else.
 */
const FALLING_STILLS = [
  'kitchen-chopping.jpg',
  'film-garden.jpg',
  'ironing-hands.jpg',
  'bookshelf.jpg',
] as const;

const SHELL = 'mx-auto w-full max-w-[72rem] px-4 sm:px-6';

const MICRO =
  'font-mono text-[0.6875rem] font-medium uppercase leading-[1.4] tracking-[0.16em] text-[var(--muted-foreground)]';

export function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]">
      <CustomCursor />

      <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6">
        <div
          className={cn(
            'mx-auto flex max-w-[84rem] items-center justify-between gap-3',
            'rounded-[var(--radius-pill)] shadow-[var(--shadow-sm)] glass-bar',
            'py-2 pl-3 pr-2 sm:pl-4',
          )}
        >
          <Link
            to="/discover"
            data-cursor-highlight
            className={cn(
              'inline-flex shrink-0 items-center gap-2.5',
              'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]',
            )}
          >
            <Mark size={24} />
            <span className="font-display text-[1.0625rem] font-bold tracking-[-0.02em]">
              PlayerOne
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <LocaleSwitch />
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <div className={cn(SHELL, 'pb-10 pt-12 sm:pt-16')}>
          <p className={MICRO}>{t('nf.eyebrow')}</p>
          {/*
            Three phrases, three lines, the same setting as the landing's
            headline — because this is the same page family and a not-found
            screen in a different voice reads as a different product's error.
          */}
          {/*
            Smaller than the landing's headline on purpose, and smaller than
            it was. The display type on this page is the **numerals**; a 68px
            sentence above a 192px "404" is two things competing to be the
            biggest object on screen, and it also squeezed the falling field
            to 295px on a 900px window, which is not enough room for anything
            to fall through.
          */}
          <h1 className="m-0 mt-6 text-[1.875rem] sm:text-[2.5rem] lg:text-[3rem]">
            <span className="display-line block font-display font-bold tracking-[-0.04em]">
              {t('nf.title.a')}
            </span>
            <span className="display-line block font-display font-bold tracking-[-0.04em]">
              {t('nf.title.b')}
            </span>
            <span className="display-line block font-display font-bold tracking-[-0.04em]">
              {t('nf.title.c')}
            </span>
          </h1>
          <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.65]">{t('nf.body')}</p>
          <div className="mt-8">
            <Button
              variant="primary"
              size="xl"
              asChild
              data-cursor-highlight
              className="h-auto min-h-14 w-full justify-center whitespace-normal px-6 py-4 text-center sm:h-14 sm:w-auto sm:whitespace-nowrap sm:px-8"
            >
              <Link to="/discover">{t('nf.back')}</Link>
            </Button>
          </div>
        </div>

        <FallingField />
      </main>
    </div>
  );
}

/**
 * The field: the numerals, the shapes and the stills, all falling once.
 *
 * The numerals are `4 0 4` set as three separate blocks rather than as a
 * string, so each can carry its own delay and its own resting angle and the
 * middle one can sit lower than its neighbours — which is what stops the row
 * reading as a heading and starts it reading as three objects that landed.
 *
 * The whole field is `aria-hidden`: "404" is a decoration here, and the page
 * has already said what it means in a sentence a screen reader can read.
 */
function FallingField() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        /* The field takes whatever is left of the viewport and never less
           than 20rem, so the numerals are whole on a laptop and the objects
           still hang past the bottom edge on a phone. */
        'relative isolate w-full flex-1 overflow-clip',
        /*
         * A floor, not a height. `flex-1` gives the field whatever the copy
         * above it leaves, and the floor only matters on a short window. It
         * is deliberately below what a 900px viewport leaves (295px measured
         * at 1440x900), because a floor larger than that makes the document
         * taller than the window and drops the numerals under the fold —
         * which is what 28rem did.
         */
        'min-h-[16rem]',
        'frame-grid',
      )}
    >
      {/* The three numerals. */}
      <Numeral className="left-[6%] top-[30%]" delay={0} spin={-11}>
        4
      </Numeral>
      <Numeral className="left-[36%] top-[38%]" delay={140} spin={4}>
        0
      </Numeral>
      <Numeral className="left-[63%] top-[26%]" delay={70} spin={13}>
        4
      </Numeral>

      {/* Flat shapes, the same three the landing uses. */}
      <Obj className="left-[26%] top-[6%] size-28 rotate-[24deg] bg-[var(--lime-500)]" delay={200} />
      <Obj
        className="left-[52%] top-[16%] size-40 rounded-tr-full bg-[var(--lavender-200)]"
        delay={340}
      />
      <Obj className="right-[6%] top-[6%] size-20 rounded-full bg-[var(--foreground)]" delay={420} />
      <Obj
        className="left-[4%] top-[6%] size-32 rotate-[-12deg] bg-[var(--lavender-200)]"
        delay={520}
      />

      {/* The three verdict glyphs, at the size the landing draws them. */}
      <Obj className="left-[16%] top-[14%] text-[var(--pass)]" delay={480}>
        <IconPass size={56} />
      </Obj>
      <Obj className="left-[45%] top-[48%] text-[var(--partial)]" delay={560}>
        <IconPartial size={52} />
      </Obj>
      <Obj className="right-[26%] top-[80%] text-[var(--reject)]" delay={620}>
        <IconReject size={56} />
      </Obj>

      {/* Stills, tumbling and cut off by the bottom edge. */}
      {FALLING_STILLS.map((file, index) => (
        <Obj
          key={file}
          className={cn(
            'size-28 sm:size-32 lg:size-40',
            /*
             * Placed in the gaps the numerals leave — at 1440 the three
             * glyphs occupy roughly 86–236, 518–653 and 907–1057 CSS pixels
             * — and the right-hand pair is anchored from the **right** edge
             * rather than at a left percentage.
             *
             * That is a measured fix, not a preference. `left-[92%]` on a
             * 160px object is inside the field at 1440 and 45px outside it at
             * 390, and `rhythm.mjs` reported 63/76/93px of horizontal
             * clipping across the three widths. `overflow: clip` stops that
             * reaching the document — no sideways scroll was ever reported —
             * but the element still overflows its own box, which is exactly
             * what that check is for, and an audit you argue with every run
             * is an audit nobody runs. Anchoring from the right makes the
             * inset a fraction of the width the object is measured against.
             *
             * Objects are still cut, but only by the **bottom** edge, which
             * is where the reference cuts them too.
             */
            [
              'left-[18%] top-[62%]',
              'left-[46%] top-[70%]',
              'right-[22%] top-[56%]',
              'right-[6%] top-[26%]',
            ][index],
          )}
          spin={[-9, 12, -6, 15][index]}
          delay={260 + index * 90}
        >
          <img
            src={`/tiles/${file}`}
            alt=""
            width={420}
            height={420}
            loading="lazy"
            decoding="async"
            className="block h-full w-full object-cover"
          />
        </Obj>
      ))}
    </div>
  );
}

/** One of the three numerals. Display face, at the biggest size on the site. */
function Numeral({
  children,
  className,
  delay,
  spin,
}: {
  children: string;
  className?: string;
  delay: number;
  spin: number;
}) {
  return (
    <span
      /*
       * The size and the leading are in the base string and the colour is not
       * set at all, and both of those are a bug fix rather than a preference.
       *
       * `tailwind-merge` lists `leading` as conflicting with `font-size`,
       * because in Tailwind `text-lg` sets both — so `cn('leading-[0.8]
       * text-[7rem]')` drops the leading, and `cn('text-[7rem]',
       * 'text-[var(--foreground)]')` drops the size. Measured: these numerals
       * rendered at `line-height: 336px` against the 224px they asked for,
       * which pushed a 448px field below the fold on a 900px viewport. The
       * ink is inherited from the page instead, which it always was.
       */
      className={cn(
        'drop absolute font-display font-bold tracking-[-0.06em]',
        'text-[7rem] leading-[0.8] sm:text-[9rem] lg:text-[12rem]',
        className,
      )}
      style={{ '--drop-delay': `${delay}ms`, '--spin-to': `${spin}deg` } as CSSProperties}
    >
      {children}
    </span>
  );
}

/** One falling object: a flat shape, a glyph, or a still. */
function Obj({
  children,
  className,
  delay,
  spin = 0,
}: {
  children?: ReactNode;
  className?: string;
  delay: number;
  spin?: number;
}) {
  return (
    <span
      className={cn('drop absolute block', className)}
      style={{ '--drop-delay': `${delay}ms`, '--spin-to': `${spin}deg` } as CSSProperties}
    >
      {children}
    </span>
  );
}
