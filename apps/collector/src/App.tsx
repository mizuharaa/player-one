import type { ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockCollectorApi } from './api/mock.ts';
import { ApiProvider } from './api/context.tsx';
import { LocaleProvider } from './locale.tsx';
import { NavProvider, useNav, type RouteName } from './nav.tsx';
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
import { TaskDetail } from './screens/TaskDetail.tsx';
import { TaskHall } from './screens/TaskHall.tsx';
import { Training } from './screens/Training.tsx';
import { Uploads } from './screens/Uploads.tsx';

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
  uploads: Uploads,
  income: Income,
};

function Current() {
  const { route } = useNav();
  const Screen = SCREENS[route.name];
  return <Screen />;
}

const queryClient = new QueryClient();

/**
 * The whole app's state, in memory, for the length of one process.
 *
 * ponytail: known ceiling, and it is the largest one in this directory —
 * killing the app resets registration, agreements, exam result, claims, bound
 * devices, sessions, the upload queue and income. Nothing here survives a
 * restart, so this scaffold does NOT yet meet the product's offline /
 * restart-survival requirement (APP-25's queue, PRODUCT.md's SQLite + MMKV +
 * offline queue of claims, sessions and upload intents).
 *
 * Upgrade path, in order: replace `MockCollectorApi` with the HTTP client once
 * the server's collector endpoints and auth exist; put the queue behind
 * SQLite/Drizzle with MMKV for session state; move the transfer itself into
 * the Kotlin foreground-service TurboModule so it survives app kill and Doze.
 * The `CollectorApi` interface is the seam all three land behind, and the
 * screens do not change. Until then, treat every queue on screen as a demo.
 */
const api = new MockCollectorApi();

export function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <ApiProvider value={api}>
          <QueryClientProvider client={queryClient}>
            <NavProvider initial={{ name: 'register' }}>
              <Current />
            </NavProvider>
          </QueryClientProvider>
        </ApiProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
