/**
 * The guided tour: a spotlight, a sentence, and Trúc standing next to the thing.
 *
 * Operators meet this console once, on a shift, with a queue already waiting.
 * The shape of it cannot be guessed — the two figures in the bar are the
 * programme's bottleneck, the value on Home is that person's own decisions and
 * not a budget, and several destinations in the nav are honest stubs. So the
 * tour is four or five sentences per screen, each one standing beside the
 * element it is about, and it is entirely optional: a button in the bar, plus
 * one offer on Home, once per browser, dismissible.
 *
 * **A real `<dialog>`.** Focus trapping, the top layer and Escape come from the
 * platform rather than from a hand-rolled modal, and the focus returns to the
 * trigger on close, which is the part hand-rolled modals always miss.
 *
 * **The spotlight is one box-shadow.** A `9999px` spread of the scrim colour
 * around a transparent, rounded box: the "cut-out" is the box itself, so there
 * is no second element to keep aligned and no clip-path to recompute. The rect
 * is re-read on scroll, on resize and on every step.
 *
 * **Keys stop here.** Every key event is stopped natively at the dialog
 * element, in the bubble phase, before it can reach the window listener the
 * review screen installs. React's `stopPropagation` would not do it: React
 * delegates to the root container, and the native event carries on to `window`
 * regardless. See `useGuide.ts` for the other half of the guarantee.
 *
 * **`/review` is different in two ways and only two.** The tour never starts by
 * itself there, and the panda does not come — `PandaStage` renders nothing on
 * that route, and the tour is simply a card and a spotlight.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button.tsx';
import { useGuide } from './useGuide.ts';
import type { GuidePlacement } from './steps.ts';

/**
 * Its own chunk, and it must stay that way: this import is the only route from
 * the shell into three.js, and `/review` never renders the component behind it.
 */
const PandaStage = lazy(() =>
  import('../identity/PandaStage.tsx').then((m) => ({ default: m.PandaStage })),
);

/** The gap between the spotlight and the card, and the spotlight's own padding. */
const PAD = 8;
const GAP = 14;
const CARD = { width: 340, height: 190 };

function place(rect: DOMRect, placement: GuidePlacement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, 12), Math.max(12, vw - CARD.width - 12));
  const clampY = (y: number) => Math.min(Math.max(y, 12), Math.max(12, vh - CARD.height - 12));

  /* The requested side, unless it would put the card off screen. */
  const below = rect.bottom + GAP + CARD.height < vh;
  const above = rect.top - GAP - CARD.height > 0;
  const side =
    placement === 'top' && !above
      ? 'bottom'
      : placement === 'bottom' && !below
        ? 'top'
        : placement;

  switch (side) {
    case 'top':
      return { left: clampX(rect.left), top: clampY(rect.top - GAP - CARD.height) };
    case 'left':
      return { left: clampX(rect.left - GAP - CARD.width), top: clampY(rect.top) };
    case 'right':
      return { left: clampX(rect.right + GAP), top: clampY(rect.top) };
    default:
      return { left: clampX(rect.left), top: clampY(rect.bottom + GAP) };
  }
}

export function Guide({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  const { open, index, steps, step, next, back, stop } = useGuide();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  /* Where the current step's element is, now. */
  const measure = useCallback(() => {
    if (!step) return setRect(null);
    const element = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
    setRect(element ? element.getBoundingClientRect() : null);
  }, [step]);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, measure]);

  /* Open and close the platform dialog, and give the focus back afterwards. */
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      opener.current = document.activeElement as HTMLElement | null;
      node.showModal();
    } else if (!open && node.open) {
      node.close();
      opener.current?.focus?.();
      opener.current = null;
    }
  }, [open]);

  /* A tour is about one screen. Navigating away ends it rather than lying. */
  useEffect(() => {
    if (open) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /* And an unmount ends it too, so the signal can never outlive the dialog. */
  useEffect(() => stop, [stop]);

  /*
   * The native key listener. Bubble phase on the dialog element itself, so the
   * event is stopped one node below `window` — including the Enter or Escape
   * that closes the tour, which would otherwise commit a verdict on its way out.
   */
  useEffect(() => {
    const node = dialog.current;
    if (!node || !open) return;
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      switch (event.key) {
        case 'ArrowRight':
        case 'Enter':
          event.preventDefault();
          next();
          return;
        case 'ArrowLeft':
          event.preventDefault();
          back();
          return;
        case 'Escape':
          event.preventDefault();
          stop();
          return;
        default:
          return;
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [open, next, back, stop]);

  const last = index + 1 >= steps.length;
  const card = rect ? place(rect, step?.placement ?? 'bottom') : null;

  return (
    <dialog
      ref={dialog}
      aria-label={t('guide.title')}
      onCancel={(event) => {
        event.preventDefault();
        stop();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-[var(--foreground)] backdrop:bg-transparent"
    >
      {open ? (
        <>
          {/* The spotlight. One element, one shadow, no clip path. */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-[var(--radius-base)] transition-[top,left,width,height] duration-200 ease-[var(--ease)]"
            style={
              rect
                ? {
                    top: rect.top - PAD,
                    left: rect.left - PAD,
                    width: rect.width + PAD * 2,
                    height: rect.height + PAD * 2,
                    boxShadow: '0 0 0 9999px var(--scrim)',
                    outline: '2px solid var(--sun-500)',
                  }
                : { inset: 0, boxShadow: '0 0 0 9999px var(--scrim)' }
            }
          />

          {/*
            Trúc walks to the element and looks at it. He is absent on /review
            — `PandaStage` returns null there — so this needs no branch.
          */}
          {rect ? (
            <Suspense fallback={null}>
              <PandaStage mood="pointing" anchor={rect} label={t('guide.panda')} />
            </Suspense>
          ) : null}

          <section
            className="fixed rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-lg)]"
            style={card ? { ...card, width: CARD.width } : { right: 24, bottom: 24, width: CARD.width }}
          >
            <p className="num text-[0.75rem] font-medium text-[var(--faint-foreground)]">
              {t('guide.step', { current: index + 1, total: steps.length })}
            </p>
            <p className="mt-2 text-[0.9375rem] leading-relaxed">
              {step ? t(step.key) : null}
            </p>
            {!rect ? (
              <p className="mt-2 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
                {t('guide.offscreen')}
              </p>
            ) : null}
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={stop}>
                {t('guide.close')}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={back} disabled={index === 0}>
                  {t('guide.back')}
                </Button>
                <Button variant="primary" size="sm" onClick={next} autoFocus>
                  {last ? t('guide.done') : t('guide.next')}
                </Button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </dialog>
  );
}
