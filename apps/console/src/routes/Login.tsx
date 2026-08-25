/**
 * Sign in.
 *
 * Two credentials, because every mutation in this service carries two: a
 * machine token proving *where* and an operator token proving *who* (PRD
 * §8.3.2 rule 1). The form says so rather than presenting four boxes and
 * letting an operator guess why their username is split in half.
 *
 * The known gap is stated in the code and not hidden: PaXini's reviewers are in
 * Shenzhen and are not standing at a VNG counter, so signing them in with
 * upload-centre *operator* credentials is wrong. PLT-10 wants a scoped,
 * fully-logged remote reviewer role. That is the next architectural correction
 * to this screen and it changes this form, not the review lane behind it.
 *
 * Composition note: this is not a centred card on a grey field. The left half
 * carries the identity at a size that means it, the right half carries the
 * form, and on a narrow window the identity collapses to the mark above the
 * fields rather than being dropped.
 */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Mark } from '../components/identity/Mark.tsx';
import { Cu } from '../components/identity/Cu.tsx';
import { Button } from '../components/ui/button.tsx';
import { LocaleSwitch } from '../components/shell/LocaleSwitch.tsx';
import { ThemeSwitch } from '../components/shell/ThemeSwitch.tsx';
import { cn } from '../lib/cn.ts';

type Failure = 'credentials' | 'mismatch' | 'network' | null;

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Failure>(null);
  const [busy, setBusy] = useState(false);

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
        void navigate({ to: '/' });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      setFailure(body.reason === 'mismatch' ? 'mismatch' : 'credentials');
    } catch {
      /* The LAN dropped, or the API is not running. Say which is possible. */
      setFailure('network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* The identity half. Sun field, because sign-in is an action. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[var(--sun-500)] p-10 lg:flex">
        <div className="flex items-center gap-2.5 text-white">
          <Mark size={30} monochrome />
          <span className="text-[1.1875rem] font-extrabold tracking-[-0.02em]">PlayerOne</span>
        </div>

        <div className="max-w-[34ch]">
          <p className="text-[2.0625rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-white">
            Every recorded hour gets an owner, a measurement and a decision.
          </p>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-white/85">
            VNG PT Lab and PaXini. Footage stays in Vietnam.
          </p>
        </div>

        {/* Cú sits low and partly cropped: she is the room, not the message. */}
        <Cu size={172} className="absolute -bottom-6 right-6 opacity-95" />
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-end gap-1">
          <LocaleSwitch />
          <ThemeSwitch />
        </div>

        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Mark size={28} />
            <span className="text-[1.0625rem] font-extrabold tracking-[-0.02em]">PlayerOne</span>
          </div>

          <h1 className="text-[1.625rem] font-extrabold tracking-[-0.025em]">{t('login.title')}</h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">
            {t('login.intro')}
          </p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
            <Fieldset legend={t('login.machine')}>
              <Input name="machine_identifier" label={t('login.machine')} autoComplete="username" />
              <Input
                name="machine_secret"
                label={t('login.machineSecret')}
                type="password"
                autoComplete="current-password"
              />
            </Fieldset>

            <Fieldset legend={t('login.operator')}>
              <Input name="external_ref" label={t('login.operator')} autoComplete="username" />
              <Input
                name="operator_secret"
                label={t('login.operatorSecret')}
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
                  : failure === 'network'
                    ? 'The service did not answer. Check the machine is on the centre network and try again.'
                    : t('login.failed')}
              </p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" disabled={busy} className="mt-1">
              {busy ? '…' : t('login.submit')}
            </Button>
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
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{legend}</legend>
      {children}
    </fieldset>
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
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        spellCheck={false}
        className={cn(
          'num h-11 rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3.5',
          'text-[0.9375rem] text-[var(--foreground)] placeholder:text-[var(--faint-foreground)]',
          'transition-colors duration-150 ease-[var(--ease)]',
          'hover:border-[var(--faint-foreground)]',
          'focus:border-[var(--sun-500)] focus:outline-none focus-visible:outline-none',
        )}
      />
    </label>
  );
}
