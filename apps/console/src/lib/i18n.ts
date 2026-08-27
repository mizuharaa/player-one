/**
 * Localisation, fed from the server's own catalogue.
 *
 * `MESSAGES` is imported from `@playerone/api/i18n` rather than copied here.
 * That module has no imports of its own — it is a flat map of dotted keys — and
 * keeping one catalogue is what stops an English word appearing in the middle
 * of a Chinese sentence at an upload centre. A test in `packages/api` asserts
 * every locale holds every key, so adding an English string without its
 * counterparts fails CI rather than shipping.
 *
 * LOC-02 puts the back office in English and Chinese. Vietnamese was added
 * with the payout console, because the finance operators who run a batch read
 * Vietnamese; the collector-facing reject reason codes of LOC-04 stay
 * catalogue rows in `review_reason_codes` with a `label_vi`, not strings here.
 *
 * The keys use dots, so i18next's default `keySeparator` would read
 * `queue.empty.title` as three levels of nesting into a flat object and find
 * nothing. Both separators are switched off; the key is the whole key.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, HTML_LANG, LOCALES, MESSAGES, type Locale } from '@playerone/api/i18n';

const STORAGE_KEY = 'playerone.locale';

function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;

  /**
   * A reviewer in Shenzhen should not have to find the switch on their first
   * shift. `zh-CN`, `zh-Hans` and `zh` all mean the same thing here.
   */
  for (const tag of navigator.languages ?? []) {
    if (tag.toLowerCase().startsWith('zh')) return 'zh';
    if (tag.toLowerCase().startsWith('vi')) return 'vi';
    if (tag.toLowerCase().startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...LOCALES],
  resources: Object.fromEntries(
    LOCALES.map((locale) => [locale, { translation: MESSAGES[locale] }]),
  ),
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLocale(locale: Locale) {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
  applyHtmlLang(locale);
}

/**
 * `lang` on the root element, not just a variable.
 *
 * It decides which CJK glyph variants the browser picks and what a screen
 * reader switches its voice to. `zh-Hans` rather than `zh`, because the
 * simplified and traditional forms of the same codepoint differ and PaXini's
 * reviewers read simplified.
 */
export function applyHtmlLang(locale: Locale) {
  document.documentElement.lang = HTML_LANG[locale];
}

export { i18n, LOCALES, type Locale };
