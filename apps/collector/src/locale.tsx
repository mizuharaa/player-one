import { createContext, useContext, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, t, type Locale, type MessageKey } from './i18n.ts';

/**
 * Vietnamese by default (LOC-01). The toggle exists so the English catalogue
 * is reachable and therefore honest, not decoration.
 */
const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

/** The screens' translator: `const tt = useT(); tt('hall.title')`. */
export function useT(): (key: MessageKey) => string {
  const { locale } = useContext(LocaleContext);
  return (key) => t(locale, key);
}
