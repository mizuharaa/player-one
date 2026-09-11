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
 *
 * It is still a native `<select>` — the element, the keyboard behaviour and the
 * browser's own popup, which follows `color-scheme` and so drops a dark list
 * out of the ink top bar without being told to. What changed is only the box:
 * `appearance-none` and a glyph we draw, because the browser's default select
 * chrome ignores `bg-transparent`, paints its own grey field and its own arrow,
 * and on the sign-in screen that was the one control that looked unfinished
 * next to everything around it.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/cn.ts';
import { IconChevron, IconLanguage } from '../icons.tsx';
import { HTML_LANG } from '@playerone/api/i18n';
import { LOCALES, setLocale, type Locale } from '../../lib/i18n.ts';

const LABEL: Record<Locale, string> = { en: 'English', zh: '中文', vi: 'Tiếng Việt' };

export function LocaleSwitch() {
  const { i18n, t } = useTranslation();
  const current = (LOCALES as readonly string[]).includes(i18n.language) ? (i18n.language as Locale) : 'en';

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <IconLanguage
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 opacity-70"
      />
      <select
        aria-label={t('app.language')}
        title={t('app.language')}
        value={current}
        onChange={(e) => setLocale(e.target.value as Locale)}
        /*
         * Drawn in `currentColor` on a transparent ground, so the one control
         * works on the ink top bar and on the light sign-in panel without a
         * prop saying which. The *popup* is the browser's own drawing and
         * follows `color-scheme`, which `.on-stage` sets on the bar — a light
         * list dropping out of a near-black bar is the tell that a control was
         * skinned rather than themed.
         */
        className={cn(
          'h-8 appearance-none rounded-[var(--radius-pill)] border bg-transparent pl-8 pr-7',
          'text-[0.8125rem] font-semibold text-current/85',
          'border-current/25 transition-colors duration-150 ease-[var(--ease)]',
          'hover:border-current/45 hover:text-current active:border-current/60',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'disabled:pointer-events-none disabled:opacity-45',
        )}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={HTML_LANG[l]}
            style={{ color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}>
            {LABEL[l]}
          </option>
        ))}
      </select>
      <IconChevron
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 opacity-70"
      />
    </span>
  );
}
