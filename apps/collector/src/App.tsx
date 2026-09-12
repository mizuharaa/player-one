import { sessionEntry, type SessionEntry } from './api/session-entry.ts';
import { TransportProvider } from './device/transport-context.tsx';
import { MockDeviceTransport, UnavailableDeviceTransport } from './device/transport.ts';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockCollectorApi } from './api/mock.ts';
import { HttpCollectorApi } from './api/http.ts';
import { API_BASE_URL, USE_MOCK_API } from './api/config.ts';
import { secureTokenStore } from './api/token-store.ts';
import { type CollectorApi } from './api/types.ts';
import { ApiProvider } from './api/context.tsx';
import { LocaleProvider } from './locale.tsx';
import { NavProvider, useNav, type RouteName } from './nav.tsx';
import { GuideProvider, useGuideTarget } from './guide/Guide.tsx';
import { TabBar } from './shell/TabBar.tsx';
import { ThemeProvider } from './theme.tsx';
import { Agreements } from './screens/Agreements.tsx';
import { Devices } from './screens/Devices.tsx';
import { Exam } from './screens/Exam.tsx';
import { Forum } from './screens/Forum.tsx';
import { GroupChats, GroupThread } from './screens/Groups.tsx';
import { Home } from './screens/Home.tsx';
import { Income } from './screens/Income.tsx';
import { MyTasks } from './screens/MyTasks.tsx';
import { Provisioning } from './screens/Provisioning.tsx';
import { Register } from './screens/Register.tsx';
import { SessionCreate } from './screens/SessionCreate.tsx';
import { SessionReminder } from './screens/SessionReminder.tsx';
import { TaskDetail } from './screens/TaskDetail.tsx';
import { TaskHall } from './screens/TaskHall.tsx';
import { Landing } from './screens/Landing.tsx';
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
  forum: Forum,
  groupChats: GroupChats,
  groupThread: GroupThread,
};

/**
 * The shell: the current screen, and the bottom bar when it is a tab root.
 *
 * A pushed screen — a task's detail, device setup, session preparation — does
 * not render the bar. Two navigation models on one screen is how a collector
 * loses track of what Back will do, and the bar's job is switching between the
 * four places, not stepping back out of one.
 */
function Current() {
  const nav = useNav();
  const theme = useTheme();
  const Screen = SCREENS[nav.route.name];
  const tabsTarget = useGuideTarget('shell.tabs');
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <Screen />
      {nav.isTabRoot ? (
        <View
          ref={tabsTarget}
          collapsable={false}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        >
          <TabBar />
        </View>
      ) : null}
    </View>
  );
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
 * A 401 clears the token and retires the client, its cache and its navigation
 * stack. Network failures keep the token and offer retry; an unreadable profile
 * never means registration is incomplete. Local sign-out clears the private
 * query cache before switching, so the next collector on this phone cannot see
 * the last one's income in a stale cache.
 *
 * `sessionEntry` decides where a restored session opens; it is the same helper
 * `api.test.ts` pins directly, so the rule lives in one place and is tested
 * without mounting React.
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
  const [state, setState] = useState<SessionEntry | 'leaving' | 'clearFailed' | null>(restore ? null : 'out');
  /** Whether the landing has handed over to the sign-in form. */
  const [signingIn, setSigningIn] = useState(false);
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

  async function enter() {
    const current = ++run.current;
    setState(null);
    const next = await sessionEntry(api);
    if (alive.current && current === run.current) setState(next);
  }

  useEffect(() => {
    alive.current = true;
    if (restore) void enter();
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
      <Button label={tt('common.retry')} onPress={() => void (state === 'clearFailed' ? leave() : enter())} />
      {state === 'unavailable' ? <Button variant='ghost' label={tt('signIn.signOut')} onPress={() => void leave()} /> : null}
    </View>
  );

  return (
    <ApiProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <View style={{ flex: 1 }}>
          {state === 'out' ? (
            /**
             * Neither the landing nor sign-in is a `Route`, and neither has an
             * entry in `SCREENS`: they are not somewhere a collector navigates
             * to, they are what the app is when there is no session. So the
             * route registry's completeness check is untouched. They still need
             * a `NavProvider` above them because `ui.tsx`'s header reads nav.
             *
             * **The landing is a cold start's door, not a sign-out's.** On a
             * fresh launch the product story comes first and sign-in is one tap
             * behind it. Somebody who just signed out on this phone has already
             * been told what the product is and is handing it to the next
             * collector, so they get the form with nothing in front of it —
             * the same split the console makes between `/` and `/login`.
             * `restore` is exactly "this is the first session of this launch".
             */
            <NavProvider key='out' initial={{ name: 'register' }}>
              {restore && !signingIn ? (
                <Landing onSignIn={() => setSigningIn(true)} />
              ) : (
                <SignIn
                  onSignedIn={() => { if (alive.current && !signingOut.current) void enter(); }}
                  onBack={restore ? () => setSigningIn(false) : undefined}
                />
              )}
            </NavProvider>
          ) : (
            <NavProvider key='in' initial={state}>
              <GuideProvider>
                <Current />
              </GuideProvider>
            </NavProvider>
          )}
          {state !== 'out' ? <Button variant='ghost' label={tt('signIn.signOut')} onPress={() => void leave()} /> : null}
        </View>
      </QueryClientProvider>
    </ApiProvider>
  );
}

const transport = USE_MOCK_API ? new MockDeviceTransport() : new UnavailableDeviceTransport();

export function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <TransportProvider value={transport}><CollectorSession /></TransportProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
