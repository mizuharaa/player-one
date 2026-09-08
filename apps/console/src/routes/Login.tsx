/**
 * Sign in. One card, on one screen, usable the moment it paints.
 *
 * ## What this file stopped being
 *
 * It was a 180vh landing with a drifting scatter of eleven photographs, a
 * rainbow prism, a marquee, a rotating circular type element and a hover
 * effect that replaced each photograph with a different photograph — and the
 * form was underneath all of it. The product owner rejected that outright, and
 * named this half first: *"the sign up sign in section ... is bad, 0 color
 * contrast and so bland."*
 *
 * He is describing a real measurement. The panel was white boxes on a
 * lavender-grey ground with nothing above 1.3:1 of anything next to it, so the
 * eye had nothing to land on and no order to read the parts in. The product
 * story moved to `/discover`, and what is left here is the thing an operator
 * came for.
 *
 * ## The contrast anchor
 *
 * **One substantial ink block, above a light form body.** `--stage` is the
 * console's single near-black — the same ink `.feature-block` puts on Home and
 * on the payout screens — and it carries the title and the sentence that
 * explains why there are two credentials. That block is the mass the panel was
 * missing; below it the form is `--card`, which is white, so the card reads as
 * two clearly different materials rather than as one pale rectangle.
 *
 * It is the screen's *one* ink block, which is the rule `DESIGN.md` already
 * sets, and this screen spends it here rather than on decoration.
 *
 * **The hierarchy is size, weight and ground — not effects.** Nothing on this
 * screen animates. There is no scroll choreography, no GSAP import, no
 * `IntersectionObserver`; the page is complete in its first frame.
 *
 * ## What did not change, and must not
 *
 * Every one of these was load-bearing before and is load-bearing now:
 *
 * - **Two credentials.** Every mutation in this service carries a machine
 *   token proving *where* and an operator token proving *who* (PRD §8.3.2
 *   rule 1). The form says so rather than presenting four boxes and letting an
 *   operator guess why their username is split in half.
 * - **PLT-10.** PaXini's reviewers are in Shenzhen and are not standing at a
 *   VNG counter, so choosing "Reviewer" *unmounts* the machine fieldset — a
 *   hidden-but-present input still posts its value, and a machine identifier
 *   travelling with a reviewer sign-in is exactly the confusion this screen
 *   exists to end. The choice is a real `<fieldset>` of radios: two options
 *   visible at once, working before any script has run, announced as one
 *   question.
 * - **`autocomplete` on all four fields, `section-machine` on the machine
 *   pair.** Both pairs are a username and a password; with the bare tokens a
 *   password manager treats the four boxes as one credential and fills the
 *   wrong two.
 * - **The refusal sits above the submit**, not at the end of the fields, so a
 *   refused sign-in is never a screen pixel-identical to the one before it.
 * - **A 429 is a refusal with a name** (SEC-03) and gets the sentence that
 *   says the wait ends by itself, not "wrong password" after a right one.
 *
 * ## Scrolling
 *
 * The document scrolls. The old panel was a fixed-height flex column with the
 * fields in an inner scroller, because it had to fit beside a pinned film half
 * — and two nested scrollers is what put a heading half off screen at 390px
 * once already. With the landing gone there is nothing to fit beside, so the
 * page is an ordinary page: at 390×844 the whole card is one short scroll and
 * every field reaches the top of the viewport when focused.
 *
 * ## What sign-in does not depend on
 *
 * GSAP, images, WebGL and video, each blocked independently. There are none of
 * them on this screen — that is the point. The only network this page needs is
 * `POST /api/session`.
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { Segmented, SegmentedOption } from '../components/ui/segmented.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { cn } from '../lib/cn.ts';

type Failure = 'credentials' | 'mismatch' | 'network' | 'sign_in_rate_limited' | null;

/** A category label: small, faint, tracked out. Above a legend or a group. */
const EYEBROW = 'text-[0.6875rem] font-bold uppercase tracking-[0.09em]';

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'operator' | 'reviewer'>('operator');
  const reviewer = role === 'reviewer';

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
    <div className="flex min-h-dvh flex-col bg-[var(--surface)] text-[var(--foreground)]">
      {/*
        The bar. The wordmark is the way back to the product story — the
        universal one, so it costs no string in three languages — and the two
        switches are where they are on every other screen of this console.
      */}
      <header className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link
          to="/discover"
          aria-label="PlayerOne"
          className={cn(
            'inline-flex items-center gap-2.5 rounded-[var(--radius-sm)] no-underline',
            'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]',
          )}
        >
          <Mark size={26} />
          <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            PlayerOne
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitch />
          <ThemeSwitch />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-10 pt-2 sm:px-8">
        <div className="w-full max-w-[27rem]">
          <div className="shadow-[var(--shadow-lg)]">
            {/* ---------------------------------------------------------------
                The ink block: the whole contrast anchor of the panel.

                `.feature-block` is the console's one ink surface and this is
                this screen's one use of it. Two overrides and no more — the
                bottom corners and the bottom hairline come off, because the
                form body below is the other half of the same card and a radius
                in the middle of a card is a seam.

                The title follows the role, the way the sentence under it does:
                "Sign in to review" was being shown to an upload-centre
                operator in all three languages, and an operator imports TF
                cards and reviews nothing.
                --------------------------------------------------------------- */}
            <div className="feature-block rounded-b-none border-b-0 px-6 py-7 sm:px-7">
              <p className={cn(EYEBROW, 'text-[var(--stage-mid)]')}>{t('app.name')}</p>
              <h1 className="mt-3 font-display text-[1.625rem] font-medium leading-[1.1] tracking-[-0.03em]">
                {t(reviewer ? 'login.title' : 'login.titleOperator')}
              </h1>
              <p className="mt-3 max-w-[38ch] text-[0.875rem] leading-[1.55] text-[var(--stage-mid)]">
                {t(reviewer ? 'login.reviewerIntro' : 'login.intro')}
              </p>
            </div>

            {/* ---------------------------------------------------------------
                The light form body.

                One rhythm: 8 / 20 / 24. A label sits 8px above its own field,
                fields inside a group are 20px apart, and groups are 24px
                apart. Each number is a multiple of four and each is clearly
                larger than the one inside it, which is the only property that
                makes a grouping legible without a rule or a box.
                --------------------------------------------------------------- */}
            <form
              onSubmit={submit}
              className={cn(
                'flex flex-col gap-6 rounded-b-[var(--radius-lg)] border border-t-0',
                'border-[var(--border)] bg-[var(--card)] px-6 py-7 sm:px-7',
              )}
            >
              <fieldset className="flex flex-col gap-2">
                <legend className={cn(EYEBROW, 'mb-2 text-[var(--faint-foreground)]')}>
                  {t('login.role')}
                </legend>
                <Segmented>
                  <SegmentedOption
                    name="role"
                    value="operator"
                    checked={!reviewer}
                    onSelect={setRole}
                  >
                    {t('login.roleCounter')}
                  </SegmentedOption>
                  <SegmentedOption
                    name="role"
                    value="reviewer"
                    checked={reviewer}
                    onSelect={setRole}
                  >
                    {t('login.roleReviewer')}
                  </SegmentedOption>
                </Segmented>
              </fieldset>

              {/* Unmounted, not hidden. See the note at the top of the file. */}
              {reviewer ? null : (
                <Fieldset legend={t('login.groupMachine')}>
                  <Credential
                    name="machine_identifier"
                    label={t('login.fieldIdentifier')}
                    autoComplete="section-machine username"
                  />
                  <Credential
                    name="machine_secret"
                    label={t('login.fieldSecret')}
                    type="password"
                    autoComplete="section-machine current-password"
                  />
                </Fieldset>
              )}

              <Fieldset legend={reviewer ? t('login.groupReviewer') : t('login.groupOperator')}>
                <Credential
                  name="external_ref"
                  label={t('login.fieldReference')}
                  autoComplete="username"
                />
                <Credential
                  name="operator_secret"
                  label={t('login.fieldSecret')}
                  type="password"
                  autoComplete="current-password"
                />
              </Fieldset>

              <div>
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
              </div>
            </form>
          </div>

          {/*
            The legal line, under the card because that is the moment it
            describes: signing in is when a person's data starts being handled,
            and a notice above the control they are reaching for is a notice
            they scroll past.

            Two links on their own line rather than one sentence with the links
            inside it: Vietnamese and Chinese do not put the clause in the same
            place, so an interpolated sentence reads wrong in two of the three
            languages we ship.
          */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-[0.75rem] leading-relaxed text-[var(--muted-foreground)]">
            <span>{t('login.legal')}</span>
            <span className="flex flex-wrap justify-center gap-x-4 gap-y-1">
              <Legal href="#privacy">{t('login.legalPrivacy')}</Legal>
              <Legal href="#data-collection">{t('login.legalData')}</Legal>
            </span>
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
 * drawn as well as announced.
 *
 * The legend used to be `sr-only`, so this screen's entire argument — that a
 * mutation carries two credentials, a machine proving *where* and an operator
 * proving *who* — lived in the accessibility tree and nowhere in the pixels,
 * and a sighted operator got four identical boxes and four identical labels.
 */
function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-5">
      <legend className={cn(EYEBROW, 'mb-2 text-[var(--faint-foreground)]')}>{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A label above its field. The label is the hit target; the field is `ui/input`. */
function Credential({
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
      <Input name={name} type={type} autoComplete={autoComplete} required spellCheck={false} />
    </label>
  );
}
