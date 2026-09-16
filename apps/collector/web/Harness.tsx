import { RouteTransition } from '../src/shell/RouteTransition.tsx';
import { BootIntro } from '../src/shell/BootIntro.tsx';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Onboarding } from '../src/screens/Onboarding.tsx';
import { Notifications } from '../src/screens/Notifications.tsx';
import { NOTIFICATION_PREVIEW } from './notification-preview.ts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, SCREENS } from '../src/App.tsx';
import { LOCALES, type Locale as LocaleName } from '../src/i18n.ts';
import { LocaleProvider, useLocale } from '../src/locale.tsx';
import { NavProvider, useNav, type Route, type RouteName } from '../src/nav.tsx';
import { GuideProvider } from '../src/guide/Guide.tsx';
import { ToastProvider } from '../src/ui/Toast.tsx';
import { TabBar } from '../src/shell/TabBar.tsx';
import { View } from 'react-native';
import { AGREEMENTS, ApiError } from '../src/api/types.ts';
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
// Phone-shaped browser proof only; native uses the live SafeAreaProvider.
const PREVIEW_INSETS = { top: 59, bottom: 34, left: 0, right: 0 }; // the demo handset is an iPhone with a Dynamic Island and home indicator
const api = new MockCollectorApi();
/** `SignIn` sends its two requests through react-query, exactly as in `App`. */
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function RoutedScreen() {
  const nav = useNav();
  const Screen = SCREENS[nav.route.name];
  const preview = nav.route.name === 'notifications' && new URLSearchParams(window.location.search).get('simulation') === '1';
  return <View style={{ flex: 1 }}>{preview ? <Notifications previewItems={NOTIFICATION_PREVIEW} /> : <RouteTransition route={nav.route} isTabRoot={nav.isTabRoot}><Screen /></RouteTransition>}{nav.isTabRoot ? <TabBar /> : null}</View>;
}

export function Harness() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get('screen');
  const state = params.get('state');
  const loading = state === 'loading';
  const previewApi = useMemo(() => new Proxy(api, { get(target, key) {
    if (state === 'simulation' && key === 'income') return async () => [{ episodeId: 'sandbox-paid', kind: 'confirmed', amountVnd: '1200', effectiveMinutes: '1', settlementState: 'paid', simulation: true }];
    if (state === 'simulation' && key === 'incomeCycle') return async () => ({ label: 'Sandbox cycle', confirmedVnd: '1200', estimatedVnd: '0', totalVnd: '1200', simulation: true });
    if (state === 'simulation' && key === 'episodes') return async () => [{ episodeId: 'sandbox-paid', sessionId: 'sandbox-session', sizeBytes: 1200, state: 'review_passed' }];
    if (state === 'refusal' && key === 'claimTask') return async () => { throw new ApiError('collector_not_onboarded'); };
    if (loading && ['tasks', 'task', 'myClaims', 'boundDevices', 'episodes', 'income', 'incomeCycle', 'sessions', 'notifications'].includes(String(key))) return () => new Promise(() => {});
    if (['offline', 'error'].includes(state ?? '') && ['tasks', 'task', 'myClaims', 'boundDevices', 'episodes', 'income', 'incomeCycle', 'sessions', 'notifications', 'profile', 'payout', 'requestSignInCode'].includes(String(key))) return async () => { throw new ApiError(state === 'offline' ? 'server_unreachable' : 'server_error'); };
    if (state === 'empty' && ['tasks', 'myClaims', 'boundDevices', 'episodes', 'income', 'sessions', 'notifications'].includes(String(key))) return async () => [];
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }), [loading, state]);
  const [intro, setIntro] = useState(params.get('intro') === '1');
  const asked = params.get('lang');
  const readyRequested = params.get('ready') === '1';
  const [ready, setReady] = useState(!readyRequested);
  const seeding = useRef(false);
  useEffect(() => {
    if (!readyRequested || seeding.current) return;
    seeding.current = true;
    // Browser-only fixture setup uses the same mock API gates as the tests.
    void (async () => {
      await api.register('Demo Collector', '0903000001');
      await api.acceptAgreements(AGREEMENTS.map(({ id, version }) => ({ agreementId: id, version })));
      await api.completeTraining();
      await api.submitExam([true, true, true]);
      const task = (await api.tasks()).find(task => task.claimable);
      if (task) await api.claimTask(task.id);
      if (!(await api.boundDevices()).some(device => device.serial === 'EGO-DEMO')) await api.bindDevice('EGO-DEMO');
      setReady(true);
    })();
  }, [readyRequested]);
  const lang: LocaleName = (LOCALES as readonly string[]).includes(asked ?? '')
    ? (asked as LocaleName)
    : 'en';

  if (screen === null) return <SafeAreaInsetsContext.Provider value={PREVIEW_INSETS}><App /></SafeAreaInsetsContext.Provider>;
  if (!ready) return null;
  const routed = Object.hasOwn(SCREENS, screen);
  const initial: Route = screen === 'taskDetail' ? { name: 'taskDetail', taskId: params.get('taskId') ?? 'task-cook' }
    : screen === 'groupThread' ? { name: 'groupThread', groupId: params.get('groupId') ?? '' }
    : { name: (routed ? screen : 'register') as Exclude<RouteName, 'taskDetail' | 'groupThread'> };

  return (
    <SafeAreaInsetsContext.Provider value={PREVIEW_INSETS}>
    <ThemeProvider>
      <LocaleProvider>
        <Locale lang={lang}>
          <ApiProvider value={previewApi}>
            <QueryClientProvider client={queryClient}>
              <ToastProvider><NavProvider initial={initial}>
                {screen === 'onboarding' ? <GuideProvider><Onboarding onDone={() => {}} /></GuideProvider> : routed ? <GuideProvider><RoutedScreen /></GuideProvider> : screen === 'signin' ? (
                  <SignIn onSignedIn={() => {}} onBack={() => {}} />
                ) : (
                  <Landing onSignIn={() => {}} />
                )}
                {intro ? <BootIntro onDone={() => setIntro(false)} /> : null}
              </NavProvider></ToastProvider>
            </QueryClientProvider>
          </ApiProvider>
        </Locale>
      </LocaleProvider>
    </ThemeProvider>
    </SafeAreaInsetsContext.Provider>
  );
}
