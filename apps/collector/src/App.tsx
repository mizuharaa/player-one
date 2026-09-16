import { RouteTransition } from './shell/RouteTransition.tsx';
import { sessionEntry, type SessionEntry } from './api/session-entry.ts';
import { TransportProvider } from './device/transport-context.tsx';
import { MockDeviceTransport, UnavailableDeviceTransport } from './device/transport.ts';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockCollectorApi } from './api/mock.ts';
import { HttpCollectorApi } from './api/http.ts';
import { USE_MOCK_API } from './api/config.ts';
import { getApiOrigin, loadApiOrigin } from './api/origin.ts';
import { secureOriginStore, secureTokenStore } from './api/token-store.ts';
import { type CollectorApi, type CollectorProfile } from './api/types.ts';
import { ApiProvider } from './api/context.tsx';
import { LocaleProvider } from './locale.tsx';
import { NavProvider, useNav, type RouteName } from './nav.tsx';
import { GuideProvider, useGuide, useGuideTarget } from './guide/Guide.tsx';
import { TabBar } from './shell/TabBar.tsx';
import { SignOutProvider } from './session.tsx';
import { ThemeProvider } from './theme.tsx';
import { Agreements } from './screens/Agreements.tsx';
import { Devices } from './screens/Devices.tsx';
import { Exam } from './screens/Exam.tsx';
import { Forum } from './screens/Forum.tsx';
import { GroupChats, GroupThread } from './screens/Groups.tsx';
import { Home } from './screens/Home.tsx';
import { Income } from './screens/Income.tsx';
import { Onboarding } from './screens/Onboarding.tsx';
import { Notifications } from './screens/Notifications.tsx';
import { About } from './screens/About.tsx';
import { Privacy } from './screens/Privacy.tsx';
import { Profile } from './screens/Profile.tsx';
import { MyTasks } from './screens/MyTasks.tsx';
import { Provisioning } from './screens/Provisioning.tsx';
import { Register } from './screens/Register.tsx';
import { SessionCreate } from './screens/SessionCreate.tsx';
import { SessionReminder } from './screens/SessionReminder.tsx';
import { TaskDetail } from './screens/TaskDetail.tsx';
import { TaskHall, clearPreferences } from './screens/TaskHall.tsx';
import { Landing } from './screens/Landing.tsx';
import { BootIntro, BootChrome } from './shell/BootIntro.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { Training } from './screens/Training.tsx';
import { Uploads } from './screens/Uploads.tsx';
import { ToastProvider } from './ui/Toast.tsx';
import { Body, Button } from './ui.tsx';
import { useT } from './locale.tsx';
import { useTheme } from './theme.tsx';

/**
 * Every route has a screen, checked by the compiler: a route added to `Route`
 * without a component here does not typecheck. That is the "every screen
 * reachable" guarantee in its cheapest enforceable form.
 */
