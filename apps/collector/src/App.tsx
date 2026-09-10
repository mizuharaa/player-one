import { useEffect, useRef, useState, type ComponentType } from 'react';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockCollectorApi } from './api/mock.ts';
import { HttpCollectorApi } from './api/http.ts';
import { API_BASE_URL, USE_MOCK_API } from './api/config.ts';
import { secureTokenStore } from './api/token-store.ts';
import { AGREEMENTS, type CollectorApi } from './api/types.ts';
import { ApiProvider } from './api/context.tsx';
import { LocaleProvider } from './locale.tsx';
import { NavProvider, useNav, type Route, type RouteName } from './nav.tsx';
import { ThemeProvider } from './theme.tsx';
import { Agreements } from './screens/Agreements.tsx';
import { Devices } from './screens/Devices.tsx';
import { Exam } from './screens/Exam.tsx';
import { Home } from './screens/Home.tsx';
import { Income } from './screens/Income.tsx';
import { MyTasks } from './screens/MyTasks.tsx';
import { Provisioning } from './screens/Provisioning.tsx';
import { Register } from './screens/Register.tsx';
import { SessionCreate } from './screens/SessionCreate.tsx';
import { SessionReminder } from './screens/SessionReminder.tsx';
import { TaskDetail } from './screens/TaskDetail.tsx';
import { TaskHall } from './screens/TaskHall.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { Training } from './screens/Training.tsx';
import { Uploads } from './screens/Uploads.tsx';
import { Body, Button } from './ui.tsx';
import { useT } from './locale.tsx';
import { useTheme } from './theme.tsx';

/**
 * Every route has a screen, checked by the compiler: a route added to `Route`
 * without a component here does not typecheck. That is the "every screen
 * reachable" guarantee in its cheapest enforceable form.
 */
const SCREENS: Record<RouteName, ComponentType> = {
  register: Register,
  agreements: Agreements,
  training: Training,
  exam: Exam,
  home: Home,
  taskHall: TaskHall,
  taskDetail: TaskDetail,
  myTasks: MyTasks,
  devices: Devices,
  provisioning: Provisioning,
  sessionCreate: SessionCreate,
  sessionReminder: SessionReminder,
  uploads: Uploads,
  income: Income,
};

function Current() {
  const { route } = useNav();
  const Screen = SCREENS[route.name];
  return <Screen />;
}


/**
 * While the keystore is being read and the token checked.
 *
 * Deliberately not `Screen`: this renders OUTSIDE `NavProvider`, because the
 * route the app opens on is not known until the profile is. `ui.tsx`'s header
 * reads nav, so it cannot be used here.
 */
function Restoring() {
  const tt = useT();
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface, padding: theme.space[4] }}>
      <Body muted>{tt('signIn.restoring')}</Body>
    </View>
  );
}

/**
 * Where a restored session actually opens.
 *
 * NFR-03/NFR-04 is not met by keeping the token if the app still opens on the
 * registration form — that IS the app having reset, as far as the collector can
 * tell. So the first screen is the first thing they have not finished, read off
 * the server's profile and not off anything this phone remembers.
 *
 * The order is APP-01 → APP-02 → APP-03 → APP-04, which is the order the gates
 * come in: `task_claims_guard` wants consent and an exam pass before a claim.
 * A collector with all four behind them opens on the home screen.
 */
async function startRoute(api: CollectorApi): Promise<Route> {
  const me = await api.profile();
  // No profile at all: a token exists but the row does not name a person yet.
  // That is the ordinary case for somebody a counter operator enrolled.
  if (me === null || me.name === '') return { name: 'register' };
  if (me.agreements.length < AGREEMENTS.length) return { name: 'agreements' };
  if (!me.trainingDone) return { name: 'training' };
  if (!me.examPassed) return { name: 'exam' };
  return { name: 'home' };
}

