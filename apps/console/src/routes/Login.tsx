import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';
import { ConsoleLogo } from '../components/shell/ConsoleLogo.tsx';
import { LoginFilm } from '../components/shell/LoginFilm.tsx';
import '../styles/operations.css';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { Segmented, SegmentedOption } from '../components/ui/segmented.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { cn } from '../lib/cn.ts';

type Failure = 'credentials' | 'mismatch' | 'network' | 'sign_in_rate_limited' | null;

/** Consistent readable legends for the role and credential groups. */
const EYEBROW = 'text-[0.8125rem] font-semibold';

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<'operator' | 'reviewer'>('operator');
  const reviewer = role === 'reviewer';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries([...form].map(([key, value]) =>
          [key, typeof value === 'string' ? value.trim() : value]))),
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
    <div className="ops-world ops-login">
      <header className="ops-login-header">
        <Link to="/discover" aria-label="PlayerOne" className="ops-brand">
          <ConsoleLogo />
        </Link>
        <div className="ops-header-controls"><LocaleSwitch /><ThemeSwitch /></div>
      </header>
      <main className="ops-login-layout">
        <LoginFilm />
        <div className="ops-login-form-region">
          <div className="ops-login-form-wrap">
            <div className="ops-login-heading">
              <h1>{t(reviewer ? 'login.title' : 'login.titleOperator')}</h1>
              <p>{t(reviewer ? 'login.reviewerIntro' : 'login.intro')}</p>
            </div>
            <form onSubmit={submit} className="ops-credentials">
              <fieldset className="flex flex-col gap-2">
                <legend className={cn(EYEBROW, 'mb-2 text-[var(--muted-foreground)]')}>
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

              {/* Reviewers do not submit machine credentials. */}
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
            <div className="ops-login-legal">
              <span>{t('login.legal')}</span>
              <span>
                <Legal href="/privacy">{t('login.legalPrivacy')}</Legal>
                <Legal href="/privacy">{t('login.legalData')}</Legal>
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Both notices lead to the available privacy draft; it has no section IDs. */
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
    <fieldset className="ops-credential-group">
      <legend className={cn(EYEBROW, 'mb-2 text-[var(--muted-foreground)]')}>{legend}</legend>
      <div className="ops-credential-fields">{children}</div>
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
      <Input name={name} type={type} autoComplete={autoComplete} required spellCheck={false}
        autoCapitalize="none" onBlur={event => { event.currentTarget.value = event.currentTarget.value.trim(); }} />
    </label>
  );
}
