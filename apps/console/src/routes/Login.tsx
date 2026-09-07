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
 * field. Left is the demo film, full bleed, under one flat ink scrim; three
 * short slogans sit on it. Right is paper and carries the form. Trúc stands on
 * the seam.
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
 * **The form is usable before anything moves.** No scroll, no swipe and no
 * animation is a prerequisite for signing in, at any viewport: the fieldsets
 * are in the first screen on a 390px phone and on a 1440px counter machine,
 * the desktop form column is pinned so it never leaves the viewport however
 * far the film half scrolls, and on a phone the submit is pinned to the bottom
 * of the screen so no translation can ever push it under the fold. Everything
 * GSAP does here is layered on top of a page that is already finished, and
 * under `prefers-reduced-motion` no timeline is built at all — all three
 * slogans are simply on screen, which is their default with no script running.
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
 * `apps/console/public/landing.mp4` (10.9s, 1280×720) ships with the console,
 * so the default is the real file and the screen is complete with no
 * environment set. `VITE_LANDING_VIDEO_URL` stays as the seam a deployment
 * uses to point at a longer cut or a CDN copy without a rebuild of this file.
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
        <div className="on-stage relative aspect-video lg:sticky lg:top-0 lg:aspect-auto lg:h-dvh">
          {/*
            The clip box is here and not on the panel, so that Trúc can stand
            ON the seam rather than be cut in half by it. It is 12% taller than
            the panel because the parallax lifts the film 4% of its own height
            and a clip box the exact size of the panel would show the ink under
            it as a band along the bottom edge.
          */}
          <div className="absolute inset-0 overflow-hidden">
            <div ref={film} className="absolute -inset-y-[6%] inset-x-0">
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

          <div className="relative flex h-full flex-col justify-between p-5 sm:p-8 lg:p-14">
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
          <div className="pointer-events-none absolute bottom-0 right-0 z-10 hidden translate-x-1/2 lg:block">
            <Suspense fallback={<Panda size={240} />}>
              <PandaStage mood={mood} size={240} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------
          The paper half. The form is the first thing here and it is reachable
          without scrolling at every viewport.
          --------------------------------------------------------------- */}
      <main className="flex flex-col px-5 pb-0 pt-2 sm:px-10 lg:sticky lg:top-0 lg:h-dvh lg:self-start lg:px-14 lg:py-6">
        <div className="flex items-center justify-end gap-1">
          <LocaleSwitch />
          <ThemeSwitch />
        </div>

        <div className="mx-auto flex w-full max-w-[27rem] flex-1 flex-col justify-center lg:py-8">
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
          <p className="mt-3 hidden max-w-[38ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)] lg:block">
            {t('login.hero')}
          </p>

          <h2 className="text-[1.3125rem] font-bold tracking-[-0.02em] lg:mt-8">
            {t('login.title')}
          </h2>
          <p className="mt-1 max-w-[42ch] text-[0.875rem] leading-snug text-[var(--muted-foreground)] lg:mt-1.5 lg:leading-relaxed">
            {t(reviewer ? 'login.reviewerIntro' : 'login.intro')}
          </p>

          <form
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
              <Fieldset legend={t('login.machine')}>
                <Input
                  name="machine_identifier"
                  label={t('login.machine')}
                  autoComplete="username"
                />
                <Input
                  name="machine_secret"
                  label={t('login.machineSecret')}
                  type="password"
                  autoComplete="current-password"
                />
              </Fieldset>
            )}

            <Fieldset legend={reviewer ? t('login.reviewer') : t('login.operator')}>
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

            {failure ? (
              <p
                role="alert"
                className="rounded-[var(--radius-base)] bg-[var(--reject-bg)] px-3.5 py-2.5 text-[0.875rem] font-medium text-[var(--reject)]"
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

            {/*
              The submit, pinned to the bottom of the phone screen.

              Astra's rule for this screen is that signing in never requires a
              scroll, and on a 390×844 phone the band, the two fieldsets and a
              three-line Vietnamese intro do not leave room for the button
              below them — it measured at y=950. Sticking it to the viewport
              bottom is the version no translation can break: the fields scroll
              under it and the control the person came for is on screen from
              the first paint at every width and in all three languages. At
              `lg` there is nothing to solve and it goes back to being the last
              thing in the form.
            */}
            <div className="sticky bottom-0 -mx-5 mt-1 border-t border-[var(--border)] bg-[var(--background)] px-5 pb-3 pt-2 sm:-mx-10 sm:px-10 lg:static lg:m-0 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1">
              {/*
                The welcome-screen primary: full width, 56px, pill, 17px
                semibold, sun-500 under ink text with the one glow this world
                allows, sun-600 under the press, and the console's own 2px sun
                focus ring at a 2px offset from globals.css. `button.tsx` stops
                at `size="lg"` — 48px on a 12px radius — so the extra height
                and the pill are composed here from tokens rather than by
                adding an `xl` step to a file another track owns this week. If
                a second screen wants this size, that is when it becomes a
                variant.
              */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={busy}
                className="h-14 w-full rounded-[var(--radius-pill)]"
              >
                {busy ? '…' : t('login.submit')}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

/**
 * The two credentials are grouped, and the grouping is a real `<fieldset>`.
 *
 * A screen reader announces the legend before each field, which is the whole
 * point: "Machine identifier" and "Operator reference" are not obviously
 * different things to somebody who cannot see them side by side.
 */
function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 lg:gap-3">
      <legend className="sr-only">{legend}</legend>
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
    <label className="flex flex-col gap-0.5 lg:gap-1">
      <span className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        spellCheck={false}
        className={cn(
          /* 52px, one hairline, a 12px radius, and the sun focus ring the
             rest of the console uses — that outline is the global
             `:focus-visible` rule in globals.css, so this must NOT suppress it
             the way it used to. The border and the ring are different jobs:
             the border says "a field", the ring says "the keyboard is here". */
          'num h-[3.25rem] rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-4',
          'text-[0.9375rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
          'transition-colors duration-150 ease-[var(--ease)]',
          'hover:border-[var(--faint-foreground)]',
          'focus:border-[var(--foreground)]',
        )}
      />
    </label>
  );
}