export const SCREENS: Record<RouteName, ComponentType> = {
  register: Register,
  agreements: Agreements,
  training: Training,
  exam: Exam,
  home: Home,
  profile: Profile,
  notifications: Notifications,
  about: About,
  privacy: Privacy,
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
  const guide = useGuide();
  const [intro, setIntro] = useState(true);
  if (nav.route.name === 'home' && guide.offered && intro) return <Onboarding onDone={() => { setIntro(false); guide.decline(); }} />;
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <RouteTransition route={nav.route} isTabRoot={nav.isTabRoot}><Screen /></RouteTransition>
      {nav.isTabRoot ? (
        <View
          ref={tabsTarget}
          collapsable={false}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        >
          <BootChrome step={1}><TabBar /></BootChrome>
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
  : new HttpCollectorApi(getApiOrigin(), secureTokenStore, onUnauthorized);

/**
 * A new client, cache and navigation stack for every signed-in identity.
 *
 * Two things are read before the first client exists, and both are keystore
 * reads on the same boot the token is read on:
 *
 * `loadApiOrigin` is awaited here rather than inside `Session`, because
 * `createApi` bakes `getApiOrigin()` into the client it builds — a client
 * built before the override was read would talk to the build's default for
 * the whole session. The wait is one keystore read behind the splash overlay,
 * which is already on screen, and `Restoring` is the gate the boot already
 * uses.
 *
 * `door` is which door the next session opens on. A cold start and a server
 * change both open on the landing — a server change IS a cold start, as far as
 * what this phone knows is concerned — and a sign-out opens on the form,
 * because whoever just signed out has seen the product story and is handing
 * the phone to the next collector.
 */
export function CollectorSession({ factory = createApi }: { factory?: ApiFactory }) {
  const [epoch, setEpoch] = useState(0);
  const [door, setDoor] = useState(true);
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    let alive = true;
    const done = () => { if (alive) setBooted(true); };
    // A keystore that cannot be read leaves the build's own origin in place;
    // it must not stop the app from starting.
    void loadApiOrigin(secureOriginStore).then(done, done);
    return () => { alive = false; };
  }, []);
  if (!booted) return <Restoring />;
  return (
    <Session
      key={epoch}
      factory={factory}
      restore={door}
      onExited={(landing) => { setDoor(landing); setEpoch((n) => n + 1); }}
    />
  );
}

function Session({ factory, restore, onExited }: { factory: ApiFactory; restore: boolean; onExited: (landing: boolean) => void }) {
  const [state, setState] = useState<SessionEntry | 'leaving' | 'clearFailed' | null>(restore ? null : 'out');
  /** Whether the landing has handed over to the sign-in form. */
  const [signingIn, setSigningIn] = useState(false);
  const alive = useRef(true);
  const signingOut = useRef(false);
  const logoutCollectorId = useRef<string | null>(null);
  /** Which door the session that replaces this one opens on. */
  const leaveFor = useRef(false);
  const run = useRef(0);
  const [queryClient] = useState(() => new QueryClient());
  const [api] = useState(() => factory(() => { if (alive.current) void leave(); }));
  const tt = useT();
  const theme = useTheme();

  /**
   * `landing` is passed through to `onExited`: an origin change ends the
   * session the same way a sign-out does, and then the app is a stranger to
   * the server it is now pointed at, so it opens on the landing door.
   */
  async function leave(landing = false) {
    if (signingOut.current) return;
    signingOut.current = true;
    leaveFor.current = landing;
    run.current += 1;
    setState('leaving');
    logoutCollectorId.current = queryClient.getQueryData<CollectorProfile | null>(['profile'])?.id ?? logoutCollectorId.current;
    api.dispose();
    await queryClient.cancelQueries();
    queryClient.clear();
    try {
      if (logoutCollectorId.current !== null) await clearPreferences(logoutCollectorId.current);
      await api.signOut();
      if (alive.current) onExited(leaveFor.current);
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
    <ToastProvider><ApiProvider value={api}>
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
            /* Home draws it; see `session.tsx` for why it is not here. */
            <SignOutProvider signOut={(options) => void leave(options?.landing === true)}>
              <NavProvider key='in' initial={state}>
                <GuideProvider>
                  <Current />
                </GuideProvider>
              </NavProvider>
            </SignOutProvider>
          )}
        </View>
      </QueryClientProvider>
    </ApiProvider></ToastProvider>
  );
}

const transport = USE_MOCK_API ? new MockDeviceTransport() : new UnavailableDeviceTransport();

/**
 * The splash (SPEC.md §1) is an overlay with a timer, not a gate.
 *
 * `CollectorSession` mounts underneath it on the same tick, so
 * `restoreSession()` is already in flight while the wordmark is on screen —
 * §1: "the splash renders before `restoreSession()` resolves and does not wait
 * on it". Gating the app's mount on the splash would have added the splash's
 * whole duration to every cold start, for nothing.
 *
 * It is removed from the tree rather than hidden. §0.5 rule 5: a full-screen
 * overlay at `opacity: 0` still eats every touch on Android, and this is the
 * largest overlay in the app.
 */
export function App() {
  const [splash, setSplash] = useState(true);
  return (
    <ThemeProvider>
      <LocaleProvider>
        <View style={{ flex: 1 }}>
          <BootChrome><TransportProvider value={transport}><CollectorSession /></TransportProvider></BootChrome>
          {splash ? <BootIntro onDone={() => setSplash(false)} /> : null}
        </View>
      </LocaleProvider>
    </ThemeProvider>
  );
}
