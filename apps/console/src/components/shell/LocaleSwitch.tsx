/**
 * English / 中文 / Tiếng Việt.
 *
 * A native select, not a cycling button (bridge review F-51): with three
 * locales a cycle makes the reader guess what the *next* stop is, and a
 * Ho Chi Minh City finance operator who cannot read Chinese should not have
 * to pass through it to reach Vietnamese. Every option is written in its own
 * language, which is the rule that makes language switchers work: somebody
 * who cannot read the current language can still find the way out.
 *
 * Same control the back office uses for a status, so nothing new to style.
 */
import { useTranslation } from 'react-i18next';
import { HTML_LANG } from '@playerone/api/i18n';
import { LOCALES, setLocale, type Locale } from '../../lib/i18n.ts';

const LABEL: Record<Locale, string> = { en: 'English', zh: '中文', vi: 'Tiếng Việt' };

export function LocaleSwitch() {
  const { i18n, t } = useTranslation();
  const current = (LOCALES as readonly string[]).includes(i18n.language) ? (i18n.language as Locale) : 'en';

  return (
    <select
      aria-label={t('app.language')}
      title={t('app.language')}
      value={current}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="h-8 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-[0.8125rem] font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l} lang={HTML_LANG[l]}>
          {LABEL[l]}
        </option>
      ))}
    </select>
  );
}
