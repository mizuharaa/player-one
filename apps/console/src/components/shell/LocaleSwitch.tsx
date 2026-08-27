/**
 * English / 中文 / Tiếng Việt.
 *
 * One button that cycles rather than a dropdown: there are three locales, the
 * reader uses one of them, and a select that has to be opened to see the
 * others is one interaction too many for something a Shenzhen reviewer or a
 * Ho Chi Minh City finance operator does on their first shift and never again.
 * Two locales made this a toggle (LOC-02); the payout console added
 * Vietnamese for the finance operators and the flag sentences, and a cycle
 * is the same gesture with one more stop.
 *
 * The label is written in the *target* language, which is the rule that makes
 * language switchers work: somebody who cannot read the current language can
 * still find the way out.
 */
import { useTranslation } from 'react-i18next';
import { HTML_LANG } from '@playerone/api/i18n';
import { LOCALES, setLocale, type Locale } from '../../lib/i18n.ts';
import { cn } from '../../lib/cn.ts';

const LABEL: Record<Locale, string> = { en: 'EN', zh: '中文', vi: 'VI' };

export function LocaleSwitch() {
  const { i18n, t } = useTranslation();
  const current = i18n.language as Locale;
  const at = Math.max(0, LOCALES.indexOf(current));
  const next: Locale = LOCALES[(at + 1) % LOCALES.length] ?? 'en';

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      title={t('app.language')}
      lang={HTML_LANG[next]}
      className={cn(
        'h-8 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[0.8125rem] font-semibold',
        'text-[var(--muted-foreground)] transition-colors duration-150',
        'hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
      )}
    >
      {LABEL[next]}
      <span className="sr-only">{t('app.language')}</span>
    </button>
  );
}
