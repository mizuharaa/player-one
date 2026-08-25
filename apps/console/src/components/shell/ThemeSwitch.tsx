/**
 * Light or dark, for the shell only.
 *
 * This does not touch the review theatre. The region around the player is
 * near-black in both themes because reviewers judge `VQ-DARK` and
 * `VQ-OVEREXPOSED`, and chrome that borders footage must not shift a call a
 * collector is paid on. What this switch changes is everything else: Home, the
 * pipeline, the rails, the counter. A staffed upload centre in daylight wants
 * light; a reviewer on the 02:00 shift does not.
 *
 * Three states, not two, matching how the tokens are written: an explicit
 * choice stamps `data-theme`, and no choice leaves the OS preference to decide.
 * The button cycles light → dark → system so the operator can get back to
 * "follow the machine" without clearing storage.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn.ts';

type Choice = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'playerone.theme';

function read(): Choice {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyStoredTheme() {
  apply(read());
}

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function ThemeSwitch() {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Choice>(read);

  useEffect(() => {
    apply(choice);
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  }, [choice]);

  const cycle = () =>
    setChoice((c) => (c === 'light' ? 'dark' : c === 'dark' ? 'system' : 'light'));

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${t('theme.toggle')}: ${choice}`}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full',
        'text-[var(--muted-foreground)] transition-colors duration-150',
        'hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
      )}
    >
      {/* Sun, moon, or half — drawn in the same 20px grid as every other icon. */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {choice === 'light' ? (
          <>
            <circle cx="10" cy="10" r="3.8" />
            <path d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.3 1.3M13.9 13.9l1.3 1.3M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3" />
          </>
        ) : choice === 'dark' ? (
          <path d="M16 11.6A6.8 6.8 0 1 1 8.4 4a5.6 5.6 0 0 0 7.6 7.6z" />
        ) : (
          <>
            <circle cx="10" cy="10" r="6.6" />
            <path d="M10 3.4a6.6 6.6 0 0 1 0 13.2z" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
      <span className="sr-only">{t('theme.toggle')}</span>
    </button>
  );
}