/**
 * What survives the app being killed, and what deliberately does not.
 *
 * NFR-03/NFR-04. **Only the token is persisted** — `expo-secure-store`, one
 * key, `token-store.ts`. On a cold start the token is read back and checked
 * against `GET /api/me/profile`; if it still works the app opens where the
 * collector left it and every screen's `useQuery` refetches claims, devices,
 * sessions, episodes and income from the server on mount.
 *
 * ponytail: no local copy of that data, and no mutation queue. The server is
 * the record. A phone's snapshot of claims and money goes stale the moment the
 * app closes — a claim can be released, a review can land, a bill can be paid —
 * and showing yesterday's figures as if they were today's is worse than a spinner.
 * Path A upload is out of the pilot, so there is nothing a collector can do
 * offline that would need replaying. What is still owed when Path A lands is
 * the Kotlin foreground-service TurboModule for the transfer itself; the
 * `CollectorApi` seam is what it lands behind and the screens do not change.
 *
 * A 401 clears the token and retires the client/cache. Network failures keep
 * the token and offer retry; an unreadable profile never means registration
 * is incomplete. Local sign-out also clears private queries before switching.
 */
type ApiFactory = (onUnauthorized: () => void) => CollectorApi;
const createApi: ApiFactory = (onUnauthorized) => USE_MOCK_API
  ? new MockCollectorApi()
  : new HttpCollectorApi(API_BASE_URL, secureTokenStore, onUnauthorized);

/** A new client, cache and navigation stack for every signed-in identity. */
export function CollectorSession({ factory = createApi }: { factory?: ApiFactory }) {
  const [epoch, setEpoch] = useState(0);
  return <Session key={epoch} factory={factory} restore={epoch === 0} onExited={() => setEpoch((n) => n + 1)} />;
}

function Session({ factory, restore, onExited }: { factory: ApiFactory; restore: boolean; onExited: () => void }) {
  const [state, setState] = useState<Route | 'out' | 'unavailable' | 'leaving' | 'clearFailed' | null>(restore ? null : 'out');
  const alive = useRef(true);
  const signingOut = useRef(false);
  const run = useRef(0);
  const [queryClient] = useState(() => new QueryClient());
  const [api] = useState(() => factory(() => { if (alive.current) void leave(); }));
  const tt = useT();
  const theme = useTheme();

  async function leave() {
    if (signingOut.current) return;
    signingOut.current = true;
    run.current += 1;
    setState('leaving');
    api.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
    try {
      await api.signOut();
      if (alive.current) onExited();
    } catch {
      if (alive.current) setState('clearFailed');
    } finally { signingOut.current = false; }
  }

  async function enter(checkToken = false) {
    const current = ++run.current;
    setState(null);
    try {
      const next = checkToken && !await api.restoreSession() ? 'out' : await startRoute(api);
      if (alive.current && current === run.current) setState(next);
    } catch {
      // A failed profile query is unknown state, not incomplete registration.
      if (alive.current && current === run.current) setState('unavailable');
    }
  }

  useEffect(() => {
    alive.current = true;
    if (restore) void enter(true);
    return () => {
      alive.current = false;
      run.current += 1;
      void queryClient.cancelQueries();
      queryClient.clear();
      // StrictMode runs setup again synchronously; only a real unmount retires it.
      queueMicrotask(() => { if (!alive.current) api.dispose(); });
    };
  }, [api, queryClient, restore]);

  if (state === null || state === 'leaving') return <Restoring />;
  if (state === 'unavailable' || state === 'clearFailed') return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface, padding: theme.space[4], gap: theme.space[3] }}>
      <Body>{tt(state === 'clearFailed' ? 'signIn.clearFailed' : 'common.loadFailed')}</Body>
      <Button label={tt('common.retry')} onPress={() => void (state === 'clearFailed' ? leave() : enter(true))} />
      {state === 'unavailable' ? <Button kind='ghost' label={tt('signIn.signOut')} onPress={() => void leave()} /> : null}
    </View>
  );

  return (
    <ApiProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <View style={{ flex: 1 }}>
          {state === 'out' ? (
            <NavProvider key='out' initial={{ name: 'register' }}>
              <SignIn onSignedIn={() => { if (alive.current && !signingOut.current) void enter(); }} />
            </NavProvider>
          ) : (
            <NavProvider key='in' initial={state}><Current /></NavProvider>
          )}
          {state !== 'out' ? <Button kind='ghost' label={tt('signIn.signOut')} onPress={() => void leave()} /> : null}
        </View>
      </QueryClientProvider>
    </ApiProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <CollectorSession />
      </LocaleProvider>
    </ThemeProvider>
  );
}
