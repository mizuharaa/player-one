import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/App.tsx';
import { LOCALES, type Locale as LocaleName } from '../src/i18n.ts';
import { LocaleProvider, useLocale } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { ThemeProvider } from '../src/theme.tsx';
import { Landing } from '../src/screens/Landing.tsx';
import { SignIn } from '../src/screens/SignIn.tsx';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';

/**
 * What the browser renders, and why it is not simply `<App />`.
 *
 * `MockCollectorApi` has no sign-in — deliberately, and the mock says so: a
 * code it checked would be a code it invented, and the thing that really
 * decides whether a collector may sign in is the platform's
 * `POST /auth/collector/verify`. So `restoreSession()` is always true and the
 * app under the mock opens *past* the landing, on the first onboarding step.
 * That is correct behaviour and this harness does not "fix" it.
 *
 * It does need pictures of the landing and the sign-in form, though. So those
 * two get their own entry points — `?screen=landing`, `?screen=signin` — which
 * render **the real components with the real providers**, not a copy of them.
 * Nothing is stubbed and no state is forced; the only thing the query string
 * changes is which component is mounted at the root, and `?lang=en` which
 * flips the catalogue the way the in-app chip does.
 *
 * With no query string it is the whole app, entered the way the mock enters
 * it: register → agreements → training → exam → home, which is the path
 * `shots.mjs` walks.
 */

function Locale({ lang, children }: { lang: LocaleName; children: ReactNode }) {
  const { setLocale } = useLocale();
  useEffect(() => {
    setLocale(lang);
  }, [lang, setLocale]);
  return <>{children}</>;
}

/** One instance, so the two pre-session screens share the seam the app uses. */
const api = new MockCollectorApi();
/** `SignIn` sends its two requests through react-query, exactly as in `App`. */
const queryClient = new QueryClient();

export function Harness() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get('screen');
  const asked = params.get('lang');
  const lang: LocaleName = (LOCALES as readonly string[]).includes(asked ?? '')
    ? (asked as LocaleName)
    : 'vi';

  if (screen === null) return <App />;

  return (
    <ThemeProvider>
      <LocaleProvider>
        <Locale lang={lang}>
          <ApiProvider value={api}>
            <QueryClientProvider client={queryClient}>
              <NavProvider initial={{ name: 'register' }}>
                {screen === 'signin' ? (
                  <SignIn onSignedIn={() => {}} onBack={() => {}} />
                ) : (
                  <Landing onSignIn={() => {}} />
                )}
              </NavProvider>
            </QueryClientProvider>
          </ApiProvider>
        </Locale>
      </LocaleProvider>
    </ThemeProvider>
  );
}
