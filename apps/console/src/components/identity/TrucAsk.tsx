/**
 * Trúc as a thing you can ask, standing where he does not cover the film.
 *
 * He was 520px in the middle of the demo panel, which drew a cartoon panda
 * across the face of the collector the film is about, in every language and at
 * every scroll position. A mascot that covers the product is not a mascot. So
 * he keeps everything he was — the glTF model, the cursor tracking, the hop
 * when you press him — and moves into the corner the composition does not use.
 *
 * **He is still the 3D stage.** Same `PandaStage`, same `truc.glb`, same
 * camera, so he watches the pointer across the page and leans toward it, and a
 * press still makes him greet. What changed is where he stands and that the
 * press now opens something. `React.lazy` keeps three.js out of the chunk
 * `/review` loads, exactly as before, and the flat `Panda` holds his place at
 * the same size while that chunk arrives so nothing shifts when it does.
 *
 * **Nothing is wired up behind the dialogue, on purpose.** There is no model
 * answering and there is not going to be one this sprint, so the panel says so
 * in its own copy rather than presenting an input that swallows what somebody
 * types. A box that accepts a question and never answers it is worse than no
 * box, and an operator at a counter with a queue is exactly the person who
 * would try it. When a model arrives, the composer goes under `login.trucBody`
 * and this paragraph comes out.
 *
 * **A `<dialog>`, not a floating panel.** `showModal()` brings the focus trap,
 * the inert background, the Escape key and the top layer, which are the four
 * parts people get wrong by hand. The console's coach mark already uses one,
 * so this is a second instance of a pattern rather than a new one.
 */
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Panda } from './Panda.tsx';
import { Button } from '../ui/button.tsx';
import { cn } from '../../lib/cn.ts';

const PandaStage = lazy(() =>
  import('./PandaStage.tsx').then((m) => ({ default: m.PandaStage })),
);

/**
 * His canvas, and the number is larger than he looks.
 *
 * `PandaStage` normalises any model into a two-unit box against a camera whose
 * visible plane is about 3.9 units, so a panda whose widest dimension is his
 * arms fills roughly 40% of the square he is given: 176px of canvas is about
 * 70px of drawn panda. Big enough that the turn of his head toward the cursor
 * reads, small enough that he sits in the corner of the film rather than in
 * front of it.
 */
const SIZE = 176;

export function TrucAsk({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);

  /*
   * Focus goes back to him. A `<dialog>` restores focus itself when it closes
   * the way it was opened, but the light-dismiss path below closes it by
   * script, which does not count. Doing it here covers both.
   */
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    const restore = () => host.current?.querySelector('button')?.focus();
    el.addEventListener('close', restore);
    return () => el.removeEventListener('close', restore);
  }, []);

  const open = () => dialog.current?.showModal();

  return (
    <div ref={host} className={className}>
      <div className="relative">
        {/*
          `PandaStage` becomes a real button when it is given something to do:
          it takes focus, answers Enter and Space, carries the label as its
          accessible name, and still runs the greeting a tap has always run.
        */}
        <Suspense fallback={<Panda size={SIZE} />}>
          <PandaStage size={SIZE} label={t('login.trucOpen')} onPress={open} />
        </Suspense>

        {/*
          The affordance, because a panda standing on a photograph is not
          self-evidently a control.

          It is `aria-hidden` and not a second label: the button already has
          one, and a screen reader announcing "Ask Trúc, Ask Trúc" is the same
          stutter that the field labels on this screen were just fixed for. It
          is decoration that says out loud what the button already means.
        */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap',
            'rounded-[var(--radius-pill)] border border-white/20 px-2.5 py-1',
            'bg-[color-mix(in_srgb,var(--stage)_72%,transparent)] backdrop-blur-sm',
            'text-[0.6875rem] font-semibold text-[var(--stage-over)]',
          )}
        >
          {t('login.trucOpen')}
        </span>
      </div>

      <dialog
        ref={dialog}
        /*
         * Light dismiss. A `<dialog>`'s backdrop is a pseudo-element of the
         * dialog itself, so a press on it lands on the dialog — the way to
         * tell the two apart is that a press on the backdrop has the dialog as
         * its target and a press on the panel has something inside it.
         */
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className={cn(
          /*
           * `m-auto` is not a nicety. A modal `<dialog>` is centred by the UA
           * stylesheet's `margin: auto`, and Tailwind's preflight resets
           * margins on every element — so without this it renders in the
           * top-left corner of the viewport, which is where it first shipped.
           */
          'm-auto w-[min(26rem,calc(100vw-2rem))] rounded-[var(--radius-xl)] border border-[var(--border)]',
          'bg-[var(--card)] p-0 text-[var(--foreground)] shadow-[var(--shadow-lg)]',
          'backdrop:bg-[var(--scrim)]',
        )}
        aria-labelledby="truc-title"
      >
        <div className="flex flex-col gap-5 p-6">
          <div className="flex items-center gap-3">
            <Panda size={44} />
            <div className="flex flex-col gap-1">
              <h2 id="truc-title" className="text-[1.0625rem] font-bold tracking-[-0.01em]">
                {t('login.trucTitle')}
              </h2>
              {/*
                The status, in the system's own ink and not dressed as a
                warning. Nothing has gone wrong; something has not been built
                yet, and those are different sentences.
              */}
              <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-[var(--tech-ink)]">
                {t('login.trucSoon')}
              </p>
            </div>
          </div>

          <p className="text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">
            {t('login.trucBody')}
          </p>

          <Button
            type="button"
            variant="secondary"
            size="md"
            className="self-end"
            onClick={() => dialog.current?.close()}
          >
            {t('login.trucClose')}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
