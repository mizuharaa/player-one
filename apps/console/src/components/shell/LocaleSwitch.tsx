/**
 * English / 中文.
 *
 * A two-state toggle rather than a dropdown: there are exactly two locales
 * (LOC-02), the reviewer using it reads one of them, and a select that has to
 * be opened to see the other option is one interaction too many for something a
 * Shenzhen reviewer does on their first shift and never again.
 *
 * The label is written in the *target* language, which is the rule that makes
 * language switchers work: somebody who cannot read the current language can
 * still find the way out.
 */
import { useTranslation } from 'react-i18next';
import { setLocale, type Locale } from '../../lib/i18n.ts';
import { cn } from '../../lib/cn.ts';

export function LocaleSwitch() {
  const { i18n, t } = useTranslation();
  const current = i18n.language as Locale;
  const next: Locale = current === 'zh' ? 'en' : 'zh';

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      title={t('app.language')}
      lang={next === 'zh' ? 'zh-Hans' : 'en'}
      className={cn(
        /* 44 tall and 44 wide at least: the WCAG 2.2 AA target size. */
        'h-11 min-w-11 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[0.8125rem] font-semibold',
        'text-[var(--muted-foreground)] transition-colors duration-150',
        'hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
      )}
    >
      {next === 'zh' ? '中文' : 'EN'}
      <span className="sr-only">{t('app.language')}</span>
    </button>
  );
}
